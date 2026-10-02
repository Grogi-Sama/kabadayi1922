-- 021: Adamlar (çete). Kahvehaneden adam tutulur, eğitimden sonra katılır, haftalık maaş ister.
-- Kullanımları:
--   A) Baskın: boştaki adamların baskına katılır (+ ailedeki diğer üyelerin adamlarından destek)
--   B) Mekân savunması: aile mekânına adam bırakılır
--   C) Kişisel koruma: boştaki adamların savunması seni vurmak için gereken kurşunu artırır
--   E) İş: gözcüler suçlarda başarı şansını artırır
--   F) Güç: oyuncu ve aile gücü, sıralama
-- Kayıplar: baskın ve çatışma sonucuna göre adamların bir kısmı ölür/dağılır.
-- Maaş ödenmezse her gün adamların %2–4'ü dağılır.

insert into game_settings values
  ('men_hire_cd_s',      1800),   -- iki adam tutma arası bekleme
  ('men_cap_base',          5),   -- Çaylak'ın en fazla adamı
  ('men_cap_per_rank',      5),   -- her rütbe +5
  ('men_price_step',     0.05),   -- sahip olunan her adam yeni adamı %5 pahalandırır
  ('men_power_unit',       20),   -- 1 güç puanı = 20 kurşun değerinde
  ('men_guard_bonus',    0.02),   -- boştaki adamların her savunma puanı seni vurmayı %2 zorlaştırır
  ('men_guard_cap',       1.0),   -- en fazla +%100
  ('men_job_bonus',      0.01),   -- her aktif gözcü işlerde +%1 şans
  ('men_job_cap',        0.10),
  ('men_support_share',  0.10),   -- baskında ailenin diğer üyelerinin adam gücünden destek payı
  ('men_desert_min',     0.02),   -- maaş ödenmeyen her gün dağılan pay
  ('men_desert_max',     0.04),
  ('men_kill_loss',      0.15)    -- öldürülen oyuncunun boştaki adamlarından kaybı
on conflict (key) do update set value = excluded.value;

create table man_types (
  id        text primary key,
  name      text not null,
  descr     text not null,
  attack    numeric not null,
  defense   numeric not null,
  price     int not null,
  wage_week int not null,      -- haftalık maaş (günlük kesilir)
  train_min int not null,      -- eğitim süresi (dakika) aralığı
  train_max int not null,
  min_rank  int not null default 0,
  scout     boolean not null default false,   -- gözcü: işlerde şans
  sort      int not null
);
insert into man_types values
  ('zorba',   'Zorba',   'Baskında öne atılır, kapı kırar.',               3,   1,   2000,  700, 15, 20, 0, false, 1),
  ('fedai',   'Fedai',   'Seni ve mekânını canı pahasına korur.',           1,   3,   2500,  800, 15, 25, 1, false, 2),
  ('gozcu',   'Gözcü',   'Polisi kollar; işlerde başarı şansını artırır.',  0.5, 0.5, 1500,  500, 15, 20, 0, true,  3),
  ('nisanci', 'Nişancı', 'Pahalı ama tek başına birkaç adama bedel.',       6,   5,   9000, 2500, 25, 30, 4, false, 4);

create table player_men (
  id        bigserial primary key,
  player_id uuid not null references players(id) on delete cascade,
  type_id   text not null references man_types(id),
  ready_at  timestamptz not null,                         -- eğitim bitişi
  spot_id   int references spots(id) on delete set null,  -- mekânda nöbetteyse
  hired_at  timestamptz not null default now()
);
create index on player_men (player_id);
create index on player_men (spot_id) where spot_id is not null;
alter table man_types  enable row level security;
alter table player_men enable row level security;

alter table players add column if not exists men_paid_at timestamptz not null default now();

-- ─────────────── Yardımcılar ───────────────
create or replace function men_cap(rk int) returns int
language sql stable as $$ select (setting('men_cap_base') + setting('men_cap_per_rank') * rk)::int $$;

-- Boştaki (eğitimi bitmiş, mekânda olmayan) adamların toplam gücü
create or replace function men_free_power(pid uuid, kind text) returns numeric
language sql stable as $$
  select coalesce(sum(case when kind = 'attack' then t.attack else t.defense end), 0)
  from player_men m join man_types t on t.id = m.type_id
  where m.player_id = pid and m.ready_at <= now() and m.spot_id is null
$$;

-- Oyuncunun toplam gücü (aktif adamların saldırı + savunması, mekândakiler dahil)
create or replace function men_total_power(pid uuid) returns numeric
language sql stable as $$
  select coalesce(sum(t.attack + t.defense), 0) from player_men m join man_types t on t.id = m.type_id
  where m.player_id = pid and m.ready_at <= now()
$$;

create or replace function family_power(fid bigint) returns numeric
language sql stable as $$ select coalesce(sum(men_total_power(id)), 0) from players where family_id = fid $$;

create or replace function men_guard(pid uuid) returns numeric
language sql stable as $$ select least(setting('men_guard_cap'), setting('men_guard_bonus') * men_free_power(pid, 'defense')) $$;

create or replace function men_job(pid uuid) returns numeric
language sql stable as $$
  select least(setting('men_job_cap'), setting('men_job_bonus') * count(*))
  from player_men m join man_types t on t.id = m.type_id
  where m.player_id = pid and t.scout and m.ready_at <= now() and m.spot_id is null
$$;

-- Rastgele adam kaybı: pay kadar (en az 1, adam varsa). only_free: sadece boştakiler; spot: o mekândakiler
create or replace function lose_men(pid uuid, share numeric, p_spot int default null) returns int
language plpgsql as $$
declare n int; total int;
begin
  select count(*) into total from player_men
   where player_id = pid and ready_at <= now() and (case when p_spot is null then spot_id is null else spot_id = p_spot end);
  if total = 0 or share <= 0 then return 0; end if;
  n := least(total, greatest(1, round(total * share)::int));
  delete from player_men where id in (
    select id from player_men where player_id = pid and ready_at <= now()
      and (case when p_spot is null then spot_id is null else spot_id = p_spot end)
    order by random() limit n);
  return n;
end $$;

-- Maaş: son ödemeden bu yana geçen her gün için günlük maaş kesilir (önce cep, sonra banka).
-- Ödenemeyen her gün adamların %2–4'ü dağılır. Tembel çalışır: oyuncu ya da ona dokunan biri işlem yapınca.
create or replace function settle_men(pid uuid) returns void
language plpgsql as $$
declare p players; days int; due bigint; paid bigint := 0; gone int := 0; i int;
begin
  select * into p from players where id = pid for update;
  if p.id is null then return; end if;
  days := floor(extract(epoch from now() - p.men_paid_at) / 86400);
  if days < 1 then return; end if;
  for i in 1 .. least(days, 14) loop
    select coalesce(sum(t.wage_week), 0) / 7 into due from player_men m join man_types t on t.id = m.type_id where m.player_id = pid;
    exit when due = 0;
    select * into p from players where id = pid;
    if p.cash + p.bank >= due then
      update players set cash = greatest(0, cash - due),
        bank = bank - greatest(0, due - cash) where id = pid;
      paid := paid + due;
    else
      gone := gone + lose_men_any(pid, (setting('men_desert_min') + random() * (setting('men_desert_max') - setting('men_desert_min')))::numeric);
    end if;
  end loop;
  update players set men_paid_at = men_paid_at + make_interval(days => days) where id = pid;
  if paid > 0 then perform log_event(pid, 'Adamlarının maaşı ödendi: $' || paid || '.'); end if;
  if gone > 0 then perform log_event(pid, 'Maaş ödenemedi; ' || gone || ' adamın seni bırakıp gitti.'); end if;
end $$;

-- Maaşsız kalınca her yerden (eğitimdekiler, mekândakiler dahil) dağılırlar
create or replace function lose_men_any(pid uuid, share numeric) returns int
language plpgsql as $$
declare n int; total int;
begin
  select count(*) into total from player_men where player_id = pid;
  if total = 0 then return 0; end if;
  n := least(total, greatest(1, round(total * share)::int));
  delete from player_men where id in (select id from player_men where player_id = pid order by random() limit n);
  return n;
end $$;

-- ─────────────── Kahvehane: adam tut / kov / mekâna bırak ───────────────
create or replace function hire_man(p_type text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; t man_types; owned int; price int; ready timestamptz; mins int;
begin
  p := me_for_update();
  perform settle_men(p.id);
  select * into p from players where id = p.id;
  select * into t from man_types where id = p_type;
  if not found then raise exception 'BAD_TYPE'; end if;
  if blocked_msg(p) is not null then return fail(blocked_msg(p)); end if;
  if rank_of(p.xp) < t.min_rank then
    return fail(t.name || ' tutmak için en az ' || (select name from ranks where id = t.min_rank) || ' olmalısın.');
  end if;
  ready := cooldown_left(p.id, 'hire_man');
  if ready is not null then return fail('Kahvehanede şu an işe hazır adam yok. ' || fmt_wait(ready) || ' sonra uğra.'); end if;
  select count(*) into owned from player_men where player_id = p.id;
  if owned >= men_cap(rank_of(p.xp)) then
    return fail('Rütbenle en fazla ' || men_cap(rank_of(p.xp)) || ' adam besleyebilirsin.');
  end if;
  price := (round(t.price * (1 + setting('men_price_step') * owned) / 10) * 10)::int;
  if p.cash < price then return fail('Paran yetmiyor: $' || price || ' lazım.'); end if;
  mins := t.train_min + floor(random() * (t.train_max - t.train_min + 1))::int;
  update players set cash = cash - price where id = p.id;
  insert into player_men (player_id, type_id, ready_at) values (p.id, t.id, now() + make_interval(mins => mins));
  perform set_cooldown(p.id, 'hire_man', setting('men_hire_cd_s'));
  if owned = 0 then update players set men_paid_at = now() where id = p.id; end if;   -- maaş ilk adamla başlar
  return done('Bir ' || t.name || ' tuttun ($' || price || '). ' || mins || ' dakika eğitimden sonra yanına katılacak.');
end $$;

create or replace function dismiss_man(p_type text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; mid bigint; nm text;
begin
  p := me_for_update();
  select m.id, t.name into mid, nm from player_men m join man_types t on t.id = m.type_id
   where m.player_id = p.id and m.type_id = p_type order by m.spot_id is not null, m.ready_at desc limit 1;
  if mid is null then return fail('Bu türden adamın yok.'); end if;
  delete from player_men where id = mid;
  return done('Bir ' || nm || ' yolladın. Maaşı artık ödenmeyecek.');
end $$;

-- B) Aile mekânına adam bırak / geri çağır
create or replace function station_men(p_spot int, p_type text, p_qty int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; s spots; n int;
begin
  p := me_for_update();
  if p_qty < 1 then return fail('Kaç adam bırakacağını seç.'); end if;
  select * into s from spots where id = p_spot;
  if not found or s.owner_family is distinct from p.family_id then return fail('Bu mekân ailenin değil.'); end if;
  if s.city_id <> p.city_id then return fail('Mekânın şehrinde olmalısın.'); end if;
  with picked as (
    select id from player_men where player_id = p.id and type_id = p_type and ready_at <= now() and spot_id is null limit p_qty
  ) update player_men set spot_id = s.id where id in (select id from picked);
  get diagnostics n = row_count;
  if n = 0 then return fail('Boşta bu türden eğitimli adamın yok.'); end if;
  return done(n || ' adamın ' || s.name || ' nöbetine girdi.');
end $$;

create or replace function recall_men(p_spot int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update player_men set spot_id = null where player_id = auth.uid() and spot_id = p_spot;
  get diagnostics n = row_count;
  if n = 0 then return fail('Bu mekânda adamın yok.'); end if;
  return done(n || ' adamın nöbetten döndü.');
end $$;

-- Kahvehane ekranı
create or replace function get_men() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare p players; owned int; rk int;
begin
  perform settle_men(auth.uid());
  select * into p from players where id = auth.uid();
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  rk := rank_of(p.xp);
  select count(*) into owned from player_men where player_id = p.id;
  return jsonb_build_object(
    'types', (select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'descr', t.descr, 'attack', t.attack, 'defense', t.defense,
        'price', (round(t.price * (1 + setting('men_price_step') * owned) / 10) * 10)::int, 'wage', t.wage_week,
        'train_min', t.train_min, 'train_max', t.train_max, 'min_rank', t.min_rank, 'scout', t.scout,
        'active', (select count(*) from player_men m where m.player_id = p.id and m.type_id = t.id and m.ready_at <= now() and m.spot_id is null),
        'posted', (select count(*) from player_men m where m.player_id = p.id and m.type_id = t.id and m.spot_id is not null),
        'training', (select count(*) from player_men m where m.player_id = p.id and m.type_id = t.id and m.ready_at > now()))
      order by t.sort) from man_types t),
    'training', (select coalesce(jsonb_agg(jsonb_build_object('type', m.type_id, 'ready_at', m.ready_at) order by m.ready_at), '[]')
                 from player_men m where m.player_id = p.id and m.ready_at > now()),
    'posts', (select coalesce(jsonb_agg(jsonb_build_object('spot', s.id, 'name', s.name, 'city', s.city_id, 'count', x.n)), '[]')
              from (select spot_id, count(*) n from player_men where player_id = p.id and spot_id is not null group by spot_id) x
              join spots s on s.id = x.spot_id),
    'owned', owned, 'cap', men_cap(rk),
    'wage_week', (select coalesce(sum(t.wage_week), 0) from player_men m join man_types t on t.id = m.type_id where m.player_id = p.id),
    'next_pay', p.men_paid_at + interval '1 day',
    'hire_ready_at', coalesce(cooldown_left(p.id, 'hire_man'), now()),
    'attack', men_free_power(p.id, 'attack'), 'defense', men_free_power(p.id, 'defense'),
    'power', men_total_power(p.id), 'guard', men_guard(p.id), 'job', men_job(p.id),
    'family_power', case when p.family_id is not null then family_power(p.family_id) end,
    'top', (select coalesce(jsonb_agg(x order by (x->>'power')::numeric desc), '[]') from (
              select jsonb_build_object('nick', pl.nick, 'power', men_total_power(pl.id), 'avatar', pl.avatar) x
              from players pl where exists (select 1 from player_men m where m.player_id = pl.id)
              order by men_total_power(pl.id) desc limit 10) q));
end $$;

-- ─────────────── C) Kişisel koruma: vurmak için gereken kurşun ───────────────
create or replace function required_bullets(t players, s players) returns int
language sql stable as $$
  select ceil(
    (select kill_bullets from ranks where id = rank_of(t.xp))
    * (1 + 0.2 * t.bodyguards)
    * (1 + men_guard(t.id))
    * coalesce((select bullet_mult from weapons where id = s.weapon_id), 1)
    * (1 - least(s.kill_skill, 100) / 250.0)
    * t.health / 100.0
  )::int
$$;

-- Öldürülen oyuncu boştaki adamlarının bir kısmını kaybeder
alter function shoot(text, int) rename to shoot_hideout;
create or replace function shoot(p_nick text, p_bullets int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t players; r jsonb; n int;
begin
  t := player_by_nick(p_nick);
  if t.id is not null then perform settle_men(t.id); end if;
  r := shoot_hideout(p_nick, p_bullets);
  if t.id is not null and coalesce((r->>'killed')::boolean, false) then
    n := lose_men(t.id, setting('men_kill_loss'));
    if n > 0 then
      perform log_event(t.id, 'Vurulduğun çatışmada ' || n || ' adamını kaybettin.');
      r := jsonb_set(r, '{msg}', to_jsonb((r->>'msg') || ' Adamlarından ' || n || ' kişi de düştü.'));
    end if;
  end if;
  return r;
end $$;

-- ─────────────── E) İş: gözcüler şansı artırır ───────────────
create or replace function crime_chance_xp(c crimes, p_xp int) returns numeric
language sql stable as $$
  select least(0.95, c.base_rate + setting('crime_level_bonus') * greatest(0, level_of(p_xp) - c.min_rank)
                     + coalesce(men_job(auth.uid()), 0))
$$;

-- ─────────────── A + B) Baskın: adamlar katılır, nöbetçiler savunur, kayıplar ───────────────
-- 018'deki baskın gecesi sarmalayıcısı bunu çağırır (imza aynı)
create or replace function raid_spot_events(p_spot int, p_bullets int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; s spots; f families; allies int; defenders int := 0; power numeric; def_power numeric; msg text;
        prev_owner bigint; fname text; my_att numeric; support numeric; posted numeric := 0; unit numeric := setting('men_power_unit');
        lost_me int := 0; lost_def int := 0; o record; win boolean;
begin
  perform collect_spots();
  p := me_for_update();
  perform settle_men(p.id);
  if blocked_msg(p) is not null then return fail(blocked_msg(p)); end if;
  if p.family_role is null or p.family_role not in ('don', 'sottocapo', 'capo') then
    return fail('Baskını ancak Don, Sottocapo ya da bir Capo yönetebilir.');
  end if;
  my_att := men_free_power(p.id, 'attack');
  if p_bullets < 0 or (p_bullets = 0 and my_att = 0) then return fail('Kaç kurşunla gireceğini yaz ya da yanına adam al.'); end if;
  if p.bullets < p_bullets then return fail('O kadar kurşunun yok.'); end if;
  select * into s from spots where id = p_spot for update;
  if not found then raise exception 'BAD_SPOT'; end if;
  if s.city_id <> p.city_id then return fail('Baskın için mekânın şehrinde olmalısın.'); end if;
  if s.owner_family = p.family_id then return fail('Burası zaten sizin.'); end if;
  if s.protected_until > now() then return fail('Mekân yeni el değiştirdi; ' || fmt_wait(s.protected_until) || ' sonra.'); end if;
  select * into f from families where id = p.family_id for update;
  if f.raid_ready_at > now() then return fail('Ailen yeni baskın yaptı; ' || fmt_wait(f.raid_ready_at) || ' bekle.'); end if;

  -- Saldırı: kurşun + kendi adamları + ailedeki diğerlerinin adamlarından destek; şehirdeki çevrimiçi üyeler çarpanı
  support := setting('men_support_share') * coalesce((select sum(men_free_power(id, 'attack')) from players
                                                       where family_id = p.family_id and id <> p.id), 0);
  allies := online_in_city(p.family_id, p.city_id);
  power := (p_bullets + unit * (my_att + support)) * (1 + setting('raid_ally_bonus') * greatest(0, allies - 1));
  if s.owner_family is null then
    def_power := spot_base_defense(s);
  else
    select coalesce(sum(t.defense), 0) into posted from player_men m join man_types t on t.id = m.type_id
      join players pl on pl.id = m.player_id
      where m.spot_id = s.id and m.ready_at <= now() and pl.family_id = s.owner_family;
    defenders := online_in_city(s.owner_family, s.city_id);
    def_power := (s.defense + unit * posted) * (1 + setting('raid_ally_bonus') * defenders);
  end if;

  update players set bullets = bullets - p_bullets where id = p.id;
  update families set raid_ready_at = now() + make_interval(secs => setting('raid_cooldown_s')) where id = f.id;
  prev_owner := s.owner_family;
  win := power > def_power;

  -- Kayıplar: kazanan az, kaybeden çok kaybeder
  if my_att > 0 then lost_me := lose_men(p.id, (case when win then 0.05 + random() * 0.10 else 0.20 + random() * 0.20 end)::numeric); end if;
  for o in select distinct player_id from player_men where spot_id = s.id loop
    lost_def := lost_def + lose_men(o.player_id, (case when win then 0.30 + random() * 0.30 else 0.05 + random() * 0.10 end)::numeric, s.id);
  end loop;

  if win then
    update player_men set spot_id = null where spot_id = s.id;   -- sağ kalan nöbetçiler evine döner
    update spots set owner_family = f.id, defense = floor(p_bullets * 0.25), collected_at = now(),
      protected_until = now() + make_interval(secs => setting('spot_protect_s')) where id = s.id;
    msg := s.name || ' baskınla ele geçirildi! (' || p_bullets || ' kurşun, ' || allies || ' aile üyesi'
      || case when my_att > 0 then ', adamlarınla' else '' end || ')'
      || case when lost_me > 0 then ' Kaybın: ' || lost_me || ' adam.' else '' end
      || case when lost_def > 0 then ' Karşı taraf ' || lost_def || ' nöbetçi kaybetti.' else '' end;
    perform family_msg(f.id, null, p.nick || ' liderliğinde ' || msg);
    if prev_owner is not null then
      select name into fname from families where id = f.id;
      perform family_msg(prev_owner, null, s.name || ' ' || fname || ' ailesinin baskınıyla elimizden çıktı!'
        || case when lost_def > 0 then ' Nöbetçilerden ' || lost_def || ' kişi düştü.' else '' end);
    end if;
    return jsonb_build_object('ok', true, 'success', true, 'msg', msg, 'lost', lost_me, 'enemy_lost', lost_def);
  end if;

  if prev_owner is not null then
    update spots set defense = greatest(0, defense - floor(p_bullets * 0.5)) where id = s.id;
    select name into fname from families where id = f.id;
    perform family_msg(prev_owner, null, fname || ' ailesi ' || s.name || ' mekânına baskın yaptı ama püskürtüldü.'
      || case when lost_def > 0 then ' Nöbetçilerden ' || lost_def || ' kişi düştü.' else '' end);
  end if;
  msg := s.name || ' baskını püskürtüldü. ' || p_bullets || ' kurşun boşa gitti.'
    || case when lost_me > 0 then ' Kaybın: ' || lost_me || ' adam.' else '' end;
  perform family_msg(f.id, null, p.nick || ': ' || msg);
  return jsonb_build_object('ok', true, 'success', false, 'msg', msg, 'lost', lost_me, 'enemy_lost', lost_def);
end $$;

-- ─────────────── F) Güç: aile listesinde ve durumda ───────────────
alter function get_families() rename to families_crest;
create or replace function get_families() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(f || jsonb_build_object('power', family_power((select id from families where name = f->>'name'))) order by i), '[]')
  from jsonb_array_elements(families_crest()) with ordinality t(f, i)
$$;

alter function get_state() rename to state_trade;
create or replace function get_state() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare base jsonb;
begin
  perform settle_men(auth.uid());
  base := state_trade();
  if base->'player' is null or base->'player' = 'null'::jsonb then return base; end if;
  return jsonb_set(base, '{player}', (base->'player') || jsonb_build_object(
    'men', (select count(*) from player_men where player_id = auth.uid() and ready_at <= now()),
    'men_training', (select count(*) from player_men where player_id = auth.uid() and ready_at > now()),
    'power', men_total_power(auth.uid())));
end $$;

-- Sezon sonunda adamlar da sıfırlanır
alter function reset_world() rename to reset_world_men;
create or replace function reset_world() returns void
language plpgsql as $$
begin
  delete from player_men;
  perform reset_world_men();
  update players set men_paid_at = now();
end $$;

insert into api_rpcs values ('hire_man(text)'), ('dismiss_man(text)'), ('station_men(integer, text, integer)'),
  ('recall_men(integer)'), ('get_men()');
select apply_grants();
