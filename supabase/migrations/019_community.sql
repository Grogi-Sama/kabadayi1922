-- Topluluk: şikâyette sohbet bağlamı, oyuncu öneri kutusu, arkadaşlık + sadece arkadaşlar arası özel mesaj.

-- ─────────────── Şikâyet edilen mesajın bağlamı ───────────────
-- Şikâyet anında mesajın hangi sohbette ve ne zaman yazıldığı saklanır; mesaj sonradan silinse bile
-- admin itirazda/şikâyette öncesi ve sonrasıyla birlikte konuşmayı görebilir.
alter table reports add column ref_scope text, add column ref_at timestamptz;

alter function report_content(text, bigint, text, text) rename to report_content_core;
create or replace function report_content(p_kind text, p_ref bigint, p_nick text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := report_content_core(p_kind, p_ref, p_nick, p_reason); scope text; at timestamptz;
begin
  if not (r->>'ok')::boolean or p_kind = 'player' then return r; end if;
  if p_kind = 'message' then
    select 'dm:' || least(from_id, to_id) || ':' || greatest(from_id, to_id), created_at into scope, at from messages where id = p_ref;
  elsif p_kind = 'family_message' then
    select 'family:' || family_id, created_at into scope, at from family_messages where id = p_ref;
  elsif p_kind = 'chat_message' then
    select 'chat:' || channel, created_at into scope, at from chat_messages where id = p_ref;
  end if;
  update reports set ref_scope = scope, ref_at = at
   where id = (select max(id) from reports where reporter_id = auth.uid());
  return r;
end $$;

-- Hedef mesajın öncesindeki ve sonrasındaki 8'er mesaj (eskiden yeniye); hedef işaretli
create or replace function report_context(p_report bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare rp reports; parts text[];
begin
  select * into rp from reports where id = p_report;
  if rp.ref_scope is null then return '[]'; end if;
  parts := string_to_array(rp.ref_scope, ':');
  return (select coalesce(jsonb_agg(jsonb_build_object('nick', x.nick, 'text', x.text, 'at', x.at, 'target', x.id = rp.ref_id)
            order by x.at, x.id), '[]') from (
    (select m.id, p.nick, m.text, m.created_at at from (
        select id, player_id, text, created_at from chat_messages where parts[1] = 'chat' and channel = substr(rp.ref_scope, 6)
        union all select id, player_id, text, created_at from family_messages where parts[1] = 'family' and family_id = parts[2]::bigint
        union all select id, from_id, text, created_at from messages where parts[1] = 'dm'
          and least(from_id, to_id) = parts[2]::uuid and greatest(from_id, to_id) = parts[3]::uuid) m
      left join players p on p.id = m.player_id
      where m.created_at <= rp.ref_at order by m.created_at desc, m.id desc limit 9)
    union all
    (select m.id, p.nick, m.text, m.created_at from (
        select id, player_id, text, created_at from chat_messages where parts[1] = 'chat' and channel = substr(rp.ref_scope, 6)
        union all select id, player_id, text, created_at from family_messages where parts[1] = 'family' and family_id = parts[2]::bigint
        union all select id, from_id, text, created_at from messages where parts[1] = 'dm'
          and least(from_id, to_id) = parts[2]::uuid and greatest(from_id, to_id) = parts[3]::uuid) m
      left join players p on p.id = m.player_id
      where m.created_at > rp.ref_at order by m.created_at, m.id limit 8)) x);
end $$;

-- ─────────────── Öneri kutusu (sadece admin görür) ───────────────
create table suggestions (
  id         bigserial primary key,
  player_id  uuid references players(id) on delete set null,
  category   text not null check (category in ('ozellik', 'etkinlik', 'mod', 'denge', 'hata', 'diger')),
  text       text not null check (length(text) between 10 and 1000),
  status     text not null default 'yeni' check (status in ('yeni', 'okundu', 'planlandi', 'yapildi', 'reddedildi')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create or replace function submit_suggestion(p_category text, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; txt text := trim(p_text);
begin
  p := me_for_update();
  if p_category not in ('ozellik', 'etkinlik', 'mod', 'denge', 'hata', 'diger') then raise exception 'BAD_CATEGORY'; end if;
  if length(txt) < 10 then return fail('Önerini biraz daha aç (en az 10 karakter).'); end if;
  if length(txt) > 1000 then return fail('Öneri en fazla 1000 karakter olabilir.'); end if;
  if (select count(*) from suggestions where player_id = p.id and created_at > now() - interval '24 hours') >= 3 then
    return fail('Günde en fazla 3 öneri gönderebilirsin.');
  end if;
  insert into suggestions (player_id, category, text) values (p.id, p_category, clean_text(txt));
  return done('Önerin yönetime ulaştı. Teşekkürler!');
end $$;

create or replace function my_suggestions() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('category', category, 'text', text, 'status', status, 'note', admin_note,
           'at', created_at) order by id desc), '[]')
  from (select * from suggestions where player_id = auth.uid() order by id desc limit 20) s
$$;

create or replace function admin_suggestions(p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform require_owner();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'nick', p.nick, 'category', s.category, 'text', s.text,
            'status', s.status, 'note', s.admin_note, 'at', s.created_at) order by s.id desc), '[]')
          from suggestions s left join players p on p.id = s.player_id
          where p_status = 'hepsi' or s.status = p_status);
end $$;

create or replace function admin_suggestion_set(p_id bigint, p_status text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  perform require_owner();
  if p_status not in ('yeni', 'okundu', 'planlandi', 'yapildi', 'reddedildi') then raise exception 'BAD_STATUS'; end if;
  update suggestions set status = p_status, admin_note = nullif(trim(p_note), ''), updated_at = now() where id = p_id
    returning player_id into pid;
  if pid is null then return fail('Öneri yok.'); end if;
  if p_status in ('planlandi', 'yapildi') then
    perform log_event(pid, '💡 Önerin ' || case p_status when 'planlandi' then 'plana alındı' else 'oyuna eklendi' end || '. Teşekkürler!');
  end if;
  return done('Öneri güncellendi.');
end $$;

-- ─────────────── Arkadaşlık ───────────────
create table friendships (
  low        uuid not null references players(id) on delete cascade,   -- küçük id
  high       uuid not null references players(id) on delete cascade,   -- büyük id
  requester  uuid not null references players(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (low, high),
  check (low < high)
);

create or replace function are_friends(a uuid, b uuid) returns boolean
language sql stable as $$
  select exists (select 1 from friendships where low = least(a, b) and high = greatest(a, b) and status = 'accepted')
$$;

create or replace function friend_request(p_nick text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; t players; f friendships;
begin
  p := me_for_update();
  t := player_by_nick(p_nick);
  if t.id is null then return fail('Böyle bir oyuncu yok.'); end if;
  if t.id = p.id then return fail('Kendini arkadaş ekleyemezsin.'); end if;
  if is_blocked(t.id, p.id) or is_blocked(p.id, t.id) then return fail('Bu oyuncuya istek gönderemezsin.'); end if;
  select * into f from friendships where low = least(p.id, t.id) and high = greatest(p.id, t.id);
  if f.status = 'accepted' then return fail(t.nick || ' ile zaten arkadaşsınız.'); end if;
  if f.status = 'pending' and f.requester = p.id then return fail('İsteğin zaten gönderildi, cevap bekleniyor.'); end if;
  if f.status = 'pending' then   -- o da sana istek göndermişse: kabul
    update friendships set status = 'accepted' where low = f.low and high = f.high;
    perform log_event(t.id, p.nick || ' arkadaşlık isteğini kabul etti.');
    return done(t.nick || ' ile artık arkadaşsınız.');
  end if;
  if (select count(*) from friendships where requester = p.id and status = 'pending') >= 20 then
    return fail('Cevaplanmamış çok isteğin var; biraz bekle.');
  end if;
  insert into friendships (low, high, requester) values (least(p.id, t.id), greatest(p.id, t.id), p.id);
  perform log_event(t.id, p.nick || ' sana arkadaşlık isteği gönderdi (Defter → Arkadaşlar).');
  return done('Arkadaşlık isteği ' || t.nick || ' oyuncusuna gönderildi.');
end $$;

create or replace function friend_respond(p_nick text, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; t players;
begin
  p := me_for_update();
  t := player_by_nick(p_nick);
  if t.id is null then return fail('Böyle bir oyuncu yok.'); end if;
  if p_accept then
    update friendships set status = 'accepted'
     where low = least(p.id, t.id) and high = greatest(p.id, t.id) and status = 'pending' and requester = t.id;
    if not found then return fail('Bekleyen bir istek yok.'); end if;
    perform log_event(t.id, p.nick || ' arkadaşlık isteğini kabul etti.');
    return done(t.nick || ' ile artık arkadaşsınız.');
  end if;
  delete from friendships where low = least(p.id, t.id) and high = greatest(p.id, t.id) and status = 'pending';
  return done('İstek reddedildi.');
end $$;

create or replace function friend_remove(p_nick text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; t players;
begin
  p := me_for_update();
  t := player_by_nick(p_nick);
  if t.id is null then return fail('Böyle bir oyuncu yok.'); end if;
  delete from friendships where low = least(p.id, t.id) and high = greatest(p.id, t.id);
  return done(t.nick || ' arkadaş listenden çıkarıldı.');
end $$;

create or replace function get_friends() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'friends', coalesce((select jsonb_agg(jsonb_build_object('nick', o.nick, 'avatar', o.avatar, 'rank', rank_of(o.xp),
                 'online', o.last_seen > now() - interval '5 minutes') order by o.last_seen desc)
               from friendships f join players o on o.id = case when f.low = auth.uid() then f.high else f.low end
               where auth.uid() in (f.low, f.high) and f.status = 'accepted'), '[]'),
    'incoming', coalesce((select jsonb_agg(jsonb_build_object('nick', o.nick, 'avatar', o.avatar, 'rank', rank_of(o.xp)))
               from friendships f join players o on o.id = f.requester
               where auth.uid() in (f.low, f.high) and f.status = 'pending' and f.requester <> auth.uid()), '[]'),
    'outgoing', coalesce((select jsonb_agg(o.nick)
               from friendships f join players o on o.id = case when f.low = auth.uid() then f.high else f.low end
               where f.requester = auth.uid() and f.status = 'pending'), '[]'))
$$;

-- Özel mesaj: sadece arkadaşlar (ya da eşler) arasında. Yetkililer moderasyon için herkese yazabilir.
alter function send_message(text, text) rename to send_message_friends;
create or replace function send_message(p_nick text, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me players; t players;
begin
  select * into me from players where id = auth.uid();
  t := player_by_nick(p_nick);
  if t.id is not null and t.id <> me.id and not is_admin() and not are_friends(me.id, t.id)
     and not (me.spouse_id is not distinct from t.id and me.spouse_id is not null) then
    return fail('Sadece arkadaşlarına özelden yazabilirsin. Önce ' || t.nick || ' oyuncusuna arkadaşlık isteği gönder.');
  end if;
  return send_message_friends(p_nick, p_text);
end $$;

-- Profilde arkadaşlık durumu
alter function get_profile(text) rename to profile_friends;
create or replace function get_profile(p_nick text) returns jsonb
language sql stable security definer set search_path = public as $$
  select profile_friends(p_nick) || jsonb_build_object('friend',
    (select case when f.status = 'accepted' then 'friends' when f.requester = auth.uid() then 'sent' else 'received' end
       from friendships f, players t where lower(t.nick) = lower(p_nick)
        and f.low = least(auth.uid(), t.id) and f.high = greatest(auth.uid(), t.id)))
$$;

insert into api_rpcs values ('submit_suggestion(text, text)'), ('my_suggestions()'), ('admin_suggestions(text)'),
  ('admin_suggestion_set(bigint, text, text)'), ('friend_request(text)'), ('friend_respond(text, boolean)'),
  ('friend_remove(text)'), ('get_friends()');
select apply_grants();
