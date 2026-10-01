-- Ceza itirazı: oyuncu aldığı cezayı (uyarı/susturma/ban) haksız buluyorsa bir kez itiraz eder.
-- İtirazları sadece admin (sahip) inceler: oyuncunun bilgileri, ceza, tarih ve cezayı veren yetkili görünür.
-- Kabul edilirse ceza kalkar ve "haksız ceza" olarak cezayı verenin hanesine yazılır; admin o yetkiliyi uyarabilir.
-- Banlı oyuncu da itiraz edebilir (me_for_update banlıyı durdurduğu için burada kullanılmaz).

insert into game_settings values
  ('appeal_window_days', 30),   -- bu kadar günden eski cezaya itiraz edilmez
  ('appeal_max_open',     3);   -- aynı anda en fazla açık itiraz

alter table moderation_actions drop constraint moderation_actions_action_check;
alter table moderation_actions add constraint moderation_actions_action_check check (action in
  ('warn', 'mute', 'unmute', 'ban', 'unban', 'delete_message', 'dismiss', 'resolve', 'grant', 'revoke', 'season',
   'appeal_accept', 'appeal_reject', 'staff_warn'));

create table appeals (
  id          bigserial primary key,
  player_id   uuid not null references players(id) on delete cascade,
  action_id   bigint not null references moderation_actions(id) on delete cascade,   -- itiraz edilen ceza
  text        text not null check (length(text) between 10 and 600),
  status      text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  response    text,                           -- adminin oyuncuya cevabı
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (action_id)                          -- her cezaya bir itiraz
);

-- Oyuncunun son cezaları + itiraz durumu (banlıyken de çalışır)
create or replace function my_penalties() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'action', m.action, 'reason', m.reason, 'until', m.until,
           'at', m.created_at, 'evidence', (select r.snapshot from reports r where r.id = m.report_id), 'appeal', (select jsonb_build_object('status', a.status, 'response', a.response, 'at', a.created_at)
                                          from appeals a where a.action_id = m.id)) order by m.id desc), '[]')
  from moderation_actions m
  where m.target_id = auth.uid() and m.action in ('warn', 'mute', 'ban')
    and m.created_at > now() - make_interval(days => setting('appeal_window_days')::int)
$$;

create or replace function submit_appeal(p_action bigint, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m moderation_actions; txt text := trim(p_text);
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into m from moderation_actions where id = p_action and target_id = auth.uid() and action in ('warn', 'mute', 'ban');
  if m.id is null then return fail('Bu ceza bulunamadı.'); end if;
  if m.created_at < now() - make_interval(days => setting('appeal_window_days')::int) then
    return fail('Bu ceza ' || setting('appeal_window_days') || ' günden eski; itiraz süresi doldu.');
  end if;
  if exists (select 1 from appeals where action_id = m.id) then return fail('Bu cezaya zaten itiraz ettin.'); end if;
  if (select count(*) from appeals where player_id = auth.uid() and status = 'open') >= setting('appeal_max_open') then
    return fail('Açık itirazların sonuçlanmadan yenisini gönderemezsin.');
  end if;
  if length(txt) < 10 then return fail('Neden haksız olduğunu birkaç cümleyle anlat (en az 10 karakter).'); end if;
  if length(txt) > 600 then return fail('İtiraz en fazla 600 karakter olabilir.'); end if;
  insert into appeals (player_id, action_id, text) values (auth.uid(), m.id, clean_text(txt));
  return done('İtirazın alındı. İncelendiğinde sonucu burada göreceksin.');
end $$;

-- ─────────────── Admin ───────────────
create or replace function admin_appeals(p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform require_owner();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'text', a.text, 'status', a.status, 'response', a.response, 'at', a.created_at, 'resolved_at', a.resolved_at,
      'player', jsonb_build_object('nick', p.nick, 'rank', rank_of(p.xp), 'joined', p.created_at, 'kills', p.kills,
        'banned', p.banned_until > now(), 'muted', p.muted_until > now(),
        'reports_against', (select count(*) from reports r where r.target_id = p.id),
        'penalties_total', (select count(*) from moderation_actions x where x.target_id = p.id and x.action in ('warn', 'mute', 'ban'))),
      'penalty', jsonb_build_object('action', m.action, 'reason', m.reason, 'until', m.until, 'at', m.created_at,
        'evidence', (select r.snapshot from reports r where r.id = m.report_id),
        'context', report_context(m.report_id)),   -- 019: konuşmanın öncesi/sonrası
      'staff', jsonb_build_object('nick', s.nick, 'role', (select role from admins where user_id = m.admin_id),
        'overturned', (select count(*) from appeals a2 join moderation_actions m2 on m2.id = a2.action_id
                        where m2.admin_id = m.admin_id and a2.status = 'accepted')))
      order by a.id desc), '[]')
    from appeals a join players p on p.id = a.player_id join moderation_actions m on m.id = a.action_id
    left join players s on s.id = m.admin_id
    where a.status = p_status);
end $$;

-- Kabul: ceza kalkar (ban/susturma hâlâ sürüyorsa), oyuncuya bildirim. Ret: sadece cevap.
create or replace function admin_resolve_appeal(p_id bigint, p_accept boolean, p_response text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a appeals; m moderation_actions; resp text := nullif(trim(p_response), '');
begin
  perform require_owner();
  select * into a from appeals where id = p_id for update;
  if a.id is null then return fail('İtiraz yok.'); end if;
  if a.status <> 'open' then return fail('Bu itiraz zaten sonuçlandı.'); end if;
  select * into m from moderation_actions where id = a.action_id;
  update appeals set status = case when p_accept then 'accepted' else 'rejected' end, response = resp,
    resolved_by = auth.uid(), resolved_at = now() where id = a.id;
  if p_accept then
    if m.action = 'ban' then update players set banned_until = null, ban_reason = null where id = a.player_id;
    elsif m.action = 'mute' then update players set muted_until = null where id = a.player_id; end if;
    insert into moderation_actions (admin_id, target_id, action, reason) values (auth.uid(), a.player_id, 'appeal_accept', resp);
    perform log_event(a.player_id, '✅ İtirazın kabul edildi, ceza kaldırıldı.' || coalesce(' Not: ' || resp, ''));
    return done('İtiraz kabul edildi, ceza kaldırıldı.');
  end if;
  insert into moderation_actions (admin_id, target_id, action, reason) values (auth.uid(), a.player_id, 'appeal_reject', resp);
  perform log_event(a.player_id, '❌ İtirazın reddedildi.' || coalesce(' Not: ' || resp, ''));
  return done('İtiraz reddedildi.');
end $$;

-- Haksız ceza veren yetkiliyi uyar (yetkilinin olay defterine düşer, kayda geçer)
create or replace function admin_warn_staff(p_nick text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t players; r text := nullif(trim(p_reason), '');
begin
  perform require_owner();
  t := player_by_nick(p_nick);
  if t.id is null or not exists (select 1 from admins where user_id = t.id and role = 'moderator') then
    return fail('Böyle bir moderatör yok.');
  end if;
  if r is null then return fail('Uyarı gerekçesini yaz.'); end if;
  insert into moderation_actions (admin_id, target_id, action, reason) values (auth.uid(), t.id, 'staff_warn', r);
  perform log_event(t.id, '⚠ Yönetim uyarısı (moderatörlük): ' || r);
  return done(t.nick || ' uyarıldı.');
end $$;

-- Yetkililer listesine "haksız bulunan ceza" sayısı ve uyarılar
create or replace function admin_team() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform require_owner();
  return (select coalesce(jsonb_agg(jsonb_build_object('nick', p.nick, 'role', a.role, 'granted_at', a.granted_at,
            'actions_24h', (select count(*) from moderation_actions m where m.admin_id = a.user_id and m.created_at > now() - interval '24 hours'),
            'overturned', (select count(*) from appeals ap join moderation_actions m on m.id = ap.action_id
                            where m.admin_id = a.user_id and ap.status = 'accepted'),
            'staff_warns', (select count(*) from moderation_actions m where m.target_id = a.user_id and m.action = 'staff_warn'))
            order by a.role = 'owner' desc, a.granted_at), '[]')
          from admins a left join players p on p.id = a.user_id);
end $$;

-- Admin özetinde açık itiraz sayısı
alter function admin_overview() rename to admin_overview_core;
create or replace function admin_overview() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return admin_overview_core() || jsonb_build_object('open_appeals',
    case when admin_role() = 'owner' then (select count(*) from appeals where status = 'open') else 0 end);
end $$;

insert into api_rpcs values ('my_penalties()'), ('submit_appeal(bigint, text)'), ('admin_appeals(text)'),
  ('admin_resolve_appeal(bigint, boolean, text)'), ('admin_warn_staff(text, text)');
select apply_grants();
