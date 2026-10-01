-- Etkinlikler: planlı (takvime göre, saatten hesaplanır) + sürpriz (oyuncular girdikçe 30 dakikada bir zar atılır,
-- 15 dakika önceden duyurulur). Zamanlayıcı/cron gerekmez. Saatler Türkiye saatine göredir (UTC+3, yaz saati yok).
--
--   kitlik         (planlı, her gün 17-18)  : o mal satın alınamaz; satışta +%8, kişi başı en fazla 20 kasa
--   altin_saat     (planlı, her gün 21-22)  : suçlardan +%25 itibar
--   baskin_gecesi  (planlı, Cuma 21-23)     : mekân baskını bekleme süresi yarıya iner
--   kelle_haftasi  (planlı, Cmt-Paz)        : kelle listesi aracı payı yarıya iner
--   fabrika_kazasi (sürpriz, bir şehir)     : şehrin kurşun fabrikası kapalı
--   polis_baskini  (sürpriz, bir şehir)     : suç şansı düşer ama ödül +%20
--   liman_firtinasi(sürpriz, bir şehir)     : o şehre/şehirden sefer yok

insert into game_settings values
  ('ev_shortage_bonus',   0.08),
  ('ev_shortage_cap',       20),
  ('ev_golden_xp',        0.25),
  ('ev_police_chance',    0.80),   -- suç şansı bu oranla çarpılır
  ('ev_police_reward',    1.20),
  ('ev_raid_cd_mult',     0.50),
  ('ev_bounty_fee_mult',  0.50),
  ('ev_roll_minutes',       30),
  ('ev_roll_chance',      0.30),
  ('ev_notice_minutes',     15),
  ('ev_planned',             1);   -- 0: planlı takvim kapalı (testler gerçek saatten etkilenmesin diye)

-- Sürpriz (ya da adminin elle başlattığı) etkinlikler
create table world_events (
  id      bigserial primary key,
  kind    text not null check (kind in ('kitlik', 'altin_saat', 'baskin_gecesi', 'kelle_haftasi',
                                        'fabrika_kazasi', 'polis_baskini', 'liman_firtinasi')),
  city_id text references cities(id),     -- null = her yer
  good_id text references goods(id),       -- kıtlıkta hangi mal
  starts  timestamptz not null,
  ends    timestamptz not null
);
create index on world_events (ends);
create table event_roll (id int primary key default 1 check (id = 1), last_at timestamptz not null);
insert into event_roll values (1, '-infinity');
-- Kıtlıkta kimin kaç kasa primli sattığı (sınır için)
create table event_sales (player_id uuid references players(id) on delete cascade, event_key text, qty int not null,
  primary key (player_id, event_key));

-- Belli bir zaman aralığındaki bütün etkinlikler (planlılar hesaplanır, sürprizler tablodan)
create or replace function events_between(p_from timestamptz, p_to timestamptz)
returns table (kind text, city_id text, good_id text, starts timestamptz, ends timestamptz, planned boolean)
language sql stable as $$
  with days as (   -- Türkiye günlerinin başlangıcı (UTC olarak)
    select (d::timestamp - interval '3 hours') at time zone 'UTC' as day0, d as local_day
    from generate_series(date_trunc('day', (p_from at time zone 'UTC') + interval '3 hours') - interval '1 day',
                         date_trunc('day', (p_to at time zone 'UTC') + interval '3 hours'), interval '1 day') d
  ), planned as (
    select 'kitlik', null::text, case when extract(doy from local_day)::int % 2 = 0 then 'kahve' else 'tutun' end,
           day0 + interval '17 hours', day0 + interval '18 hours', true from days
    union all select 'altin_saat', null, null, day0 + interval '21 hours', day0 + interval '22 hours', true from days
    union all select 'baskin_gecesi', null, null, day0 + interval '21 hours', day0 + interval '23 hours', true
      from days where extract(isodow from local_day) = 5
    union all select 'kelle_haftasi', null, null, day0, day0 + interval '1 day', true
      from days where extract(isodow from local_day) in (6, 7)
  )
  select * from planned p(kind, city_id, good_id, starts, ends, planned)
   where p.ends > p_from and p.starts < p_to and setting('ev_planned') = 1
  union all
  select w.kind, w.city_id, w.good_id, w.starts, w.ends, false from world_events w where w.ends > p_from and w.starts < p_to
$$;

-- Şu an süren etkinlik (şehre özelse o şehirde)
create or replace function ev_on(p_kind text, p_city text default null) returns boolean
language sql stable as $$
  select exists (select 1 from events_between(now(), now() + interval '1 second') e
                  where e.kind = p_kind and e.starts <= now() and (e.city_id is null or p_city is null or e.city_id = p_city))
$$;

-- Sürpriz etkinlik zarı: en fazla ev_roll_minutes'te bir; aynı türden süren/yaklaşan varsa yenisi gelmez
create or replace function roll_events() returns void
language plpgsql security definer set search_path = public as $$
declare k text; c text; dur int; st timestamptz;
begin
  update event_roll set last_at = now()
   where id = 1 and last_at < now() - make_interval(mins => setting('ev_roll_minutes')::int);
  if not found or random() >= setting('ev_roll_chance') then return; end if;
  k := (array['fabrika_kazasi', 'polis_baskini', 'liman_firtinasi'])[1 + floor(random() * 3)::int];
  if exists (select 1 from world_events where kind = k and ends > now()) then return; end if;
  select id into c from cities order by random() limit 1;
  dur := case k when 'fabrika_kazasi' then 60 + floor(random() * 61)::int when 'polis_baskini' then 60
                else 30 + floor(random() * 31)::int end;
  st := now() + make_interval(mins => setting('ev_notice_minutes')::int);
  insert into world_events (kind, city_id, starts, ends) values (k, c, st, st + make_interval(mins => dur));
end $$;

-- Oyuncunun göreceği takvim: şimdi sürenler + 7 gün içindekiler
create or replace function get_events() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform roll_events();
  return (select coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'city', e.city_id, 'good', e.good_id,
            'starts', e.starts, 'ends', e.ends, 'planned', e.planned) order by e.starts), '[]')
          from events_between(now(), now() + interval '7 days') e);
end $$;

-- ─────────────── Etkilerin bağlandığı yerler ───────────────
-- Kıtlık: alış yok; satışta prim (kişi başı sınırlı)
alter function trade(text, int) rename to trade_core;
create or replace function trade(p_good text, p_qty int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; e record; key text; done_qty int; bonus_qty int; bonus bigint;
begin
  select * into e from events_between(now(), now() + interval '1 second') x
   where x.kind = 'kitlik' and x.good_id = p_good and x.starts <= now() limit 1;
  if e.kind is not null and p_qty > 0 then
    return fail('Kıtlık var: piyasada hiç ' || (select name from goods where id = p_good) || ' yok. Elindekini satmanın tam zamanı.');
  end if;
  r := trade_core(p_good, p_qty);
  if e.kind is null or p_qty >= 0 or not (r->>'ok')::boolean then return r; end if;
  key := e.good_id || ':' || e.starts;
  select coalesce(qty, 0) into done_qty from event_sales where player_id = auth.uid() and event_key = key;
  bonus_qty := least(-p_qty, setting('ev_shortage_cap')::int - coalesce(done_qty, 0));
  if bonus_qty <= 0 then return r; end if;
  bonus := floor(price_of((select city_id from players where id = auth.uid()), p_good) * bonus_qty * setting('ev_shortage_bonus'));
  update players set cash = cash + bonus where id = auth.uid();
  insert into event_sales values (auth.uid(), key, bonus_qty)
    on conflict (player_id, event_key) do update set qty = event_sales.qty + excluded.qty;
  return jsonb_set(r, '{msg}', to_jsonb((r->>'msg') || ' Kıtlık primi: $' || bonus || '.'));
end $$;

-- Fabrika kazası: o şehirde kurşun satılmaz
alter function buy_bullets(int) rename to buy_bullets_events;
create or replace function buy_bullets(p_qty int) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if ev_on('fabrika_kazasi', (select city_id from players where id = auth.uid())) then
    return fail('Fabrikada kaza oldu, üretim durdu. Kurşunu Çarşı''dan bulmaya çalış ya da bekle.');
  end if;
  return buy_bullets_events(p_qty);
end $$;

-- Liman fırtınası: bu şehirden ya da bu şehre sefer yok
alter function travel(text) rename to travel_events;
create or replace function travel(p_city text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare here text := (select city_id from players where id = auth.uid());
begin
  if exists (select 1 from events_between(now(), now() + interval '1 second') e
              where e.kind = 'liman_firtinasi' and e.starts <= now() and e.city_id in (here, p_city)) then
    return fail('Limanda fırtına var, vapurlar kalkmıyor. Biraz bekle.');
  end if;
  return travel_events(p_city);
end $$;

-- Baskın gecesi: baskından sonraki bekleme yarıya iner
alter function raid_spot(int, int) rename to raid_spot_events;
create or replace function raid_spot(p_spot int, p_bullets int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := raid_spot_events(p_spot, p_bullets);
begin
  if (r->>'ok')::boolean and ev_on('baskin_gecesi') then
    update families set raid_ready_at = now() + make_interval(secs => setting('raid_cooldown_s') * setting('ev_raid_cd_mult'))
     where id = (select family_id from players where id = auth.uid());
  end if;
  return r;
end $$;

-- Suçlar (altın saat, polis baskını) ve kelle haftası, ilgili çekirdek fonksiyonlarda ev_* çarpanlarıyla uygulanır.
create or replace function ev_crime_chance(p_city text) returns numeric
language sql stable as $$ select case when ev_on('polis_baskini', p_city) then setting('ev_police_chance') else 1 end $$;
create or replace function ev_crime_reward(p_city text) returns numeric
language sql stable as $$ select case when ev_on('polis_baskini', p_city) then setting('ev_police_reward') else 1 end $$;
create or replace function ev_crime_xp() returns numeric
language sql stable as $$ select case when ev_on('altin_saat') then 1 + setting('ev_golden_xp') else 1 end $$;
create or replace function ev_bounty_fee() returns numeric
language sql stable as $$ select case when ev_on('kelle_haftasi') then setting('ev_bounty_fee_mult') else 1 end $$;

insert into api_rpcs values ('get_events()');
select apply_grants();
