-- 032: Mobil/web bildirimleri. Tekrar çalıştırılabilir.
-- Akış: önemli olay → push_queue'ya satır → (her dakika) Edge Function "push" kuyruğu okur, Web Push ile gönderir.
-- Sadece oyunu o an açık tutmayanlara gider (son 2 dakikada etkinliği olmayan). Zamanlayıcı kurulumu: supabase/push_setup.sql
-- (yerelde/PGlite'ta cron yok; bu dosya her yerde çalışır).

create table if not exists push_subs (
  endpoint   text primary key,
  player_id  uuid not null references players(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_player on push_subs (player_id);

create table if not exists push_queue (
  id         bigserial primary key,
  player_id  uuid not null references players(id) on delete cascade,
  title      text not null,
  body       text not null,
  tag        text,                       -- aynı türden bildirim üst üste binsin (tek göster)
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index if not exists push_queue_unsent on push_queue (id) where sent_at is null;
alter table push_subs  enable row level security;
alter table push_queue enable row level security;

insert into game_settings values ('push_idle_s', 120) on conflict (key) do nothing;

create or replace function save_push_sub(p_endpoint text, p_p256dh text, p_auth text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from players where id = auth.uid()) then raise exception 'NO_PLAYER'; end if;
  if length(p_endpoint) > 1000 or p_endpoint !~ '^https://' then return fail('Geçersiz abonelik.'); end if;
  insert into push_subs (endpoint, player_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
    on conflict (endpoint) do update set player_id = excluded.player_id, p256dh = excluded.p256dh, auth = excluded.auth;
  return done('Bildirimler açıldı.');
end $$;

create or replace function delete_push_sub(p_endpoint text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  delete from push_subs where endpoint = p_endpoint and player_id = auth.uid();
  return done('Bildirimler kapatıldı.');
end $$;

-- Kuyruğa ekle: aboneliği olan ve şu an oyunda olmayan oyuncuya
create or replace function queue_push(pid uuid, p_title text, p_body text, p_tag text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from push_subs where player_id = pid) then return; end if;
  if exists (select 1 from players where id = pid and last_seen > now() - make_interval(secs => setting('push_idle_s'))) then return; end if;
  insert into push_queue (player_id, title, body, tag) values (pid, p_title, left(p_body, 180), p_tag);
end $$;

-- Olay defterine düşen her şey (saldırı, ekip işi sonucu, itiraz, teklif, kulüp…) bildirim olur
create or replace function push_on_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform queue_push(new.player_id, 'Kabadayı', new.text, 'olay');
  return new;
end $$;
drop trigger if exists push_event on events;
create trigger push_event after insert on events for each row execute function push_on_event();

-- Özel mesaj
create or replace function push_on_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform queue_push(new.to_id, (select nick from players where id = new.from_id) || ' sana yazdı', new.text, 'mesaj');
  return new;
end $$;
drop trigger if exists push_message on messages;
create trigger push_message after insert on messages for each row execute function push_on_message();

-- Aile duyuruları (mekân kaybı, baskın…) bütün üyelere
create or replace function push_on_family() returns trigger
language plpgsql security definer set search_path = public as $$
declare m record;
begin
  if new.player_id is not null then return new; end if;   -- sadece sistem duyuruları
  for m in select id from players where family_id = new.family_id loop
    perform queue_push(m.id, 'Ailenden haber', new.text, 'aile');
  end loop;
  return new;
end $$;
drop trigger if exists push_family on family_messages;
create trigger push_family after insert on family_messages for each row execute function push_on_family();

-- Zamanlayıcının her dakika çağırdığı: süresi az önce dolanlar (hapis bitti, vapur hazır, adam eğitimi bitti)
create table if not exists push_ready_mark (player_id uuid primary key references players(id) on delete cascade, at timestamptz not null);
alter table push_ready_mark enable row level security;
create or replace function queue_ready_pushes() returns int
language plpgsql security definer set search_path = public as $$
declare since timestamptz := coalesce((select max(at) from push_ready_mark), now() - interval '1 minute'); n int := 0; r record;
begin
  for r in select p.id, p.jail_until, p.travel_ready_at from players p
           where exists (select 1 from push_subs s where s.player_id = p.id) loop
    if r.jail_until > since and r.jail_until <= now() then perform queue_push(r.id, 'Kabadayı', 'Hapisten çıktın. Sokaklar seni bekliyor.', 'hazir'); n := n + 1; end if;
    if r.travel_ready_at > since and r.travel_ready_at <= now() then perform queue_push(r.id, 'Kabadayı', 'Vapur hazır; yeni bir sefere çıkabilirsin.', 'hazir'); n := n + 1; end if;
    if exists (select 1 from player_men m where m.player_id = r.id and m.ready_at > since and m.ready_at <= now()) then
      perform queue_push(r.id, 'Kabadayı', 'Adamının eğitimi bitti; yanına katıldı.', 'adam'); n := n + 1;
    end if;
  end loop;
  insert into push_ready_mark values ('00000000-0000-0000-0000-000000000000', now())
    on conflict (player_id) do update set at = excluded.at;
  return n;
end $$;
-- Not: push_ready_mark tek satırlık "son çalışma" kaydı; sahte uuid players'a bağlı olmasın diye FK'yi kaldır
alter table push_ready_mark drop constraint if exists push_ready_mark_player_id_fkey;

-- Edge Function için: gönderilmemişleri al ve gönderildi işaretle (sadece servis rolü çağırır; istemciye açık değil)
create or replace function push_take(p_limit int default 200) returns table (id bigint, endpoint text, p256dh text, auth text, title text, body text, tag text)
language sql security definer set search_path = public as $$
  with q as (
    update push_queue set sent_at = now() where push_queue.id in (
      select push_queue.id from push_queue where sent_at is null order by push_queue.id limit p_limit for update skip locked)
    returning push_queue.id, push_queue.player_id, push_queue.title, push_queue.body, push_queue.tag)
  select q.id, s.endpoint, s.p256dh, s.auth, q.title, q.body, q.tag from q join push_subs s on s.player_id = q.player_id
$$;
create or replace function push_drop_sub(p_endpoint text) returns void
language sql security definer set search_path = public as $$ delete from push_subs where endpoint = p_endpoint $$;
-- eski kuyruk temizliği
create or replace function push_cleanup() returns void
language sql security definer set search_path = public as $$ delete from push_queue where created_at < now() - interval '2 days' $$;

insert into api_rpcs values ('save_push_sub(text, text, text)'), ('delete_push_sub(text)') on conflict do nothing;
select apply_grants();

-- Edge Function servis rolüyle çalışır: kuyruk fonksiyonları ona açık (istemciye değil)
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function push_take(int), push_drop_sub(text), push_cleanup(), queue_ready_pushes() to service_role;
  end if;
end $$;
