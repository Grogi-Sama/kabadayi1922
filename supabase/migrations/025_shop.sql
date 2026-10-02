-- 025: Mağaza, kulüp üyeliği, hızlandırma.
-- • Özel portreler (9–16) ve aile armaları (9–16): sadece kozmetik, güç vermez. Girişte çıkmaz; değiştirme ekranında kilitli görünür.
-- • Kulüp (aylık): sohbette altın isim + rozet, günde birkaç ücretsiz hızlandırma, her ay bir özel portre ya da arma.
-- • Hızlandırma: bir bekleme süresini (iş, araba, vapur, adam eğitimi) yarıya indirir. Reklamla (günde sınırlı),
--   jetonla (satın alınır) ya da kulüp hakkıyla. Hapis ve hastane hızlanmaz. Günlük toplam tavan var.
-- • Satın alma: ödeme mağaza aşamasında (Capacitor + Google Play / App Store) bağlanacak; doğrulanan ödeme
--   grant_product() ile işlenir. Bu fonksiyon istemciye açık DEĞİL. Test için admin_grant (sadece Admin).

insert into game_settings values
  ('ads_enabled',        0),     -- reklam altyapısı gelince 1
  ('ad_boosts_daily',    8),
  ('club_boosts_daily',  5),
  ('boost_daily_cap',   15),     -- her kaynaktan toplam günlük hızlandırma
  ('boost_share',      0.5),     -- kalan sürenin bu kadarı silinir
  ('club_days',         30)
on conflict (key) do update set value = excluded.value;

create table products (
  id        text primary key,
  kind      text not null check (kind in ('portrait', 'crest', 'club', 'boosts')),
  name      text not null,
  price_try numeric not null,          -- gösterim fiyatı (₺); asıl fiyatı mağaza belirler
  ref       int,                       -- portre/arma numarası ya da jeton adedi
  gender    text,                      -- portre: e / k
  sort      int not null
);
insert into products values
  ('portrait_9',  'portrait', 'Paşa',               29.99,  9, 'e', 1),
  ('portrait_10', 'portrait', 'Gazino Sahibi',      29.99, 10, 'e', 2),
  ('portrait_11', 'portrait', 'Kaçakçı Kaptan',     29.99, 11, 'e', 3),
  ('portrait_12', 'portrait', 'Boksör',             29.99, 12, 'e', 4),
  ('portrait_13', 'portrait', 'Caz Şarkıcısı',      29.99, 13, 'k', 5),
  ('portrait_14', 'portrait', 'Aristokrat Hanım',   29.99, 14, 'k', 6),
  ('portrait_15', 'portrait', 'Falcı',              29.99, 15, 'k', 7),
  ('portrait_16', 'portrait', 'Pilot Hanım',        29.99, 16, 'k', 8),
  ('crest_9',  'crest', 'Çift Başlı Kartal',  49.99,  9, null, 11),
  ('crest_10', 'crest', 'Kılıçlı Aslan',      49.99, 10, null, 12),
  ('crest_11', 'crest', 'Hançer ve Yılan',    49.99, 11, null, 13),
  ('crest_12', 'crest', 'Hilal ve Yıldızlar', 49.99, 12, null, 14),
  ('crest_13', 'crest', 'Kuzgun',             49.99, 13, null, 15),
  ('crest_14', 'crest', 'Çapa ve Tabancalar', 49.99, 14, null, 16),
  ('crest_15', 'crest', 'Anka',               49.99, 15, null, 17),
  ('crest_16', 'crest', 'Kurt',               49.99, 16, null, 18),
  ('club',       'club',   'Kabadayı Kulübü (30 gün)', 79.99, 30, null, 21),
  ('boosts_10',  'boosts', '10 Hızlandırma Jetonu',    19.99, 10, null, 31),
  ('boosts_50',  'boosts', '50 Hızlandırma Jetonu',    69.99, 50, null, 32)
on conflict (id) do nothing;

create table player_items (
  player_id   uuid not null references players(id) on delete cascade,
  product_id  text not null references products(id),
  acquired_at timestamptz not null default now(),
  primary key (player_id, product_id)
);
create table purchases (
  id         bigserial primary key,
  player_id  uuid references players(id) on delete set null,
  product_id text not null references products(id),
  source     text not null check (source in ('store', 'admin', 'club')),
  receipt    text,                    -- mağaza makbuzu (ileride)
  created_at timestamptz not null default now()
);
create table boost_log (
  player_id uuid not null references players(id) on delete cascade,
  day       date not null,
  via       text not null check (via in ('ad', 'token', 'club')),
  n         int not null default 0,
  primary key (player_id, day, via)
);
alter table products     enable row level security;
alter table player_items enable row level security;
alter table purchases    enable row level security;
alter table boost_log    enable row level security;

alter table players add column if not exists club_until   timestamptz;
alter table players add column if not exists club_pick_at timestamptz;   -- kulübün aylık ücretsiz kozmetiği
alter table players add column if not exists boost_tokens int not null default 0;
alter table players drop constraint if exists players_avatar_check;
alter table players add constraint players_avatar_check check (avatar between 1 and 16);
alter table families drop constraint if exists families_crest_check;
alter table families add constraint families_crest_check check (crest between 0 and 16);

create or replace function club_active(pid uuid) returns boolean
language sql stable as $$ select coalesce((select club_until > now() from players where id = pid), false) $$;

create or replace function owns(pid uuid, prod text) returns boolean
language sql stable as $$ select exists (select 1 from player_items where player_id = pid and product_id = prod) $$;

-- Ödemesi doğrulanmış ürünü işler (istemciye kapalı)
create or replace function grant_product(pid uuid, prod text, src text, p_receipt text default null) returns void
language plpgsql security definer set search_path = public as $$
declare pr products;
begin
  select * into pr from products where id = prod;
  if pr.id is null then raise exception 'BAD_PRODUCT'; end if;
  insert into purchases (player_id, product_id, source, receipt) values (pid, prod, src, p_receipt);
  if pr.kind in ('portrait', 'crest') then
    insert into player_items (player_id, product_id) values (pid, prod) on conflict do nothing;
  elsif pr.kind = 'club' then
    update players set club_until = greatest(coalesce(club_until, now()), now()) + make_interval(days => pr.ref) where id = pid;
    perform log_event(pid, 'Kabadayı Kulübü üyeliğin başladı. Hoş geldin!');
  elsif pr.kind = 'boosts' then
    update players set boost_tokens = boost_tokens + pr.ref where id = pid;
  end if;
end $$;

-- Test/hediye: sadece Admin
create or replace function admin_grant(p_nick text, p_product text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t players;
begin
  perform require_owner();
  t := player_by_nick(p_nick);
  if t.id is null then return fail('Böyle bir oyuncu yok.'); end if;
  perform grant_product(t.id, p_product, 'admin');
  return done(t.nick || ' oyuncusuna ' || (select name from products where id = p_product) || ' verildi.');
end $$;

-- Kulüp: ayda bir özel portre ya da arma hediye
create or replace function club_claim(p_product text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; pr products;
begin
  p := me_for_update();
  if not club_active(p.id) then return fail('Bu hediye Kulüp üyelerine özel.'); end if;
  if p.club_pick_at > now() - make_interval(days => setting('club_days')::int) then
    return fail('Bu ayın hediyesini aldın. Sıradaki: ' || to_char(p.club_pick_at + make_interval(days => setting('club_days')::int), 'DD.MM.YYYY') || '.');
  end if;
  select * into pr from products where id = p_product and kind in ('portrait', 'crest');
  if pr.id is null then return fail('Bu ürün hediye olarak seçilemez.'); end if;
  if owns(p.id, pr.id) then return fail('Bu zaten sende.'); end if;
  perform grant_product(p.id, pr.id, 'club');
  update players set club_pick_at = now() where id = p.id;
  return done(pr.name || ' artık senin. Kulübe hoş geldin!');
end $$;

-- ─────────────── Hızlandırma ───────────────
create or replace function boosts_today(pid uuid, p_via text default null) returns int
language sql stable as $$
  select coalesce(sum(n), 0)::int from boost_log where player_id = pid and day = (now() at time zone 'Europe/Istanbul')::date
    and (p_via is null or via = p_via)
$$;

create or replace function use_boost(p_target text, p_via text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; share numeric := setting('boost_share'); ready timestamptz; n int; label text;
begin
  p := me_for_update();
  if p_via not in ('ad', 'token', 'club') then raise exception 'BAD_VIA'; end if;
  if boosts_today(p.id) >= setting('boost_daily_cap') then return fail('Bugünlük hızlandırma hakkın doldu.'); end if;
  if p_via = 'ad' then
    if setting('ads_enabled') = 0 then return fail('Reklamla hızlandırma çok yakında.'); end if;
    if boosts_today(p.id, 'ad') >= setting('ad_boosts_daily') then return fail('Bugünkü reklam hakların bitti.'); end if;
  elsif p_via = 'club' then
    if not club_active(p.id) then return fail('Kulüp hakkı sadece üyelere.'); end if;
    if boosts_today(p.id, 'club') >= setting('club_boosts_daily') then return fail('Bugünkü kulüp hakların bitti.'); end if;
  elsif p.boost_tokens < 1 then return fail('Hızlandırma jetonun yok.');
  end if;

  if p_target like 'crime:%' then
    ready := cooldown_left(p.id, p_target);
    if ready is null then return fail('Bu iş zaten hazır.'); end if;
    update player_cooldowns set ready_at = now() + (ready_at - now()) * (1 - share) where player_id = p.id and kind = p_target;
    label := (select name from crimes where 'crime:' || id = p_target);
  elsif p_target = 'car' then
    if p.car_ready_at <= now() then return fail('Araba zaten hazır.'); end if;
    update players set car_ready_at = now() + (car_ready_at - now()) * (1 - share) where id = p.id; label := 'Araba';
  elsif p_target = 'travel' then
    if p.travel_ready_at <= now() then return fail('Vapur zaten hazır.'); end if;
    update players set travel_ready_at = now() + (travel_ready_at - now()) * (1 - share) where id = p.id; label := 'Sefer';
  elsif p_target = 'men' then
    update player_men set ready_at = now() + (ready_at - now()) * (1 - share) where player_id = p.id and ready_at > now();
    get diagnostics n = row_count;
    if n = 0 then return fail('Eğitimde adamın yok.'); end if;
    label := 'Adam eğitimi';
  else raise exception 'BAD_TARGET';
  end if;

  if p_via = 'token' then update players set boost_tokens = boost_tokens - 1 where id = p.id; end if;
  insert into boost_log values (p.id, (now() at time zone 'Europe/Istanbul')::date, p_via, 1)
    on conflict (player_id, day, via) do update set n = boost_log.n + 1;
  return done(label || ' hızlandı: kalan süre yarıya indi.');
end $$;

-- ─────────────── Mağaza ekranı ───────────────
create or replace function get_shop() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p players;
begin
  select * into p from players where id = auth.uid();
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  return jsonb_build_object(
    'products', (select jsonb_agg(jsonb_build_object('id', pr.id, 'kind', pr.kind, 'name', pr.name, 'price', pr.price_try,
        'ref', pr.ref, 'gender', pr.gender, 'owned', owns(p.id, pr.id)) order by pr.sort) from products pr),
    'club_until', case when p.club_until > now() then p.club_until end,
    'club_gift_ready', club_active(p.id) and (p.club_pick_at is null or p.club_pick_at <= now() - make_interval(days => setting('club_days')::int)),
    'tokens', p.boost_tokens,
    'ads_enabled', setting('ads_enabled') = 1,
    'ad_left', greatest(0, setting('ad_boosts_daily') - boosts_today(p.id, 'ad')),
    'club_left', case when club_active(p.id) then greatest(0, setting('club_boosts_daily') - boosts_today(p.id, 'club')) else 0 end,
    'today_left', greatest(0, setting('boost_daily_cap') - boosts_today(p.id)));
end $$;

-- ─────────────── Kozmetik kuralları ───────────────
-- Portre: 1–4 erkek, 5–8 kadın (ücretsiz); 9–12 erkek, 13–16 kadın (mağaza)
create or replace function avatar_fits(p_gender text, p_avatar int) returns boolean
language sql immutable as $$
  select case when p_gender = 'k' then p_avatar between 5 and 8 or p_avatar between 13 and 16
              else p_avatar between 1 and 4 or p_avatar between 9 and 12 end
$$;

-- Girişte sadece ücretsiz portreler
create or replace function create_character(p_nick text, p_gender text, p_avatar int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if p_gender not in ('e', 'k') then return fail('Cinsiyetini seç.'); end if;
  if p_avatar > 8 or not avatar_fits(p_gender, p_avatar) then return fail('Bu portre seçtiğin cinsiyete uygun değil.'); end if;
  r := create_player(p_nick);
  if (r->>'ok')::boolean then update players set gender = p_gender, avatar = p_avatar where id = auth.uid(); end if;
  return r;
end $$;

-- Portre değiştirme: özel portre sahip olunmalı (022'deki set_avatar'ın yerine)
create or replace function set_avatar(p_avatar int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players;
begin
  p := me_for_update();
  if p_avatar not between 1 and 16 then raise exception 'BAD_AVATAR'; end if;
  if p.gender is not null and not avatar_fits(p.gender, p_avatar) then return fail('Bu portre cinsiyetine uygun değil.'); end if;
  if p_avatar > 8 and not owns(p.id, 'portrait_' || p_avatar) then return fail('Bu portre mağazada; önce satın almalısın.'); end if;
  update players set avatar = p_avatar where id = p.id;
  return done('Portren değişti.');
end $$;

-- Arma: özel armayı Don'un satın almış olması gerekir
alter function set_family_crest(int) rename to set_family_crest_core;
create or replace function set_family_crest(p_crest int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players;
begin
  if p_crest between 9 and 16 then
    p := me_for_update();
    if p.family_id is null then return fail('Bir ailen yok.'); end if;
    if p.family_role <> 'don' then return fail('Armayı sadece Don seçer.'); end if;
    if not owns(p.id, 'crest_' || p_crest) then return fail('Bu arma mağazada; önce satın almalısın.'); end if;
    update families set crest = p_crest where id = p.family_id;
    return done('Ailenin arması değişti.');
  end if;
  return set_family_crest_core(p_crest);
end $$;

-- ─────────────── Kulüp görünürlüğü: sohbet, profil, durum ───────────────
alter function get_chat(text) rename to get_chat_core;
create or replace function get_chat(p_channel text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(m || jsonb_build_object('club',
           coalesce((select club_until > now() from players where nick = m->>'nick'), false)) order by i), '[]')
  from jsonb_array_elements(get_chat_core(p_channel)) with ordinality t(m, i)
$$;

alter function get_profile(text) rename to profile_spouse;
create or replace function get_profile(p_nick text) returns jsonb
language sql stable security definer set search_path = public as $$
  select profile_spouse(p_nick) || jsonb_build_object('club',
    coalesce((select club_until > now() from players where lower(nick) = lower(p_nick)), false))
$$;

alter function get_state() rename to state_spouse;
create or replace function get_state() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare base jsonb := state_spouse();
begin
  if base->'player' is null or base->'player' = 'null'::jsonb then return base; end if;
  return jsonb_set(base, '{player}', (base->'player') || (select jsonb_build_object(
    'club', club_until > now(), 'club_until', case when club_until > now() then club_until end, 'boost_tokens', boost_tokens,
    'items', (select coalesce(jsonb_agg(product_id), '[]') from player_items where player_id = auth.uid()))
    from players where id = auth.uid()));
end $$;

-- Sezon sonunda satın alınanlar kalır (kozmetik ve jeton silinmez)
insert into api_rpcs values ('get_shop()'), ('use_boost(text, text)'), ('club_claim(text)'), ('admin_grant(text, text)');
select apply_grants();
