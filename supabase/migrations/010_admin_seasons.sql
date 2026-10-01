-- Faz 4A: admin/moderasyon + sezonlar.
-- Admin olmak: Supabase SQL editöründen  insert into admins values ('<senin auth uid>');
-- Bütün admin fonksiyonları is_admin() kontrol eder; sayfayı bulan biri bile veri göremez.

-- ─────────────── Moderasyon ───────────────
create table admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table admins enable row level security;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid())
$$;

alter table players
  add column banned_until timestamptz,
  add column ban_reason   text,
  add column muted_until  timestamptz;

create table moderation_actions (
  id         bigserial primary key,
  admin_id   uuid references auth.users(id) on delete set null,
  target_id  uuid references players(id) on delete set null,
  action     text not null check (action in ('warn', 'mute', 'unmute', 'ban', 'unban', 'delete_message', 'dismiss', 'resolve')),
  reason     text,
  until      timestamptz,
  report_id  bigint references reports(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table moderation_actions enable row level security;

-- Banlı oyuncu hiçbir aksiyon yapamaz: bütün aksiyonlar me_for_update()'ten geçer
create or replace function me_for_update() returns players
language plpgsql as $$
declare r players;
begin
  select * into r from players where id = auth.uid() for update;
  if not found then raise exception 'NO_PLAYER'; end if;
  if r.banned_until > now() then raise exception 'BANNED'; end if;
  return r;
end $$;

create or replace function mute_msg(p uuid) returns text
language sql stable as $$
  select 'Moderatör seni ' || fmt_wait(muted_until) || ' susturdu.' from players where id = p and muted_until > now()
$$;

alter function send_message(text, text) rename to send_message_core;
create or replace function send_message(p_nick text, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform me_for_update();
  if mute_msg(auth.uid()) is not null then return fail(mute_msg(auth.uid())); end if;
  return send_message_core(p_nick, p_text);
end $$;

alter function post_family_message(text) rename to post_family_message_core;
create or replace function post_family_message(p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform me_for_update();
  if mute_msg(auth.uid()) is not null then return fail(mute_msg(auth.uid())); end if;
  return post_family_message_core(p_text);
end $$;

create or replace function require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
end $$;

create or replace function admin_overview() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  perform ensure_season();
  return jsonb_build_object(
    'players', (select count(*) from players),
    'online', (select count(*) from players where last_seen > now() - interval '5 minutes'),
    'active_24h', (select count(*) from players where last_seen > now() - interval '24 hours'),
    'open_reports', (select count(*) from reports where status = 'open'),
    'banned', (select count(*) from players where banned_until > now()),
    'season', (select jsonb_build_object('id', id, 'name', name, 'starts_at', starts_at, 'ends_at', ends_at)
               from seasons where not ended order by id desc limit 1));
end $$;

create or replace function admin_reports(p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'kind', r.kind, 'ref_id', r.ref_id, 'snapshot', r.snapshot, 'reason', r.reason,
      'status', r.status, 'created_at', r.created_at,
      'reporter', rp.nick, 'target', t.nick,
      'target_reports', (select count(*) from reports x where x.target_id = r.target_id),
      'target_banned', t.banned_until > now(), 'target_muted', t.muted_until > now(),
      -- mesaj hâlâ duruyor mu (silinmiş olabilir)
      'still_exists', case r.kind when 'message' then exists (select 1 from messages where id = r.ref_id)
                                  when 'family_message' then exists (select 1 from family_messages where id = r.ref_id)
                                  when 'chat_message' then exists (select 1 from chat_messages where id = r.ref_id) end)
    order by r.id desc), '[]')
    from (select * from reports where status = p_status order by id desc limit 100) r
    left join players rp on rp.id = r.reporter_id left join players t on t.id = r.target_id);
end $$;

create or replace function admin_player(p_nick text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t players;
begin
  perform require_admin();
  t := player_by_nick(p_nick);
  if t.id is null then return null; end if;
  return jsonb_build_object(
    'nick', t.nick, 'rank', rank_of(t.xp), 'xp', t.xp, 'cash', t.cash, 'bank', t.bank, 'bullets', t.bullets,
    'city', t.city_id, 'kills', t.kills, 'deaths', t.deaths, 'respect', t.respect,
    'family', (select name from families where id = t.family_id), 'family_role', t.family_role,
    'created_at', t.created_at, 'last_seen', t.last_seen,
    'banned_until', t.banned_until, 'ban_reason', t.ban_reason, 'muted_until', t.muted_until,
    'reports_against', (select count(*) from reports where target_id = t.id),
    'reports_made', (select count(*) from reports where reporter_id = t.id),
    'blocked_by', (select count(*) from blocks where blocked_id = t.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('text', text, 'at', created_at) order by id desc), '[]')
               from (select * from events where player_id = t.id order by id desc limit 30) e),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'to', r.nick, 'text', m.text, 'at', m.created_at) order by m.id desc), '[]')
                 from (select * from messages where from_id = t.id order by id desc limit 30) m join players r on r.id = m.to_id),
    'family_messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'text', m.text, 'at', m.created_at) order by m.id desc), '[]')
                 from (select * from family_messages where player_id = t.id order by id desc limit 20) m),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('action', a.action, 'reason', a.reason, 'until', a.until, 'at', a.created_at) order by a.id desc), '[]')
                from moderation_actions a where a.target_id = t.id));
end $$;

-- p_action: warn | mute | unmute | ban | unban | dismiss | resolve
-- p_hours: mute/ban süresi (ban için null = kalıcı)
create or replace function admin_act(p_nick text, p_action text, p_hours int, p_reason text, p_report bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t players; until_ts timestamptz; reason text := nullif(trim(p_reason), '');
begin
  perform require_admin();
  if p_action in ('dismiss', 'resolve') then
    if p_report is null then raise exception 'NO_REPORT'; end if;
    update reports set status = case p_action when 'dismiss' then 'dismissed' else 'actioned' end where id = p_report;
    insert into moderation_actions (admin_id, target_id, action, reason, report_id)
      values (auth.uid(), (select target_id from reports where id = p_report), p_action, reason, p_report);
    return done(case p_action when 'dismiss' then 'Şikâyet kapatıldı (işlem yok).' else 'Şikâyet çözüldü olarak işaretlendi.' end);
  end if;

  t := player_by_nick(p_nick);
  if t.id is null then return fail('Oyuncu yok.'); end if;
  if p_action in ('warn', 'mute', 'ban') and reason is null then return fail('Gerekçe yazmalısın; oyuncu bunu görecek.'); end if;

  if p_action = 'warn' then
    perform log_event(t.id, '⚠ Moderatör uyarısı: ' || reason);
  elsif p_action = 'mute' then
    until_ts := now() + make_interval(hours => greatest(1, coalesce(p_hours, 24)));
    update players set muted_until = until_ts where id = t.id;
    perform log_event(t.id, '🔇 ' || fmt_wait(until_ts) || ' susturuldun. Gerekçe: ' || reason);
  elsif p_action = 'unmute' then
    update players set muted_until = null where id = t.id;
  elsif p_action = 'ban' then
    until_ts := case when p_hours is null then now() + interval '100 years' else now() + make_interval(hours => p_hours) end;
    update players set banned_until = until_ts, ban_reason = reason where id = t.id;
  elsif p_action = 'unban' then
    update players set banned_until = null, ban_reason = null where id = t.id;
  else
    raise exception 'BAD_ACTION';
  end if;

  insert into moderation_actions (admin_id, target_id, action, reason, until, report_id)
    values (auth.uid(), t.id, p_action, reason, until_ts, p_report);
  if p_report is not null then update reports set status = 'actioned' where id = p_report; end if;
  return done(t.nick || ' ' || case p_action when 'warn' then 'uyarıldı' when 'mute' then 'susturuldu'
    when 'unmute' then 'artık konuşabilir' when 'ban' then 'banlandı' when 'unban' then 'banı kaldırıldı' end || '.');
end $$;

create or replace function admin_delete_message(p_kind text, p_id bigint, p_report bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare author uuid;
begin
  perform require_admin();
  if p_kind = 'message' then delete from messages where id = p_id returning from_id into author;
  elsif p_kind = 'family_message' then delete from family_messages where id = p_id returning player_id into author;
  elsif p_kind = 'chat_message' then delete from chat_messages where id = p_id returning player_id into author;
  else raise exception 'BAD_KIND'; end if;
  if author is null then return fail('Mesaj zaten silinmiş.'); end if;
  insert into moderation_actions (admin_id, target_id, action, report_id) values (auth.uid(), author, 'delete_message', p_report);
  return done('Mesaj silindi (kopyası şikâyet kaydında duruyor).');
end $$;

create or replace function admin_log() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('action', a.action, 'target', t.nick, 'reason', a.reason,
            'until', a.until, 'at', a.created_at) order by a.id desc), '[]')
          from (select * from moderation_actions order by id desc limit 100) a left join players t on t.id = a.target_id);
end $$;

-- ─────────────── Sezonlar ───────────────
insert into game_settings values ('season_days', 56);

create table seasons (
  id        serial primary key,
  name      text not null,
  starts_at timestamptz not null,
  ends_at   timestamptz not null,
  ended     boolean not null default false
);
create unique index one_active_season on seasons ((true)) where not ended;

create table season_results (
  season_id int  not null references seasons(id) on delete cascade,
  category  text not null check (category in ('itibar', 'infaz', 'servet', 'aile')),
  place     int  not null,
  player_id uuid references players(id) on delete set null,
  name      text not null,       -- oyuncu ya da aile adı (sonradan değişse de tarih kalır)
  value     bigint not null,
  primary key (season_id, category, place)
);
alter table seasons        enable row level security;
alter table season_results enable row level security;

-- Sezon sonu: dünyayı sıfırla. Hesaplar, takma adlar, evlilik, saygı ve mesajlar kalır.
create or replace function reset_world() returns void
language plpgsql as $$
begin
  delete from bj_games; delete from lottery_tickets; delete from market_listings;
  delete from race_entries; delete from races; delete from crew_members; delete from crews;
  delete from player_cooldowns; delete from bounties; delete from detective_searches;
  delete from player_cars; delete from player_goods; delete from family_applications;
  update city_bullets set owner_family = null, stock = 1500, price = 6, restocked_at = now();
  update spots set owner_family = null, defense = 0, collected_at = now(), protected_until = now();
  update players set family_id = null, family_role = null;
  delete from families;
  update players set
    city_id = 'istanbul', cash = setting('start_cash'), bank = 0, xp = 0, bullets = 0, health = 100,
    weapon_id = null, bodyguards = 0, kill_skill = 0, transport_id = 'vapur', race_form = 0,
    kills = 0, deaths = 0, busts = 0, self_bust_left = 3, self_bust_for = null, bullets_hour_bought = 0,
    crime_ready_at = now(), car_ready_at = now(), travel_ready_at = now(), jail_until = now(),
    hospital_until = now(), kill_ready_at = now(), bust_ready_at = now(), practice_ready_at = now(),
    casino_ready_at = now(), hideout_until = now(), proposal_to = null;
end $$;

create or replace function end_season(s seasons) returns void
language plpgsql as $$
begin
  insert into season_results
    select s.id, 'itibar', row_number() over (order by xp desc, created_at), id, nick, xp
      from players where banned_until is null or banned_until < now() order by xp desc limit 20;
  insert into season_results
    select s.id, 'infaz', row_number() over (order by kills desc, xp desc), id, nick, kills
      from players where kills > 0 and (banned_until is null or banned_until < now()) order by kills desc, xp desc limit 20;
  insert into season_results
    select s.id, 'servet', row_number() over (order by cash + bank desc), id, nick, cash + bank
      from players where banned_until is null or banned_until < now() order by cash + bank desc limit 20;
  insert into season_results
    select s.id, 'aile', row_number() over (order by sum(m.xp) desc), null, f.name, sum(m.xp)
      from families f join players m on m.family_id = f.id group by f.id order by sum(m.xp) desc limit 10;
  update seasons set ended = true where id = s.id;
  perform reset_world();
  insert into events (player_id, text)
    select id, s.name || ' bitti! Şeref listesi Defter''de. Yeni sezonda herkes sıfırdan başlıyor.' from players;
end $$;

-- Aktif sezon yoksa başlatır, süresi dolmuşsa bitirip yenisini açar. Ucuz: çoğu çağrıda tek satır okur.
create or replace function ensure_season() returns seasons
language plpgsql as $$
declare s seasons; n int;
begin
  select * into s from seasons where not ended order by id desc limit 1;
  if found and s.ends_at > now() then return s; end if;
  if found then
    select * into s from seasons where id = s.id and not ended for update skip locked;   -- aynı anda tek bitirici
    if not found then return (select x from seasons x where not ended order by id desc limit 1); end if;
    perform end_season(s);
  end if;
  select count(*) + 1 into n from seasons;
  insert into seasons (name, starts_at, ends_at) values (n || '. Sezon', now(), now() + make_interval(days => setting('season_days')::int))
    returning * into s;
  return s;
end $$;

create or replace function admin_end_season() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  update seasons set ends_at = now() where not ended;
  perform ensure_season();
  return done('Sezon bitirildi, şeref listesi kaydedildi, yeni sezon başladı.');
end $$;

create or replace function admin_set_season_end(p_ends_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  if p_ends_at <= now() then return fail('Gelecekte bir tarih seç.'); end if;
  update seasons set ends_at = p_ends_at where not ended;
  return done('Sezon bitişi güncellendi.');
end $$;

create or replace function player_badges(p uuid) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('season', s.name, 'category', r.category, 'place', r.place) order by s.id desc, r.place), '[]')
  from season_results r join seasons s on s.id = r.season_id where r.player_id = p and r.place <= 3
$$;

create or replace function get_season() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s seasons := ensure_season(); last seasons;
begin
  select * into last from seasons where ended order by id desc limit 1;
  return jsonb_build_object(
    'id', s.id, 'name', s.name, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
    'last', case when last.id is not null then jsonb_build_object('name', last.name,
      'results', (select jsonb_object_agg(category, rows) from (
        select category, jsonb_agg(jsonb_build_object('place', place, 'name', name, 'value', value) order by place) rows
        from season_results where season_id = last.id and place <= 5 group by category) c)) end,
    'badges', player_badges(auth.uid()));
end $$;

-- ─────────────── Sarmalayıcılar ───────────────
alter function get_profile(text) rename to profile_extras;
create or replace function get_profile(p_nick text) returns jsonb
language sql stable security definer set search_path = public as $$
  select profile_extras(p_nick) || jsonb_build_object('badges', player_badges(t.id))
  from players t where lower(t.nick) = lower(p_nick)
$$;

alter function get_state() rename to state_extras;
create or replace function get_state() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare base jsonb; p players; s seasons;
begin
  s := ensure_season();
  select * into p from players where id = auth.uid();
  if p.banned_until > now() then
    return jsonb_build_object('player', null, 'banned', jsonb_build_object(
      'until', case when p.banned_until > now() + interval '50 years' then null else p.banned_until end, 'reason', p.ban_reason));
  end if;
  base := state_extras();
  if base->'player' = 'null'::jsonb then return base; end if;
  return jsonb_set(base, '{player}', (base->'player') || jsonb_build_object(
      'is_admin', is_admin(), 'muted_until', case when p.muted_until > now() then p.muted_until end))
    || jsonb_build_object('season', jsonb_build_object('name', s.name, 'ends_at', s.ends_at));
end $$;

insert into api_rpcs values
  ('is_admin()'), ('admin_overview()'), ('admin_reports(text)'), ('admin_player(text)'),
  ('admin_act(text, text, integer, text, bigint)'), ('admin_delete_message(text, bigint, bigint)'), ('admin_log()'),
  ('admin_end_season()'), ('admin_set_season_end(timestamp with time zone)'), ('get_season()');
select apply_grants();
