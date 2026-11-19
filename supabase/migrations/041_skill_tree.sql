-- 041: Karakter seviyesi ve yetenek ağacı. Tekrar çalıştırılabilir.
-- • Seviye itibardan (XP) hesaplanır: seviye = ⌊√(itibar / 20)⌋ + 1 (100 → 3, 1.500 → 9, 6.000 → 18, 50.000 → 51).
--   Rütbeler aynen kalır. Her seviye 1 yetenek puanı verir (seviye 1'de 0 puan).
-- • 4 dal × 5 yetenek: Ticaret, Yeraltı, Savaş, Liderlik. Satırlar dalda harcanan puanla açılır
--   (1. satır 0, 2. satır 2, 3. satır 4, 4. satır 7, 5. satır = ustalık 10 puan) → oyuncu doğal olarak uzmanlaşır.
-- • Puanlar oyun parasıyla sıfırlanabilir (seviye × skill_reset_per_level). Sezon sonunda ağaç sıfırlanır.
-- • Güç satılmaz: puan yalnızca oynayarak gelir.

insert into game_settings values
  ('skill_xp_div',            20),     -- seviye = floor(sqrt(xp / bu)) + 1
  ('skill_reset_per_level', 2000)      -- sıfırlama ücreti: seviye başına $
on conflict (key) do nothing;

create table if not exists skills (
  id        text primary key,
  branch    text not null check (branch in ('ticaret', 'yeralti', 'savas', 'liderlik')),
  tier      int  not null,             -- 1..5 (5 = ustalık)
  max_rank  int  not null,
  per_rank  numeric not null,          -- kademe başına etki (oran ya da puan)
  name      text not null,
  descr     text not null,             -- {v} yerine toplam etki yazılır
  sort      int  not null
);
alter table skills enable row level security;

insert into skills values
  ('t_pazarlik', 'ticaret',  1, 3, 0.03, 'Pazarlıkçı',       'Limanda mallar %{v} daha ucuza gelir.', 11),
  ('t_satis',    'ticaret',  2, 3, 0.03, 'Tatlı Dil',        'Limanda mallarını %{v} daha pahalıya satarsın.', 12),
  ('t_ambar',    'ticaret',  3, 3, 3,    'Geniş Ambar',      '{v} kasa daha fazla mal taşırsın.', 13),
  ('t_gumruk',   'ticaret',  4, 3, 0.25, 'Gümrükte Tanıdık', 'Gümrüğe takılma ihtimalin %{v} azalır.', 14),
  ('t_kaptan',   'ticaret',  5, 1, 0.5,  'Kaçakçı Reis',     'Satışlardan %{v} daha fazla ticaret puanı kazanırsın.', 15),
  ('y_usta',     'yeralti',  1, 3, 0.02, 'Usta Eller',       'İşlerde başarı şansın {v} puan artar.', 21),
  ('y_ganimet',  'yeralti',  2, 3, 0.08, 'Ganimet',          'İşlerden %{v} daha fazla para kazanırsın.', 22),
  ('y_kaygan',   'yeralti',  3, 3, 0.15, 'Kaygan',           'Yakalanınca hapis süren %{v} kısalır.', 23),
  ('y_oto',      'yeralti',  4, 3, 0.03, 'Oto Hırsızı',      'Araba çalma şansın {v} puan artar.', 24),
  ('y_golge',    'yeralti',  5, 1, 0.2,  'Gölge',            'İşlerin bekleme süresi %{v} kısalır.', 25),
  ('s_nisan',    'savas',    1, 3, 0.06, 'Keskin Nişancı',   'Birini indirmek için %{v} daha az kurşun gerekir.', 31),
  ('s_deri',     'savas',    2, 3, 0.06, 'Kalın Deri',       'Seni indirmek için %{v} daha fazla kurşun gerekir.', 32),
  ('s_cephane',  'savas',    3, 3, 0.05, 'Cephaneci',        'Fabrikadan kurşunu %{v} daha ucuza alırsın.', 33),
  ('s_adam',     'savas',    4, 3, 0.06, 'Sert Adamlar',     'Adamlarının saldırı ve savunması %{v} artar.', 34),
  ('s_bilek',    'savas',    5, 1, 0.4,  'Demir Bilek',      'Vurulunca hastanede %{v} daha kısa yatarsın.', 35),
  ('l_kalabalik','liderlik', 1, 3, 1,    'Kalabalık Çete',   '{v} adam daha besleyebilirsin.', 41),
  ('l_maas',     'liderlik', 2, 3, 0.1,  'Cimri Patron',     'Adamlarının maaşı %{v} azalır.', 42),
  ('l_tahkim',   'liderlik', 3, 3, 0.1,  'Tahkimat Ustası',  'Mekâna bıraktığın kurşun %{v} fazla sayılır.', 43),
  ('l_faiz',     'liderlik', 4, 3, 0.25, 'Sarraf Dostu',     'Banka faizin %{v} artar.', 44),
  ('l_talim',    'liderlik', 5, 1, 0.4,  'Talimci',          'Yeni adamların eğitimi %{v} kısa sürer.', 45)
on conflict (id) do update set branch = excluded.branch, tier = excluded.tier, max_rank = excluded.max_rank,
  per_rank = excluded.per_rank, name = excluded.name, descr = excluded.descr, sort = excluded.sort;

create table if not exists player_skills (
  player_id uuid not null references players(id) on delete cascade,
  skill_id  text not null references skills(id),
  rank      int  not null check (rank > 0),
  primary key (player_id, skill_id)
);
alter table player_skills enable row level security;

-- ─────────────── Yardımcılar ───────────────
create or replace function char_level(p_xp int) returns int
language sql immutable as $$ select floor(sqrt(greatest(coalesce(p_xp, 0), 0) / 20.0))::int + 1 $$;
-- (bölen ayarda da tutulur ama seviye eğrisi oyuncu ekranıyla aynı kalsın diye sabit; değişirse istemci de değişir)

create or replace function level_xp(p_level int) returns int
language sql immutable as $$ select (20 * (p_level - 1) * (p_level - 1))::int $$;   -- bu seviyeye gereken itibar

-- Yeteneğin toplam etkisi (kademe × kademe başı). Oyuncu yoksa 0.
create or replace function skill_val(pid uuid, sid text) returns numeric
language sql stable as $$
  select coalesce((select ps.rank * s.per_rank from player_skills ps join skills s on s.id = ps.skill_id
                   where ps.player_id = pid and ps.skill_id = sid), 0)
$$;

create or replace function skill_points(pid uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object('level', char_level(p.xp), 'total', char_level(p.xp) - 1,
    'spent', coalesce((select sum(rank) from player_skills where player_id = p.id), 0),
    'free', char_level(p.xp) - 1 - coalesce((select sum(rank) from player_skills where player_id = p.id), 0),
    'next_xp', level_xp(char_level(p.xp) + 1), 'cur_xp', level_xp(char_level(p.xp)))
  from players p where p.id = pid
$$;

-- Satır kilidi: dalda harcanmış puan
create or replace function skill_tier_need(p_tier int) returns int
language sql immutable as $$ select (array[0, 2, 4, 7, 10])[p_tier] $$;

-- ─────────────── Oyuncuya açık RPC'ler ───────────────
create or replace function get_skills() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'points', skill_points(auth.uid()),
    'reset_cost', char_level((select xp from players where id = auth.uid())) * setting('skill_reset_per_level'),
    'branches', (select jsonb_object_agg(b.branch, b.spent) from (
        select br.branch, coalesce(sum(ps.rank), 0) spent
        from (values ('ticaret'), ('yeralti'), ('savas'), ('liderlik')) br(branch)
        left join skills s on s.branch = br.branch
        left join player_skills ps on ps.skill_id = s.id and ps.player_id = auth.uid()
        group by br.branch) b),
    'skills', (select jsonb_agg(jsonb_build_object('id', s.id, 'branch', s.branch, 'tier', s.tier, 'max', s.max_rank,
        'per', s.per_rank, 'name', s.name, 'descr', s.descr, 'need', skill_tier_need(s.tier),
        'rank', coalesce(ps.rank, 0)) order by s.sort)
      from skills s left join player_skills ps on ps.skill_id = s.id and ps.player_id = auth.uid()))
$$;

create or replace function learn_skill(p_skill text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; s skills; cur int; spent_branch int; pts jsonb;
begin
  p := me_for_update();
  select * into s from skills where id = p_skill;
  if not found then raise exception 'BAD_SKILL'; end if;
  pts := skill_points(p.id);
  if (pts->>'free')::int < 1 then return fail('Yetenek puanın yok. Seviye atladıkça puan kazanırsın.'); end if;
  select coalesce(rank, 0) into cur from player_skills where player_id = p.id and skill_id = s.id;
  cur := coalesce(cur, 0);
  if cur >= s.max_rank then return fail(s.name || ' zaten en üst kademede.'); end if;
  select coalesce(sum(ps.rank), 0) into spent_branch from player_skills ps join skills k on k.id = ps.skill_id
   where ps.player_id = p.id and k.branch = s.branch;
  if spent_branch < skill_tier_need(s.tier) then
    return fail('Bu yetenek için bu dala en az ' || skill_tier_need(s.tier) || ' puan vermiş olmalısın.');
  end if;
  insert into player_skills values (p.id, s.id, 1)
    on conflict (player_id, skill_id) do update set rank = player_skills.rank + 1;
  return done(s.name || ' ' || (cur + 1) || '. kademeye yükseldi.');
end $$;

create or replace function reset_skills() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; cost bigint;
begin
  p := me_for_update();
  if not exists (select 1 from player_skills where player_id = p.id) then return fail('Sıfırlanacak yeteneğin yok.'); end if;
  cost := char_level(p.xp) * setting('skill_reset_per_level');
  if p.cash < cost then return fail('Sıfırlamak için cebinde $' || cost || ' olmalı.'); end if;
  update players set cash = cash - cost where id = p.id;
  delete from player_skills where player_id = p.id;
  perform log_event(p.id, 'Yeteneklerini sıfırladın ($' || cost || '). Puanların geri geldi.');
  return done('Yetenekler sıfırlandı; puanlarını yeniden dağıtabilirsin.');
end $$;

-- ─────────────── YERALTI ───────────────
-- İş şansı (ekran ve işlem aynı fonksiyonu kullanır; oyuncu = auth.uid())
create or replace function crime_chance_xp(c crimes, p_xp int) returns numeric
language sql stable as $$
  select least(0.95, c.base_rate + setting('crime_level_bonus') * greatest(0, level_of(p_xp) - c.min_rank)
                     + coalesce(men_job(auth.uid()), 0) + skill_val(auth.uid(), 'y_usta'))
$$;

create or replace function car_chance(rk int) returns numeric
language sql stable as $$ select least(0.9, 0.5 + 0.035 * rk + skill_val(auth.uid(), 'y_oto')) $$;

-- 020'deki do_crime + kazanç, hapis ve bekleme yetenekleri
create or replace function do_crime(p_crime text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; c crimes; rk int; reward int; xg int; msg text; k text; ready timestamptz; jail int;
begin
  p := me_for_update();
  select * into c from crimes where id = p_crime;
  if not found then raise exception 'BAD_CRIME'; end if;
  if blocked_msg(p) is not null then return fail(blocked_msg(p)); end if;
  k := 'crime:' || c.id;
  ready := cooldown_left(p.id, k);
  if ready is not null then return fail('Bu iş için biraz bekle. ' || fmt_wait(ready) || ' kaldı.'); end if;
  rk := rank_of(p.xp);
  if rk < c.min_rank then return fail('Bu iş için rütben yetmiyor.'); end if;

  perform set_cooldown(p.id, k, ceil(c.cooldown_s * (1 - skill_val(p.id, 'y_golge')))::int);

  if random() < crime_chance_xp(c, p.xp) * ev_crime_chance(p.city_id) then
    reward := floor((c.reward_min + floor(random() * (c.reward_max - c.reward_min + 1))) * ev_crime_reward(p.city_id)
                    * (1 + skill_val(p.id, 'y_ganimet')))::int;
    xg := round(c.xp * ev_crime_xp())::int;
    update players set cash = cash + reward, xp = xp + xg where id = p.id;
    msg := c.name || ': başarılı! $' || reward || ' ve +' || xg || ' itibar kazandın.';
    if rank_of(p.xp + xg) > rk then
      msg := msg || ' Terfi ettin: ' || (select name from ranks where id = rank_of(p.xp + xg)) || '!';
    end if;
    if char_level(p.xp + xg) > char_level(p.xp) then
      msg := msg || ' Seviye ' || char_level(p.xp + xg) || '! Yetenek puanı kazandın.';
    end if;
    perform log_event(p.id, msg);
    return jsonb_build_object('ok', true, 'success', true, 'msg', msg, 'reward', reward, 'xp', xg);
  elsif random() < 0.5 then
    jail := greatest(1, ceil(c.jail_s * (1 - skill_val(p.id, 'y_kaygan'))))::int;
    update players set jail_until = now() + make_interval(secs => jail) where id = p.id;
    msg := c.name || ': polis yakaladı! ' || jail || ' sn hapis.';
    perform log_event(p.id, msg);
    return jsonb_build_object('ok', true, 'success', false, 'jailed', true, 'msg', msg);
  else
    return jsonb_build_object('ok', true, 'success', false, 'msg', c.name || ': iş yaş, eli boş döndün ama kaçmayı başardın.');
  end if;
end $$;

-- ─────────────── TİCARET ───────────────
create or replace function buy_price_for(pid uuid, p_city text, p_good text) returns int
language sql stable as $$ select greatest(1, round(price_of(p_city, p_good) * (1 - skill_val(pid, 't_pazarlik'))))::int $$;
create or replace function sell_price_for(pid uuid, p_city text, p_good text) returns int
language sql stable as $$ select floor(sell_price_of(p_city, p_good) * (1 + skill_val(pid, 't_satis')))::int $$;
create or replace function carry_for(pid uuid) returns int
language sql stable as $$
  select (select carry from ranks where id = rank_of(p.xp)) + skill_val(pid, 't_ambar')::int from players p where p.id = pid
$$;

-- 027'deki trade_core + yetenekli fiyatlar, kapasite ve ticaret puanı
create or replace function trade_core(p_good text, p_qty int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; g goods; price int; held int; old_cost int; from_city text; total_held int; cap int; amount bigint;
        pts int := 0; unlocked text;
begin
  p := me_for_update();
  if p_qty = 0 or abs(p_qty) > 1000 then raise exception 'BAD_QTY'; end if;
  select * into g from goods where id = p_good;
  if not found then raise exception 'BAD_GOOD'; end if;
  if blocked_msg(p) is not null then return fail(blocked_msg(p)); end if;
  select qty, avg_cost, bought_city into held, old_cost, from_city from player_goods where player_id = p.id and good_id = p_good;
  held := coalesce(held, 0);

  if p_qty > 0 then
    if p.trade_xp < g.min_trade then
      return fail(g.name || ' ticareti için ' || g.min_trade || ' ticaret puanı gerekir (sende ' || p.trade_xp || ').');
    end if;
    price := buy_price_for(p.id, p.city_id, p_good);
    amount := price::bigint * p_qty;
    select coalesce(sum(qty), 0) into total_held from player_goods where player_id = p.id;
    cap := carry_for(p.id);
    if total_held + p_qty > cap then return fail('En fazla ' || cap || ' kasa taşıyabilirsin.'); end if;
    if p.cash < amount then return fail('Paran yetmiyor.'); end if;
    update players set cash = cash - amount where id = p.id;
    insert into player_goods (player_id, good_id, qty, avg_cost, bought_city)
      values (p.id, p_good, p_qty, price, p.city_id)
      on conflict (player_id, good_id) do update set
        avg_cost = round((coalesce(player_goods.avg_cost, price)::numeric * player_goods.qty + price::numeric * p_qty)
                         / (player_goods.qty + p_qty))::int,
        qty = player_goods.qty + p_qty, bought_city = p.city_id;
    return done(p_qty || ' kasa ' || g.name || ' alındı ($' || amount || ').');
  end if;

  if held < -p_qty then return fail('Elinde o kadar yok.'); end if;
  price := sell_price_for(p.id, p.city_id, p_good);
  amount := price::bigint * -p_qty;
  if from_city is not null and from_city <> p.city_id then
    pts := floor(-p_qty * trade_points(g) * (1 + skill_val(p.id, 't_kaptan')))::int;
  end if;
  update players set cash = cash + amount, trade_xp = trade_xp + pts where id = p.id;
  update player_goods set qty = qty + p_qty,
    avg_cost = case when qty + p_qty > 0 then avg_cost end,
    bought_city = case when qty + p_qty > 0 then bought_city end
    where player_id = p.id and good_id = p_good;
  select string_agg(name, ', ' order by sort) into unlocked from goods
   where min_trade > p.trade_xp and min_trade <= p.trade_xp + pts;
  return done(-p_qty || ' kasa ' || g.name || ' satıldı ($' || amount || ')'
    || case when old_cost is not null then ', kasa başı kâr $' || (price - old_cost) else '' end || '.'
    || case when pts > 0 then ' +' || pts || ' ticaret puanı.' else '' end
    || case when unlocked is not null then ' Yeni mal açıldı: ' || unlocked || '!' else '' end);
end $$;

-- 020'deki travel_core + gümrük yeteneği
create or replace function travel_core(p_city text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; cost int := setting('travel_cost'); cname text; msg text; seized jsonb := '[]';
begin
  p := me_for_update();
  select name into cname from cities where id = p_city;
  if not found then raise exception 'BAD_CITY'; end if;
  if p_city = p.city_id then return fail('Zaten buradasın.'); end if;
  if blocked_msg(p) is not null then return fail(blocked_msg(p)); end if;
  if p.travel_ready_at > now() then return fail('Sıradaki sefer ' || fmt_wait(p.travel_ready_at) || ' sonra.'); end if;
  if p.cash < cost then return fail('Bilet için $' || cost || ' lazım.'); end if;

  update players set cash = cash - cost, city_id = p_city,
    travel_ready_at = now() + make_interval(secs => setting('travel_cooldown_s')) where id = p.id;
  msg := 'Vapur ' || cname || ' limanına yanaştı.';

  if exists (select 1 from player_goods where player_id = p.id and qty > 0)
     and random() < setting('customs_chance') * (1 - skill_val(p.id, 't_gumruk')) then
    with s as (
      select pg.good_id, ceil(pg.qty * setting('customs_seize_share'))::int n from player_goods pg
       where pg.player_id = p.id and pg.qty > 0
    ), u as (
      update player_goods pg set qty = pg.qty - s.n,
        avg_cost = case when pg.qty - s.n > 0 then pg.avg_cost end,
        bought_city = case when pg.qty - s.n > 0 then pg.bought_city end
      from s where pg.player_id = p.id and pg.good_id = s.good_id
      returning s.good_id, s.n
    )
    select coalesce(jsonb_agg(jsonb_build_object('good', g.id, 'name', g.name, 'qty', u.n) order by g.sort), '[]')
      into seized from u join goods g on g.id = u.good_id;
    msg := msg || ' Ama gümrük kaçak malının yarısına el koydu!';
  end if;
  perform log_event(p.id, msg);
  return jsonb_build_object('ok', true, 'msg', msg, 'seized', seized);
end $$;

-- ─────────────── SAVAŞ ───────────────
-- 021'deki required_bullets + nişancı (saldıran) ve kalın deri (hedef)
create or replace function required_bullets(t players, s players) returns int
language sql stable as $$
  select ceil(
    (select kill_bullets from ranks where id = rank_of(t.xp))
    * (1 + 0.2 * t.bodyguards)
    * (1 + men_guard(t.id))
    * coalesce((select bullet_mult from weapons where id = s.weapon_id), 1)
    * (1 - least(s.kill_skill, 100) / 250.0)
    * t.health / 100.0
    * (1 - skill_val(s.id, 's_nisan')) * (1 + skill_val(t.id, 's_deri'))
  )::int
$$;

-- Adamların gücü: saldırı ve savunma (baskın, koruma, nöbet hesabı bunu kullanır)
create or replace function men_free_power(pid uuid, kind text) returns numeric
language sql stable as $$
  select coalesce(sum(case when kind = 'attack' then t.attack else t.defense end), 0) * (1 + skill_val(pid, 's_adam'))
  from player_men m join man_types t on t.id = m.type_id
  where m.player_id = pid and m.ready_at <= now() and m.spot_id is null
$$;

-- Kurşun: fabrikanın fiyatı aynı kalır (fabrika sahibi aile tam parayı alır), indirim oyuncuya geri ödenir
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'buy_bullets_skill') then alter function buy_bullets(int) rename to buy_bullets_skill; end if;
end $$;
create or replace function buy_bullets(p_qty int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; price int; back bigint;
begin
  select cb.price into price from city_bullets cb join players p on p.city_id = cb.city_id where p.id = auth.uid();
  r := buy_bullets_skill(p_qty);
  if coalesce((r->>'ok')::boolean, false) and skill_val(auth.uid(), 's_cephane') > 0 and price is not null then
    back := floor(p_qty::bigint * price * skill_val(auth.uid(), 's_cephane'));
    if back > 0 then
      update players set cash = cash + back where id = auth.uid();
      r := jsonb_set(r, '{msg}', to_jsonb((r->>'msg') || ' Cephaneci indirimi: $' || back || ' geri.'));
    end if;
  end if;
  return r;
end $$;

-- Vurulan hedef Demir Bilek'liyse hastaneden erken çıkar
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'shoot_kill_log') then alter function shoot(text, int) rename to shoot_kill_log; end if;
end $$;
create or replace function shoot(p_nick text, p_bullets int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; t players;
begin
  r := shoot_kill_log(p_nick, p_bullets);
  if coalesce((r->>'killed')::boolean, false) then
    t := player_by_nick(p_nick);
    if t.id is not null and skill_val(t.id, 's_bilek') > 0 and t.hospital_until > now() then
      update players set hospital_until = now() + (hospital_until - now()) * (1 - skill_val(t.id, 's_bilek')) where id = t.id;
    end if;
  end if;
  return r;
end $$;

-- ─────────────── LİDERLİK ───────────────
create or replace function men_cap(rk int) returns int
language sql stable as $$
  select (setting('men_cap_base') + setting('men_cap_per_rank') * rk + skill_val(auth.uid(), 'l_kalabalik'))::int
$$;

-- 021'deki settle_men + Cimri Patron
create or replace function settle_men(pid uuid) returns void
language plpgsql as $$
declare p players; days int; due bigint; paid bigint := 0; gone int := 0; i int;
begin
  select * into p from players where id = pid for update;
  if p.id is null then return; end if;
  days := floor(extract(epoch from now() - p.men_paid_at) / 86400);
  if days < 1 then return; end if;
  for i in 1 .. least(days, 14) loop
    select floor(coalesce(sum(t.wage_week), 0) / 7 * (1 - skill_val(pid, 'l_maas')))::bigint into due
      from player_men m join man_types t on t.id = m.type_id where m.player_id = pid;
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

-- Tahkim: bırakılan kurşunun üstüne bonus (barikat tavanını aşmadan)
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'fortify_spot_skill') then alter function fortify_spot(int, int) rename to fortify_spot_skill; end if;
end $$;
create or replace function fortify_spot(p_spot int, p_bullets int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; extra int;
begin
  r := fortify_spot_skill(p_spot, p_bullets);
  if coalesce((r->>'ok')::boolean, false) then
    extra := floor(p_bullets * skill_val(auth.uid(), 'l_tahkim'))::int;
    if extra > 0 then
      update spots set defense = least(setting('spot_defense_cap')::int, defense + extra) where id = p_spot;
      r := jsonb_set(r, '{msg}', to_jsonb((r->>'msg') || ' Tahkimat ustalığın: +' || extra || ' kurşun değerinde.'));
    end if;
  end if;
  return r;
end $$;

-- 036'daki accrue_interest + Sarraf Dostu (faiz oranı artar; tavan aynı)
create or replace function accrue_interest(pid uuid) returns bigint
language plpgsql as $$
declare p players; days int; b bigint; gain bigint; total bigint := 0; rate numeric;
begin
  select * into p from players where id = pid for update;
  if p.id is null then return 0; end if;
  if p.interest_at is null then
    update players set interest_at = now() where id = pid;
    return 0;
  end if;
  days := floor(extract(epoch from now() - p.interest_at) / 86400);
  if days < 1 then return 0; end if;
  b := p.bank;
  rate := setting('bank_interest') * (1 + skill_val(pid, 'l_faiz'));
  for i in 1 .. least(days, setting('bank_interest_max_days')::int) loop
    gain := least(floor(b * rate), setting('bank_interest_cap'))::bigint;
    b := b + gain; total := total + gain;
  end loop;
  update players set bank = b, interest_at = interest_at + make_interval(days => days) where id = pid;
  if total > 0 then perform log_event(pid, 'Banka faizi: $' || total || ' hesabına eklendi.'); end if;
  return total;
end $$;

-- Talimci: yeni tutulan adamın eğitimi kısalır
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'hire_man_skill') then alter function hire_man(text) rename to hire_man_skill; end if;
end $$;
create or replace function hire_man(p_type text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; cut numeric := skill_val(auth.uid(), 'l_talim'); mid bigint; mins int;
begin
  r := hire_man_skill(p_type);
  if coalesce((r->>'ok')::boolean, false) and cut > 0 then
    select id into mid from player_men where player_id = auth.uid() order by id desc limit 1;
    update player_men set ready_at = now() + (ready_at - now()) * (1 - cut) where id = mid returning ceil(extract(epoch from ready_at - now()) / 60) into mins;
    r := jsonb_set(r, '{msg}', to_jsonb(regexp_replace(r->>'msg', '\d+ dakika eğitimden', mins || ' dakika eğitimden')));
  end if;
  return r;
end $$;

-- ─────────────── Durum ve sezon ───────────────
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'state_interest') then alter function get_state() rename to state_interest; end if;
  if not exists (select 1 from pg_proc where proname = 'reset_world_skills') then alter function reset_world() rename to reset_world_skills; end if;
end $$;
create or replace function get_state() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare base jsonb; p players;
begin
  base := state_interest();
  if base->'player' is null or base->'player' = 'null'::jsonb then return base; end if;
  select * into p from players where id = auth.uid();
  -- limandaki fiyatlar ve puanlar yeteneklere göre
  if base ? 'market' and jsonb_typeof(base->'market') = 'array' then
    base := jsonb_set(base, '{market}', (select jsonb_agg(m || jsonb_build_object(
        'price', buy_price_for(p.id, p.city_id, m->>'id'),
        'sell', sell_price_for(p.id, p.city_id, m->>'id'),
        'points', floor((m->>'points')::numeric * (1 + skill_val(p.id, 't_kaptan')))::int) order by i)
      from jsonb_array_elements(base->'market') with ordinality t(m, i)));
  end if;
  return jsonb_set(base, '{player}', (base->'player') || jsonb_build_object('skill', skill_points(p.id), 'carry', carry_for(p.id)));
end $$;

create or replace function reset_world() returns void
language plpgsql as $$
begin
  perform reset_world_skills();
  delete from player_skills;
end $$;

insert into api_rpcs values ('get_skills()'), ('learn_skill(text)'), ('reset_skills()') on conflict do nothing;
select apply_grants();
