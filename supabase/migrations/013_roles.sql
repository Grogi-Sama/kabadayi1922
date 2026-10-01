-- Yetki kademeleri: SAHİP (tek kişi, oyunun sahibi) ve MODERATÖR (sahibin oyun içinden yetki verdiği oyuncular).
-- Amaç: yetki yanlış ele geçse bile topluluğa verilebilecek zararı sınırlamak.
--  • Sahip sadece veritabanından (SQL editörü) bir kez atanır; oyun içinden kimse sahip olamaz.
--      insert into admins (user_id, role) values ('<sahibin auth uid>', 'owner');
--  • Moderatörü sadece sahip atar/alır (oyuncu adıyla). Moderatör başka yetkili atayamaz.
--  • Moderatör: ban en fazla 7 gün, susturma en fazla 72 saat, saatlik işlem sınırı var (toplu ban yapılamaz).
--  • Kimse sahibe işlem yapamaz; moderatör başka bir yetkiliye işlem yapamaz.
--  • Kalıcı ban, kalıcı banı kaldırmak ve sezonu bitirmek sadece sahibin işi.
--  • Her işlem kimin yaptığıyla birlikte kayda geçer (moderation_actions).

alter table admins
  add column role       text not null default 'moderator' check (role in ('owner', 'moderator')),
  add column granted_by uuid references auth.users(id) on delete set null,
  add column granted_at timestamptz not null default now();
create unique index one_owner on admins ((true)) where role = 'owner';

alter table moderation_actions drop constraint moderation_actions_action_check;
alter table moderation_actions add constraint moderation_actions_action_check check (action in
  ('warn', 'mute', 'unmute', 'ban', 'unban', 'delete_message', 'dismiss', 'resolve', 'grant', 'revoke', 'season'));

insert into game_settings values
  ('mod_max_ban_h',       168),   -- moderatörün verebileceği en uzun ban (saat)
  ('mod_max_mute_h',       72),
  ('mod_bans_per_hour',    10),   -- moderatör başına saatlik sınırlar
  ('mod_mutes_per_hour',   30),
  ('mod_deletes_per_hour', 60);

create or replace function admin_role() returns text
language sql stable security definer set search_path = public as $$
  select role from admins where user_id = auth.uid()
$$;

create or replace function require_owner() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if admin_role() is distinct from 'owner' then raise exception 'NOT_OWNER'; end if;
end $$;

-- Moderatörün son bir saatteki işlem sayısı
create or replace function mod_recent(p_action text) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from moderation_actions
   where admin_id = auth.uid() and action = p_action and created_at > now() - interval '1 hour'
$$;

-- admin_act: rol kurallarını uygula, sonra asıl işlemi yap
alter function admin_act(text, text, integer, text, bigint) rename to admin_act_core;
create or replace function admin_act(p_nick text, p_action text, p_hours int, p_reason text, p_report bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text; t players; t_role text; last_ban moderation_actions;
begin
  perform require_admin();
  me := admin_role();
  if p_action in ('dismiss', 'resolve') then return admin_act_core(p_nick, p_action, p_hours, p_reason, p_report); end if;

  t := player_by_nick(p_nick);
  if t.id is null then return fail('Oyuncu yok.'); end if;
  if t.id = auth.uid() then return fail('Kendine işlem yapamazsın.'); end if;
  select role into t_role from admins where user_id = t.id;
  if t_role = 'owner' then return fail('Oyunun sahibine işlem yapılamaz.'); end if;

  if me = 'moderator' then
    if t_role is not null then return fail('Başka bir yetkiliye işlem yapamazsın; sahibine bildir.'); end if;
    if p_action = 'ban' then
      if p_hours is null or p_hours > setting('mod_max_ban_h') then
        return fail('Moderatör en fazla ' || setting('mod_max_ban_h') / 24 || ' gün ban verebilir; kalıcı ban sahibin işi.');
      end if;
      if mod_recent('ban') >= setting('mod_bans_per_hour') then
        return fail('Saatlik ban sınırına ulaştın. Toplu bir sorun varsa sahibine bildir.');
      end if;
    elsif p_action = 'mute' then
      if p_hours is not null and p_hours > setting('mod_max_mute_h') then
        return fail('Moderatör en fazla ' || setting('mod_max_mute_h') || ' saat susturabilir.');
      end if;
      if mod_recent('mute') >= setting('mod_mutes_per_hour') then return fail('Saatlik susturma sınırına ulaştın.'); end if;
    elsif p_action = 'unban' then
      -- kalıcı banı (ya da sahibin verdiği banı) sadece sahip kaldırır
      select * into last_ban from moderation_actions where target_id = t.id and action = 'ban' order by id desc limit 1;
      if t.banned_until > now() + interval '50 years'
         or (select role from admins where user_id = last_ban.admin_id) = 'owner' then
        return fail('Bu banı sadece oyunun sahibi kaldırabilir.');
      end if;
    end if;
  end if;
  return admin_act_core(p_nick, p_action, p_hours, p_reason, p_report);
end $$;

alter function admin_delete_message(text, bigint, bigint) rename to admin_delete_message_core;
create or replace function admin_delete_message(p_kind text, p_id bigint, p_report bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  if admin_role() = 'moderator' and mod_recent('delete_message') >= setting('mod_deletes_per_hour') then
    return fail('Saatlik mesaj silme sınırına ulaştın.');
  end if;
  return admin_delete_message_core(p_kind, p_id, p_report);
end $$;

-- Sezonu bitirmek / bitişini değiştirmek bütün oyuncuları etkiler: sadece sahip
alter function admin_end_season() rename to admin_end_season_core;
create or replace function admin_end_season() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform require_owner();
  insert into moderation_actions (admin_id, action, reason) values (auth.uid(), 'season', 'sezon bitirildi');
  return admin_end_season_core();
end $$;

alter function admin_set_season_end(timestamptz) rename to admin_set_season_end_core;
create or replace function admin_set_season_end(p_ends_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform require_owner();
  insert into moderation_actions (admin_id, action, reason, until) values (auth.uid(), 'season', 'sezon bitişi değişti', p_ends_at);
  return admin_set_season_end_core(p_ends_at);
end $$;

-- ─────────────── Yetkililer (sadece sahip) ───────────────
create or replace function admin_team() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform require_owner();
  return (select coalesce(jsonb_agg(jsonb_build_object('nick', p.nick, 'role', a.role, 'granted_at', a.granted_at,
            'actions_24h', (select count(*) from moderation_actions m where m.admin_id = a.user_id and m.created_at > now() - interval '24 hours'))
            order by a.role = 'owner' desc, a.granted_at), '[]')
          from admins a left join players p on p.id = a.user_id);
end $$;

create or replace function admin_grant(p_nick text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t players;
begin
  perform require_owner();
  t := player_by_nick(p_nick);
  if t.id is null then return fail('Böyle bir oyuncu yok.'); end if;
  if exists (select 1 from admins where user_id = t.id) then return fail(t.nick || ' zaten yetkili.'); end if;
  insert into admins (user_id, role, granted_by) values (t.id, 'moderator', auth.uid());
  insert into moderation_actions (admin_id, target_id, action) values (auth.uid(), t.id, 'grant');
  return done(t.nick || ' artık moderatör.');
end $$;

create or replace function admin_revoke(p_nick text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t players;
begin
  perform require_owner();
  t := player_by_nick(p_nick);
  if t.id is null then return fail('Böyle bir oyuncu yok.'); end if;
  if (select role from admins where user_id = t.id) = 'owner' then return fail('Sahip yetkisi buradan alınamaz.'); end if;
  delete from admins where user_id = t.id and role = 'moderator';
  if not found then return fail(t.nick || ' zaten yetkili değil.'); end if;
  insert into moderation_actions (admin_id, target_id, action) values (auth.uid(), t.id, 'revoke');
  return done(t.nick || ' artık moderatör değil.');
end $$;

-- Panel başlığı için: rolüm ne?
create or replace function admin_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('role', admin_role(), 'nick', (select nick from players where id = auth.uid()))
$$;

-- Geçmiş: işlemi hangi yetkilinin yaptığı da görünsün
create or replace function admin_log() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('action', a.action, 'target', t.nick, 'admin', ad.nick, 'reason', a.reason,
            'until', a.until, 'at', a.created_at) order by a.id desc), '[]')
          from (select * from moderation_actions order by id desc limit 100) a
          left join players t on t.id = a.target_id left join players ad on ad.id = a.admin_id);
end $$;

insert into api_rpcs values ('admin_team()'), ('admin_grant(text)'), ('admin_revoke(text)'), ('admin_me()');
select apply_grants();
