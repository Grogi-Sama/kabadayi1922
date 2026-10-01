-- Faz 2B: aileler (başvuru, roller, kasa, sohbet), aile mülkü kurşun fabrikaları, kelle listesi.

insert into game_settings values
  ('family_create_cost', 50000),
  ('family_create_rank',     5),     -- Külhanbeyi
  ('family_max_members',    30),
  ('factory_price',     250000),
  ('bounty_min',          5000),
  ('bounty_fee',          0.10),
  ('bounty_days',         7);     -- süresi dolan ödül, koyanın bankasına geri döner (aracı payı dönmez)

create table families (
  id         bigserial primary key,
  name       text not null check (name ~ '^[A-Za-z0-9ÇĞİÖŞÜçğıöşü _-]{3,20}$'),
  bank       bigint not null default 0 check (bank >= 0),
  created_at timestamptz not null default now()
);
create unique index families_name_lower on families (lower(name));

alter table players
  add column family_id   bigint references families(id) on delete set null,
  add column family_role text check (family_role in ('don', 'sottocapo', 'consigliere', 'capo', 'asker'));

create table family_applications (
  player_id  uuid primary key references players(id) on delete cascade,  -- aynı anda tek başvuru
  family_id  bigint not null references families(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table family_messages (
  id         bigserial primary key,
  family_id  bigint not null references families(id) on delete cascade,
  player_id  uuid references players(id) on delete set null,
  text       text not null check (length(text) between 1 and 300),
  created_at timestamptz not null default now()
);
create index on family_messages (family_id, id desc);

alter table city_bullets add column owner_family bigint references families(id) on delete set null;

create table bounties (
  id         bigserial primary key,
  target_id  uuid not null references players(id) on delete cascade,
  placer_id  uuid references players(id) on delete set null,
  amount     bigint not null check (amount > 0),
  created_at timestamptz not null default now(),
  claimed_by uuid references players(id) on delete set null,
  claimed_at timestamptz,
  refunded_at timestamptz         -- süresi dolup iade edildiyse
);
create index on bounties (target_id) where claimed_by is null and refunded_at is null;

alter table families            enable row level security;
alter table family_applications enable row level security;
alter table family_messages     enable row level security;
alter table bounties            enable row level security;

-- ─────────────── Yardımcılar ───────────────
create or replace function is_leader(p players) returns boolean
language sql immutable as $$ select p.family_role in ('don', 'sottocapo', 'consigliere') $$;

create or replace function can_manage_money(p players) returns boolean
language sql immutable as $$ select p.family_role in ('don', 'sottocapo') $$;

create or replace function family_msg(fid bigint, pid uuid, t text) returns void
language sql as $$ insert into family_messages (family_id, player_id, text) values (fid, pid, t) $$;

create or replace function fail(m text) returns jsonb
language sql immutable as $$ select jsonb_build_object('ok', false, 'msg', m) $$;

create or replace function done(m text) returns jsonb
language sql immutable as $$ select jsonb_build_object('ok', true, 'msg', m) $$;

-- ─────────────── Kurma / başvuru / ayrılma ───────────────
create or replace function create_family(p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; fid bigint; cost int := setting('family_create_cost');
begin
  p := me_for_update();
  if p.family_id is not null then return fail('Zaten bir ailedesin.'); end if;
  if rank_of(p.xp) < setting('family_create_rank') then
    return fail('Aile kurmak için ' || (select name from ranks where id = setting('family_create_rank')) || ' olmalısın.');
  end if;
  if trim(p_name) !~ '^[A-Za-z0-9ÇĞİÖŞÜçğıöşü _-]{3,20}$' then return fail('Aile adı 3-20 karakter olmalı.'); end if;
  if exists (select 1 from families where lower(name) = lower(trim(p_name))) then return fail('Bu isimde bir aile var.'); end if;
  if p.cash < cost then return fail('Aile kurmak $' || cost || ' tutar.'); end if;
  insert into families (name) values (trim(p_name)) returning id into fid;
  update players set cash = cash - cost, family_id = fid, family_role = 'don' where id = p.id;
  delete from family_applications where player_id = p.id;
  perform family_msg(fid, null, p.nick || ' aileyi kurdu.');
  perform log_event(p.id, trim(p_name) || ' ailesini kurdun. Artık Don''sun.');
  return done(trim(p_name) || ' ailesi kuruldu!');
end $$;

create or replace function apply_family(p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; f families;
begin
  p := me_for_update();
  if p.family_id is not null then return fail('Zaten bir ailedesin.'); end if;
  select * into f from families where lower(name) = lower(trim(p_name));
  if not found then return fail('Böyle bir aile yok.'); end if;
  insert into family_applications (player_id, family_id) values (p.id, f.id)
    on conflict (player_id) do update set family_id = excluded.family_id, created_at = now();
  return done(f.name || ' ailesine başvurdun.');
end $$;

create or replace function cancel_application() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  delete from family_applications where player_id = auth.uid();
  return done('Başvuru geri çekildi.');
end $$;

create or replace function answer_application(p_nick text, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; t players;
begin
  p := me_for_update();
  if not is_leader(p) then return fail('Bunu sadece aile yönetimi yapabilir.'); end if;
  select * into t from players where lower(nick) = lower(p_nick) for update;
  if not found or not exists (select 1 from family_applications where player_id = t.id and family_id = p.family_id) then
    return fail('Böyle bir başvuru yok.');
  end if;
  delete from family_applications where player_id = t.id;
  if not p_accept then
    perform log_event(t.id, 'Aile başvurun reddedildi.');
    return done('Başvuru reddedildi.');
  end if;
  if t.family_id is not null then return fail(t.nick || ' başka bir aileye girmiş.'); end if;
  if (select count(*) from players where family_id = p.family_id) >= setting('family_max_members') then
    return fail('Aile dolu.');
  end if;
  update players set family_id = p.family_id, family_role = 'asker' where id = t.id;
  perform family_msg(p.family_id, null, t.nick || ' aileye katıldı.');
  perform log_event(t.id, (select name from families where id = p.family_id) || ' ailesine kabul edildin!');
  return done(t.nick || ' aileye alındı.');
end $$;

create or replace function leave_family() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; others int; fname text;
begin
  p := me_for_update();
  if p.family_id is null then return fail('Bir ailede değilsin.'); end if;
  select count(*) into others from players where family_id = p.family_id and id <> p.id;
  if p.family_role = 'don' and others > 0 then return fail('Don aileyi bırakamaz; önce Donluğu devret.'); end if;
  select name into fname from families where id = p.family_id;
  update players set family_id = null, family_role = null where id = p.id;
  if others = 0 then
    delete from families where id = p.family_id;   -- kasa da yok olur
    return done(fname || ' ailesi dağıldı.');
  end if;
  perform family_msg(p.family_id, null, p.nick || ' aileden ayrıldı.');
  return done('Aileden ayrıldın.');
end $$;

create or replace function kick_member(p_nick text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; t players;
begin
  p := me_for_update();
  if p.family_role not in ('don', 'sottocapo') then return fail('Bunu sadece Don ve Sottocapo yapabilir.'); end if;
  select * into t from players where lower(nick) = lower(p_nick) and family_id = p.family_id for update;
  if not found then return fail('Ailede böyle biri yok.'); end if;
  if t.id = p.id or t.family_role = 'don' or (t.family_role = 'sottocapo' and p.family_role <> 'don') then
    return fail('Bu kişiyi atamazsın.');
  end if;
  update players set family_id = null, family_role = null where id = t.id;
  perform family_msg(p.family_id, null, t.nick || ' aileden atıldı.');
  perform log_event(t.id, 'Aileden atıldın.');
  return done(t.nick || ' aileden atıldı.');
end $$;

-- Sadece Don. 'don' verilirse Donluk devredilir, eski Don Sottocapo olur.
create or replace function set_role(p_nick text, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; t players;
begin
  p := me_for_update();
  if p.family_role <> 'don' then return fail('Rolleri sadece Don belirler.'); end if;
  if p_role not in ('don', 'sottocapo', 'consigliere', 'capo', 'asker') then raise exception 'BAD_ROLE'; end if;
  select * into t from players where lower(nick) = lower(p_nick) and family_id = p.family_id for update;
  if not found or t.id = p.id then return fail('Ailede böyle biri yok.'); end if;
  if p_role in ('sottocapo', 'consigliere')
     and exists (select 1 from players where family_id = p.family_id and family_role = p_role and id <> t.id) then
    return fail('Ailede zaten bir ' || initcap(p_role) || ' var.');
  end if;
  if p_role = 'don' then
    update players set family_role = 'sottocapo' where id = p.id;
    update players set family_role = 'asker' where family_id = p.family_id and family_role = 'sottocapo' and id not in (p.id, t.id);
  end if;
  update players set family_role = p_role where id = t.id;
  perform family_msg(p.family_id, null, t.nick || ' artık ' || initcap(p_role) || '.');
  return done(t.nick || ' → ' || initcap(p_role));
end $$;

-- ─────────────── Kasa ───────────────
create or replace function family_deposit(p_amount bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players;
begin
  p := me_for_update();
  if p_amount <= 0 then raise exception 'BAD_AMOUNT'; end if;
  if p.family_id is null then return fail('Bir ailede değilsin.'); end if;
  if p.cash < p_amount then return fail('Cebinde o kadar yok.'); end if;
  update players set cash = cash - p_amount where id = p.id;
  update families set bank = bank + p_amount where id = p.family_id;
  perform family_msg(p.family_id, null, p.nick || ' kasaya $' || p_amount || ' koydu.');
  return done('Aile kasasına $' || p_amount || ' koydun.');
end $$;

create or replace function family_pay(p_nick text, p_amount bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; t players; f families;
begin
  p := me_for_update();
  if p_amount <= 0 then raise exception 'BAD_AMOUNT'; end if;
  if not can_manage_money(p) then return fail('Kasayı sadece Don ve Sottocapo kullanır.'); end if;
  select * into f from families where id = p.family_id for update;
  if f.bank < p_amount then return fail('Kasada o kadar yok.'); end if;
  select * into t from players where lower(nick) = lower(p_nick) and family_id = p.family_id for update;
  if not found then return fail('Ailede böyle biri yok.'); end if;
  update families set bank = bank - p_amount where id = f.id;
  update players set cash = cash + p_amount where id = t.id;
  perform family_msg(f.id, null, p.nick || ', ' || t.nick || ' için kasadan $' || p_amount || ' çıkardı.');
  perform log_event(t.id, 'Aile kasasından sana $' || p_amount || ' verildi.');
  return done('Ödeme yapıldı.');
end $$;

-- ─────────────── Sohbet ───────────────
create or replace function post_family_message(p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; t text := trim(p_text);
begin
  select * into p from players where id = auth.uid();
  if p.family_id is null then return fail('Bir ailede değilsin.'); end if;
  if length(t) = 0 then return fail('Boş mesaj.'); end if;
  if length(t) > 300 then return fail('Mesaj en fazla 300 karakter.'); end if;
  -- basit sel koruması: 10 saniyede en fazla 3 mesaj
  if (select count(*) from family_messages where player_id = p.id and created_at > now() - interval '10 seconds') >= 3 then
    return fail('Biraz yavaş.');
  end if;
  perform family_msg(p.family_id, p.id, t);
  return jsonb_build_object('ok', true);
end $$;

-- ─────────────── Fabrika ───────────────
create or replace function buy_factory() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; f families; price int := setting('factory_price'); cname text;
begin
  p := me_for_update();
  if not can_manage_money(p) then return fail('Fabrikayı sadece Don ve Sottocapo alabilir.'); end if;
  if (select owner_family from city_bullets where city_id = p.city_id for update) is not null then
    return fail('Bu şehrin fabrikasının zaten sahibi var.');
  end if;
  select * into f from families where id = p.family_id for update;
  if f.bank < price then return fail('Aile kasasında $' || price || ' olmalı.'); end if;
  select name into cname from cities where id = p.city_id;
  update families set bank = bank - price where id = f.id;
  update city_bullets set owner_family = f.id where city_id = p.city_id;
  perform family_msg(f.id, null, cname || ' kurşun fabrikası artık bizim!');
  return done(cname || ' kurşun fabrikası ailenin oldu.');
end $$;

create or replace function set_factory_price(p_price int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players;
begin
  select * into p from players where id = auth.uid();
  if not can_manage_money(p) then return fail('Fiyatı sadece Don ve Sottocapo belirler.'); end if;
  if p_price < 2 or p_price > 20 then return fail('Fiyat $2 ile $20 arasında olmalı.'); end if;
  update city_bullets set price = p_price where city_id = p.city_id and owner_family = p.family_id;
  if not found then return fail('Bu şehrin fabrikası ailenin değil.'); end if;
  return done('Kurşun fiyatı $' || p_price || ' oldu.');
end $$;

-- Sahipli fabrikada fiyat sabit kalır (sahibi belirler); sadece stok dolar.
create or replace function restock_bullets(p_city text) returns city_bullets
language plpgsql as $$
declare f city_bullets; periods int; step numeric := setting('bullet_restock_s');
begin
  select * into f from city_bullets where city_id = p_city for update;
  periods := floor(extract(epoch from now() - f.restocked_at) / step);
  if periods > 0 then
    update city_bullets set
      stock = least(setting('bullet_stock_cap'), stock + periods * setting('bullet_restock_qty')),
      price = case when owner_family is null then 4 + floor(random() * 7)::int else price end,
      restocked_at = restocked_at + make_interval(secs => periods * step)
    where city_id = p_city returning * into f;
  end if;
  return f;
end $$;

-- Kurşun satışının geliri fabrika sahibi ailenin kasasına gider.
alter function buy_bullets(int) rename to buy_bullets_core;
create or replace function buy_bullets(p_qty int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; f city_bullets; city text;
begin
  select city_id into city from players where id = auth.uid();
  select * into f from city_bullets where city_id = city;
  r := buy_bullets_core(p_qty);
  if (r->>'ok')::boolean and f.owner_family is not null then
    -- sahipli fabrikada fiyat dolumda değişmez, yani satış fiyatı budur
    update families set bank = bank + p_qty::bigint * (select price from city_bullets where city_id = city)
      where id = f.owner_family;
  end if;
  return r;
end $$;

-- ─────────────── Kelle listesi ───────────────
create or replace function place_bounty(p_nick text, p_amount bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; t players; fee bigint;
begin
  p := me_for_update();
  if blocked_msg(p) is not null then return fail(blocked_msg(p)); end if;
  if p_amount < setting('bounty_min') then return fail('En az $' || setting('bounty_min') || ' koymalısın.'); end if;
  t := player_by_nick(p_nick);
  if t.id is null or t.id = p.id then return fail('Geçersiz hedef.'); end if;
  if rank_of(t.xp) < setting('protect_rank') then return fail('Çaylakların başına ödül konmaz.'); end if;
  fee := ceil(p_amount * setting('bounty_fee'));
  if p.cash < p_amount + fee then return fail('Ödül + %10 aracı payı: $' || (p_amount + fee)); end if;
  update players set cash = cash - p_amount - fee where id = p.id;
  insert into bounties (target_id, placer_id, amount) values (t.id, p.id, p_amount);
  perform log_event(t.id, 'Birisi başına $' || p_amount || ' ödül koydu!');
  return done(t.nick || ' kelle listesine eklendi ($' || p_amount || ').');
end $$;

create or replace function expire_bounties() returns void
language plpgsql security definer set search_path = public as $$
declare b record;
begin
  for b in update bounties set refunded_at = now()
             where claimed_by is null and refunded_at is null
               and created_at < now() - make_interval(days => setting('bounty_days')::int)
             returning placer_id, target_id, amount loop
    if b.placer_id is not null then
      update players set bank = bank + b.amount where id = b.placer_id;
      perform log_event(b.placer_id, (select nick from players where id = b.target_id)
        || ' için koyduğun $' || b.amount || ' kelle ödülünün süresi doldu; para bankana iade edildi.');
    end if;
  end loop;
end $$;

create or replace function get_hitlist() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform expire_bounties();
  return (select coalesce(jsonb_agg(jsonb_build_object('nick', t.nick, 'rank', rank_of(t.xp), 'amount', b.total,
            'expires_at', b.first_at + make_interval(days => setting('bounty_days')::int)) order by b.total desc), '[]')
          from (select target_id, sum(amount) total, min(created_at) first_at from bounties
                 where claimed_by is null and refunded_at is null group by target_id) b
          join players t on t.id = b.target_id);
end $$;

-- shoot'u sar: aile içi ateş yasak; öldürünce ödülleri topla.
alter function shoot(text, int) rename to shoot_core;
create or replace function shoot(p_nick text, p_bullets int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me players; t players; r jsonb; total bigint;
begin
  select * into me from players where id = auth.uid();
  t := player_by_nick(p_nick);
  if t.id is not null and me.family_id is not null and t.family_id = me.family_id then
    return fail('Aileden birine silah çekilmez.');
  end if;
  perform expire_bounties();
  r := shoot_core(p_nick, p_bullets);
  if (r->>'killed')::boolean then
    update bounties set claimed_by = me.id, claimed_at = now()
      where target_id = t.id and claimed_by is null and refunded_at is null and placer_id is distinct from me.id;
    select coalesce(sum(amount), 0) into total from bounties where target_id = t.id and claimed_by = me.id and claimed_at = now();
    if total > 0 then
      update players set cash = cash + total where id = me.id;
      perform log_event(me.id, 'Kelle ödülü: $' || total);
      r := jsonb_set(r, '{msg}', to_jsonb((r->>'msg') || ' Kelle ödülü: $' || total || '!'));
    end if;
  end if;
  return r;
end $$;

-- ─────────────── Durum ───────────────
create or replace function get_family() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; f families; app jsonb;
begin
  select * into p from players where id = auth.uid();
  if p.family_id is null then
    select jsonb_build_object('family', fa.name, 'at', a.created_at) into app
      from family_applications a join families fa on fa.id = a.family_id where a.player_id = p.id;
    return jsonb_build_object('family', null, 'application', app,
      'can_create', rank_of(p.xp) >= setting('family_create_rank'), 'create_cost', setting('family_create_cost'));
  end if;
  select * into f from families where id = p.family_id;
  return jsonb_build_object(
    'family', jsonb_build_object('id', f.id, 'name', f.name, 'bank', f.bank, 'created_at', f.created_at),
    'my_role', p.family_role,
    'members', (select jsonb_agg(jsonb_build_object('nick', m.nick, 'role', m.family_role, 'rank', rank_of(m.xp),
                  'online', m.last_seen > now() - interval '5 minutes')
                  order by array_position(array['don','sottocapo','consigliere','capo','asker'], m.family_role), m.xp desc)
                from players m where m.family_id = f.id),
    'applications', case when is_leader(p) then
                (select coalesce(jsonb_agg(jsonb_build_object('nick', a2.nick, 'rank', rank_of(a2.xp), 'kills', a2.kills)), '[]')
                 from family_applications fa2 join players a2 on a2.id = fa2.player_id where fa2.family_id = f.id) end,
    'factories', (select coalesce(jsonb_agg(jsonb_build_object('city', c.name, 'price', cb.price, 'stock', cb.stock)), '[]')
                  from city_bullets cb join cities c on c.id = cb.city_id where cb.owner_family = f.id),
    'factory_here', (select jsonb_build_object('owner', fo.name, 'mine', cb.owner_family = f.id)
                     from city_bullets cb left join families fo on fo.id = cb.owner_family where cb.city_id = p.city_id),
    'factory_price', setting('factory_price'),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('nick', mp.nick, 'text', m.text, 'at', m.created_at) order by m.id), '[]')
                 from (select * from family_messages where family_id = f.id order by id desc limit 50) m
                 left join players mp on mp.id = m.player_id));
end $$;

create or replace function get_families() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'power')::bigint desc), '[]') from (
    select jsonb_build_object('name', f.name, 'members', count(m.id), 'power', coalesce(sum(m.xp), 0),
      'don', max(m.nick) filter (where m.family_role = 'don'),
      'factories', (select count(*) from city_bullets where owner_family = f.id)) x
    from families f left join players m on m.family_id = f.id group by f.id
  ) s
$$;

alter function get_profile(text) rename to profile_core;
create or replace function get_profile(p_nick text) returns jsonb
language sql stable security definer set search_path = public as $$
  select profile_core(p_nick) || jsonb_build_object(
    'family', f.name, 'family_role', t.family_role,
    'bounty', (select coalesce(sum(amount), 0) from bounties where target_id = t.id and claimed_by is null and refunded_at is null))
  from players t left join families f on f.id = t.family_id
  where lower(t.nick) = lower(p_nick)
$$;

-- get_state'e aile özetini ekle
alter function get_state() rename to state_combat;
create or replace function get_state() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare base jsonb; p players;
begin
  base := state_combat();
  if base->'player' = 'null'::jsonb then return base; end if;
  select * into p from players where id = auth.uid();
  return jsonb_set(base, '{player}', (base->'player') || jsonb_build_object(
    'family', (select name from families where id = p.family_id), 'family_role', p.family_role,
    'bounty', (select coalesce(sum(amount), 0) from bounties where target_id = p.id and claimed_by is null and refunded_at is null)));
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function get_state(), create_player(text), do_crime(text), steal_car(), sell_car(bigint),
  travel(text), trade(text, int),
  buy_bullets(int), buy_weapon(text), hire_bodyguard(), practice(), heal(),
  hire_detectives(text, int), shoot(text, int), get_jail(), bust(text), self_bust(),
  bank_move(bigint), send_money(text, bigint), get_profile(text), get_players(),
  create_family(text), apply_family(text), cancel_application(), answer_application(text, boolean),
  leave_family(), kick_member(text), set_role(text, text), family_deposit(bigint), family_pay(text, bigint),
  post_family_message(text), buy_factory(), set_factory_price(int), place_bounty(text, bigint),
  get_hitlist(), get_family(), get_families()
  to authenticated;
