-- Faz 1 çekirdek: oyuncu, suç, araba, hapis, yolculuk, kaçak mal ticareti.
-- Kural: Bütün para/süre/zar hesapları burada. İstemci sadece RPC çağırır.

-- ─────────────── Ayarlar (oyunu kod değiştirmeden dengelemek için) ───────────────
create table game_settings (
  key   text primary key,
  value numeric not null
);
insert into game_settings values
  ('crime_cooldown_s',   90),
  ('car_cooldown_s',    240),
  ('travel_cooldown_s', 900),
  ('travel_cost',       200),
  ('customs_chance',   0.08),  -- yolculukta kaçak malın gümrüğe takılma ihtimali
  ('car_fail_jail_s',    75),
  ('start_cash',        500);

create or replace function setting(k text) returns numeric
language sql stable as $$ select value from game_settings where key = k $$;

-- ─────────────── Sabit veriler ───────────────
create table ranks (
  id       int primary key,
  name     text not null,
  min_xp   int  not null,
  carry    int  not null   -- taşıyabileceği kaçak mal (kasa)
);
insert into ranks values
  (0, 'Çaylak',        0,      10),
  (1, 'Ayak İşçisi',   100,    20),
  (2, 'Yankesici',     300,    30),
  (3, 'Tetikçi',       700,    45),
  (4, 'Kabadayı',      1500,   60),
  (5, 'Külhanbeyi',    3000,   80),
  (6, 'Reis',          6000,  100),
  (7, 'Efendi',        12000, 130),
  (8, 'Paşa',          25000, 160),
  (9, 'Baba',          50000, 200);

create table cities (
  id    text primary key,
  name  text not null,
  sort  int  not null
);
insert into cities values
  ('istanbul',   'İstanbul',   1),
  ('izmir',      'İzmir',      2),
  ('selanik',    'Selanik',    3),
  ('pire',       'Pire',       4),
  ('iskenderiye','İskenderiye',5),
  ('beyrut',     'Beyrut',     6);

create table goods (
  id         text primary key,
  name       text not null,
  base_price int  not null,
  sort       int  not null
);
insert into goods values
  ('kahve',  'Kahve',          40, 1),
  ('tutun',  'Kaçak Tütün',    70, 2),
  ('sarap',  'Şarap',          90, 3),
  ('raki',   'Rakı',          140, 4),
  ('konyak', 'Konyak',        260, 5),
  ('viski',  'Viski',         420, 6);

create table crimes (
  id         text primary key,
  name       text not null,
  min_rank   int  not null,
  base_rate  numeric not null,  -- temel başarı ihtimali
  reward_min int  not null,
  reward_max int  not null,
  xp         int  not null,
  jail_s     int  not null,
  sort       int  not null
);
insert into crimes values
  ('cep',       'Yankesicilik yap',          0, 0.65,   20,    80,   5,  45, 1),
  ('dukkan',    'Bakkal kasasını soy',       1, 0.50,  100,   300,  12,  90, 2),
  ('kumarhane', 'Kumarhaneden haraç topla',  2, 0.40,  300,   900,  25, 150, 3),
  ('liman',     'Liman deposunu soy',        3, 0.30, 1000,  3000,  50, 240, 4),
  ('kuyumcu',   'Kapalıçarşı kuyumcusu',     4, 0.25, 2500,  6000,  80, 300, 5),
  ('banka',     'Banka kasasını patlat',     5, 0.18, 5000, 15000, 120, 420, 6);

create table cars (
  id     text primary key,
  name   text not null,
  value  int  not null,
  weight int  not null   -- çalınma sıklığı (büyük = sık)
);
insert into cars values
  ('kamyonet', 'Hurda Kamyonet',       250, 50),
  ('taksi',    'Şehir Taksisi',        500, 25),
  ('aile',     'Aile Otomobili',       900, 12),
  ('spor',     'Üstü Açık Spor Araba', 1600, 7),
  ('sedan',    'Lüks Sedan',           3200, 4),
  ('limuzin',  'Paşa Limuzini',        8000, 2);

-- ─────────────── Oyuncu verisi ───────────────
create table players (
  id              uuid primary key references auth.users(id) on delete cascade,
  nick            text not null check (nick ~ '^[A-Za-z0-9ÇĞİÖŞÜçğıöşü_]{3,16}$'),
  city_id         text not null references cities(id) default 'istanbul',
  cash            bigint not null default 0 check (cash >= 0),
  xp              int    not null default 0,
  crime_ready_at  timestamptz not null default now(),
  car_ready_at    timestamptz not null default now(),
  travel_ready_at timestamptz not null default now(),
  jail_until      timestamptz not null default now(),
  hospital_until  timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create unique index players_nick_lower on players (lower(nick));

create table player_goods (
  player_id uuid not null references players(id) on delete cascade,
  good_id   text not null references goods(id),
  qty       int  not null check (qty >= 0),
  primary key (player_id, good_id)
);

create table player_cars (
  id         bigserial primary key,
  player_id  uuid not null references players(id) on delete cascade,
  car_id     text not null references cars(id),
  city_id    text not null references cities(id),
  created_at timestamptz not null default now()
);
create index on player_cars (player_id);

create table events (
  id         bigserial primary key,
  player_id  uuid not null references players(id) on delete cascade,
  text       text not null,
  created_at timestamptz not null default now()
);
create index on events (player_id, id desc);

-- ─────────────── Yardımcılar ───────────────
create or replace function rank_of(p_xp int) returns int
language sql stable as $$ select max(id) from ranks where min_xp <= p_xp $$;

-- Fiyat her saat değişir; şehir+mal+saat'ten türetilir, cron gerekmez.
create or replace function price_of(p_city text, p_good text, p_at timestamptz default now())
returns int language sql stable as $$
  select round(g.base_price * (0.55 + 0.9 *
           (abs(hashtext(p_city || ':' || p_good || ':' || floor(extract(epoch from p_at) / 3600)::text)) % 1000) / 1000.0
         ))::int
  from goods g where g.id = p_good
$$;

create or replace function log_event(p uuid, t text) returns void
language sql as $$ insert into events (player_id, text) values (p, t) $$;

-- Çağıran oyuncunun satırını kilitleyerek getirir (aynı anda iki istek yarışamasın).
create or replace function me_for_update() returns players
language plpgsql as $$
declare r players;
begin
  select * into r from players where id = auth.uid() for update;
  if not found then raise exception 'NO_PLAYER'; end if;
  return r;
end $$;

create or replace function secs_left(t timestamptz) returns int
language sql stable as $$ select greatest(0, ceil(extract(epoch from t - now())))::int $$;

create or replace function fmt_wait(t timestamptz) returns text
language sql stable as $$
  select case when secs_left(t) >= 60 then ceil(secs_left(t) / 60.0)::int || ' dk' else secs_left(t) || ' sn' end
$$;

-- Hapis/hastane: oyuncu aksiyon yapamıyorsa sebebini döner, yapabiliyorsa null.
create or replace function blocked_msg(p players) returns text
language sql stable as $$
  select case
    when p.jail_until > now()     then 'Hapistesin. ' || fmt_wait(p.jail_until) || ' kaldı.'
    when p.hospital_until > now() then 'Hastanedesin. ' || fmt_wait(p.hospital_until) || ' kaldı.'
  end
$$;

-- ─────────────── Oyun durumu ───────────────
create or replace function get_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p players; rk int;
begin
  select * into p from players where id = auth.uid();
  if not found then return jsonb_build_object('player', null); end if;
  rk := rank_of(p.xp);
  return jsonb_build_object(
    'now', now(),
    'travel_cost', setting('travel_cost'),
    'player', jsonb_build_object(
      'nick', p.nick, 'city', p.city_id, 'cash', p.cash, 'xp', p.xp,
      'rank', rk,
      'crime_ready_at', p.crime_ready_at, 'car_ready_at', p.car_ready_at,
      'travel_ready_at', p.travel_ready_at, 'jail_until', p.jail_until,
      'hospital_until', p.hospital_until),
    'ranks',  (select jsonb_agg(to_jsonb(r) order by r.id) from ranks r),
    'cities', (select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort) from cities c),
    'crimes', (select jsonb_agg(jsonb_build_object(
                  'id', c.id, 'name', c.name, 'min_rank', c.min_rank,
                  'reward_min', c.reward_min, 'reward_max', c.reward_max,
                  'chance', crime_chance(c, rk)) order by c.sort) from crimes c),
    'market', (select jsonb_agg(jsonb_build_object(
                  'id', g.id, 'name', g.name, 'price', price_of(p.city_id, g.id),
                  'qty', coalesce(pg.qty, 0)) order by g.sort)
               from goods g left join player_goods pg on pg.good_id = g.id and pg.player_id = p.id),
    'cars',   (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', pc.id, 'name', c.name, 'value', c.value, 'city', pc.city_id) order by pc.id desc), '[]')
               from player_cars pc join cars c on c.id = pc.car_id where pc.player_id = p.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('text', e.text, 'at', e.created_at) order by e.id desc), '[]')
               from (select * from events where player_id = p.id order by id desc limit 15) e)
  );
end $$;

create or replace function crime_chance(c crimes, rk int) returns numeric
language sql immutable as $$
  select least(0.92, c.base_rate + 0.03 * greatest(0, rk - c.min_rank))
$$;

-- ─────────────── Aksiyonlar ───────────────
create or replace function create_player(p_nick text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if exists (select 1 from players where id = auth.uid()) then raise exception 'ALREADY_EXISTS'; end if;
  if p_nick !~ '^[A-Za-z0-9ÇĞİÖŞÜçğıöşü_]{3,16}$' then
    return jsonb_build_object('ok', false, 'msg', 'Takma ad 3-16 harf/rakam olmalı.');
  end if;
  if exists (select 1 from players where lower(nick) = lower(p_nick)) then
    return jsonb_build_object('ok', false, 'msg', 'Bu takma ad alınmış.');
  end if;
  insert into players (id, nick, cash) values (auth.uid(), p_nick, setting('start_cash'));
  perform log_event(auth.uid(), 'İstanbul''a ayak bastın. Cebinde birkaç kuruş, gözünde büyük hayaller.');
  return jsonb_build_object('ok', true);
end $$;

create or replace function do_crime(p_crime text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; c crimes; rk int; reward int; xg int; msg text;
begin
  p := me_for_update();
  select * into c from crimes where id = p_crime;
  if not found then raise exception 'BAD_CRIME'; end if;
  if blocked_msg(p) is not null then return jsonb_build_object('ok', false, 'msg', blocked_msg(p)); end if;
  if p.crime_ready_at > now() then
    return jsonb_build_object('ok', false, 'msg', 'Biraz dinlen. ' || secs_left(p.crime_ready_at) || ' sn kaldı.');
  end if;
  rk := rank_of(p.xp);
  if rk < c.min_rank then return jsonb_build_object('ok', false, 'msg', 'Bu iş için rütben yetmiyor.'); end if;

  update players set crime_ready_at = now() + make_interval(secs => setting('crime_cooldown_s')) where id = p.id;

  -- ev_*: etkinlik çarpanları (018_events: polis baskını, altın saat); etkinlik yoksa 1
  if random() < crime_chance(c, rk) * ev_crime_chance(p.city_id) then
    reward := floor((c.reward_min + floor(random() * (c.reward_max - c.reward_min + 1))) * ev_crime_reward(p.city_id))::int;
    xg := round(c.xp * ev_crime_xp())::int;
    update players set cash = cash + reward, xp = xp + xg where id = p.id;
    msg := c.name || ': başarılı! $' || reward || ' kazandın.';
    if rank_of(p.xp + xg) > rk then
      msg := msg || ' Terfi ettin: ' || (select name from ranks where id = rank_of(p.xp + xg)) || '!';
    end if;
    perform log_event(p.id, msg);
    return jsonb_build_object('ok', true, 'success', true, 'msg', msg);
  elsif random() < 0.5 then
    update players set jail_until = now() + make_interval(secs => c.jail_s) where id = p.id;
    msg := c.name || ': polis yakaladı! ' || c.jail_s || ' sn hapis.';
    perform log_event(p.id, msg);
    return jsonb_build_object('ok', true, 'success', false, 'jailed', true, 'msg', msg);
  else
    msg := c.name || ': iş yaş, eli boş döndün ama kaçmayı başardın.';
    return jsonb_build_object('ok', true, 'success', false, 'msg', msg);
  end if;
end $$;

create or replace function steal_car() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; car cars; rk int; msg text;
begin
  p := me_for_update();
  if blocked_msg(p) is not null then return jsonb_build_object('ok', false, 'msg', blocked_msg(p)); end if;
  if p.car_ready_at > now() then
    return jsonb_build_object('ok', false, 'msg', 'Ortalık hâlâ sıcak. ' || secs_left(p.car_ready_at) || ' sn bekle.');
  end if;
  rk := rank_of(p.xp);
  update players set car_ready_at = now() + make_interval(secs => setting('car_cooldown_s')) where id = p.id;

  if random() < least(0.85, 0.5 + 0.035 * rk) then
    -- ağırlıklı rastgele seçim
    select * into car from cars order by -ln(1 - random()) / weight limit 1;
    insert into player_cars (player_id, car_id, city_id) values (p.id, car.id, p.city_id);
    update players set xp = xp + 8 where id = p.id;
    msg := 'Bir ' || car.name || ' çaldın! (değeri $' || car.value || ')';
    perform log_event(p.id, msg);
    return jsonb_build_object('ok', true, 'success', true, 'msg', msg);
  else
    update players set jail_until = now() + make_interval(secs => setting('car_fail_jail_s')) where id = p.id;
    msg := 'Araba sahibi bağırdı, bekçi yakaladı! ' || setting('car_fail_jail_s') || ' sn hapis.';
    perform log_event(p.id, msg);
    return jsonb_build_object('ok', true, 'success', false, 'jailed', true, 'msg', msg);
  end if;
end $$;

create or replace function sell_car(p_car_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; v int; nm text;
begin
  p := me_for_update();
  select c.value, c.name into v, nm from player_cars pc join cars c on c.id = pc.car_id
   where pc.id = p_car_id and pc.player_id = p.id and pc.city_id = p.city_id;
  if not found then return jsonb_build_object('ok', false, 'msg', 'Bu araba burada değil.'); end if;
  delete from player_cars where id = p_car_id;
  update players set cash = cash + v where id = p.id;
  return jsonb_build_object('ok', true, 'msg', nm || ' satıldı: $' || v);
end $$;

create or replace function travel(p_city text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; cost int := setting('travel_cost'); cname text; msg text; has_goods boolean;
begin
  p := me_for_update();
  select name into cname from cities where id = p_city;
  if not found then raise exception 'BAD_CITY'; end if;
  if p_city = p.city_id then return jsonb_build_object('ok', false, 'msg', 'Zaten buradasın.'); end if;
  if blocked_msg(p) is not null then return jsonb_build_object('ok', false, 'msg', blocked_msg(p)); end if;
  if p.travel_ready_at > now() then
    return jsonb_build_object('ok', false, 'msg', 'Sıradaki vapur ' || secs_left(p.travel_ready_at) || ' sn sonra.');
  end if;
  if p.cash < cost then return jsonb_build_object('ok', false, 'msg', 'Bilet için $' || cost || ' lazım.'); end if;

  update players set cash = cash - cost, city_id = p_city,
    travel_ready_at = now() + make_interval(secs => setting('travel_cooldown_s')) where id = p.id;
  msg := 'Vapur ' || cname || ' limanına yanaştı.';

  select exists (select 1 from player_goods where player_id = p.id and qty > 0) into has_goods;
  if has_goods and random() < setting('customs_chance') then
    update player_goods set qty = 0 where player_id = p.id;
    msg := msg || ' Ama gümrük bütün kaçak malına el koydu!';
  end if;
  perform log_event(p.id, msg);
  return jsonb_build_object('ok', true, 'msg', msg);
end $$;

-- p_qty > 0 alış, < 0 satış
create or replace function trade(p_good text, p_qty int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; price int; held int; total_held int; cap int; amount bigint; gname text;
begin
  p := me_for_update();
  if p_qty = 0 or abs(p_qty) > 1000 then raise exception 'BAD_QTY'; end if;
  select name into gname from goods where id = p_good;
  if not found then raise exception 'BAD_GOOD'; end if;
  if blocked_msg(p) is not null then return jsonb_build_object('ok', false, 'msg', blocked_msg(p)); end if;
  price := price_of(p.city_id, p_good);
  select coalesce(qty, 0) into held from player_goods where player_id = p.id and good_id = p_good;
  held := coalesce(held, 0);
  amount := price::bigint * abs(p_qty);

  if p_qty > 0 then
    select coalesce(sum(qty), 0) into total_held from player_goods where player_id = p.id;
    select carry into cap from ranks where id = rank_of(p.xp);
    if total_held + p_qty > cap then
      return jsonb_build_object('ok', false, 'msg', 'En fazla ' || cap || ' kasa taşıyabilirsin.');
    end if;
    if p.cash < amount then return jsonb_build_object('ok', false, 'msg', 'Paran yetmiyor.'); end if;
    update players set cash = cash - amount where id = p.id;
  else
    if held < -p_qty then return jsonb_build_object('ok', false, 'msg', 'Elinde o kadar yok.'); end if;
    update players set cash = cash + amount where id = p.id;
  end if;

  insert into player_goods (player_id, good_id, qty) values (p.id, p_good, held + p_qty)
    on conflict (player_id, good_id) do update set qty = excluded.qty;
  return jsonb_build_object('ok', true, 'msg',
    abs(p_qty) || ' kasa ' || gname || (case when p_qty > 0 then ' alındı' else ' satıldı' end) || ' ($' || amount || ').');
end $$;

-- ─────────────── Güvenlik ───────────────
alter table game_settings enable row level security;
alter table ranks         enable row level security;
alter table cities        enable row level security;
alter table goods         enable row level security;
alter table crimes        enable row level security;
alter table cars          enable row level security;
alter table players       enable row level security;
alter table player_goods  enable row level security;
alter table player_cars   enable row level security;
alter table events        enable row level security;
-- Politika yok = istemci tablolara doğrudan erişemez; her şey aşağıdaki RPC'lerden geçer.

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function get_state(), create_player(text), do_crime(text), steal_car(),
  sell_car(bigint), travel(text), trade(text, int) to authenticated;
