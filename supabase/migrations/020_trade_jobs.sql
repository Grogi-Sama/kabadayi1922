-- 020: Canlı sunucuya eklenen ilk göç (001–019 artık değiştirilmez).
-- • İşlerin bekleme süresi birbirinden bağımsız: küçük iş kısa, büyük iş uzun bekler.
-- • Başarı şansı tecrübeyle (itibar) sürekli artar; rütbe içindeki ilerleme de sayılır.
-- • Limanda satış fiyatı alışın %15 altında; elindeki malın alış fiyatı ve alındığı şehir tutulur.
-- • Pahalı mallar (rütbe kilitli): ipek halı, mücevherat, silah parçaları.
-- • Gümrük artık malın yarısına el koyar; el konan mallar sonuçta listelenir (açılır pencere).
-- • Gelen kutusunda karşı tarafın portresi.

insert into game_settings values
  ('trade_sell_rate',     0.85),   -- aynı şehirde satış = alış × bu oran
  ('customs_seize_share', 0.5),    -- gümrüğe takılınca el konan pay
  ('crime_level_bonus',   0.04)    -- işin rütbesinin üstündeki her seviye için başarı artışı
on conflict (key) do update set value = excluded.value;

-- ─────────────── İşler: ayrı bekleme, tecrübeyle artan şans ───────────────
alter table crimes add column if not exists cooldown_s int not null default 90;
update crimes set cooldown_s = v.s from (values
  ('cep', 40), ('dukkan', 70), ('kumarhane', 120), ('liman', 210), ('kuyumcu', 300), ('banka', 480)) v(id, s)
  where crimes.id = v.id;

-- Kesirli seviye: rütbe + rütbe içindeki ilerleme (0–1)
create or replace function level_of(p_xp int) returns numeric
language sql stable as $$
  select r.id + coalesce(least(1, (p_xp - r.min_xp)::numeric / nullif(n.min_xp - r.min_xp, 0)), 0)
  from ranks r left join ranks n on n.id = r.id + 1
  where r.id = rank_of(p_xp)
$$;

create or replace function crime_chance_xp(c crimes, p_xp int) returns numeric
language sql stable as $$
  select least(0.95, c.base_rate + setting('crime_level_bonus') * greatest(0, level_of(p_xp) - c.min_rank))
$$;

create or replace function do_crime(p_crime text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; c crimes; rk int; reward int; xg int; msg text; k text; ready timestamptz;
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

  perform set_cooldown(p.id, k, c.cooldown_s);

  if random() < crime_chance_xp(c, p.xp) * ev_crime_chance(p.city_id) then
    reward := floor((c.reward_min + floor(random() * (c.reward_max - c.reward_min + 1))) * ev_crime_reward(p.city_id))::int;
    xg := round(c.xp * ev_crime_xp())::int;
    update players set cash = cash + reward, xp = xp + xg where id = p.id;
    msg := c.name || ': başarılı! $' || reward || ' ve +' || xg || ' itibar kazandın.';
    if rank_of(p.xp + xg) > rk then
      msg := msg || ' Terfi ettin: ' || (select name from ranks where id = rank_of(p.xp + xg)) || '!';
    end if;
    perform log_event(p.id, msg);
    return jsonb_build_object('ok', true, 'success', true, 'msg', msg, 'reward', reward, 'xp', xg);
  elsif random() < 0.5 then
    update players set jail_until = now() + make_interval(secs => c.jail_s) where id = p.id;
    msg := c.name || ': polis yakaladı! ' || c.jail_s || ' sn hapis.';
    perform log_event(p.id, msg);
    return jsonb_build_object('ok', true, 'success', false, 'jailed', true, 'msg', msg);
  else
    return jsonb_build_object('ok', true, 'success', false, 'msg', c.name || ': iş yaş, eli boş döndün ama kaçmayı başardın.');
  end if;
end $$;

-- Araba çalma şansı tek yerde (hem işlem hem ekran)
create or replace function car_chance(rk int) returns numeric
language sql immutable as $$ select least(0.85, 0.5 + 0.035 * rk) $$;

-- ─────────────── Liman: alış/satış farkı, alış kaydı, pahalı mallar ───────────────
alter table goods add column if not exists min_rank int not null default 0;
insert into goods (id, name, base_price, sort, min_rank) values
  ('hali',        'İpek Halı',        1000, 7, 2),
  ('mucevher',    'Mücevherat',       2600, 8, 4),
  ('silah_parca', 'Silah Parçaları',  6900, 9, 6)
on conflict (id) do nothing;

alter table player_goods add column if not exists avg_cost int;       -- kasa başına ortalama alış
alter table player_goods add column if not exists bought_city text;   -- en son alındığı şehir

create or replace function sell_price_of(p_city text, p_good text) returns int
language sql stable as $$ select floor(price_of(p_city, p_good) * setting('trade_sell_rate'))::int $$;

-- p_qty > 0 alış, < 0 satış (018'deki kıtlık sarmalayıcısı bunu çağırır)
create or replace function trade_core(p_good text, p_qty int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; g goods; price int; held int; old_cost int; total_held int; cap int; amount bigint;
begin
  p := me_for_update();
  if p_qty = 0 or abs(p_qty) > 1000 then raise exception 'BAD_QTY'; end if;
  select * into g from goods where id = p_good;
  if not found then raise exception 'BAD_GOOD'; end if;
  if blocked_msg(p) is not null then return fail(blocked_msg(p)); end if;
  select qty, avg_cost into held, old_cost from player_goods where player_id = p.id and good_id = p_good;
  held := coalesce(held, 0);

  if p_qty > 0 then
    if rank_of(p.xp) < g.min_rank then
      return fail(g.name || ' ticareti için en az ' || (select name from ranks where id = g.min_rank) || ' olmalısın.');
    end if;
    price := price_of(p.city_id, p_good);
    amount := price::bigint * p_qty;
    select coalesce(sum(qty), 0) into total_held from player_goods where player_id = p.id;
    select carry into cap from ranks where id = rank_of(p.xp);
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
  price := sell_price_of(p.city_id, p_good);
  amount := price::bigint * -p_qty;
  update players set cash = cash + amount where id = p.id;
  update player_goods set qty = qty + p_qty,
    avg_cost = case when qty + p_qty > 0 then avg_cost end,
    bought_city = case when qty + p_qty > 0 then bought_city end
    where player_id = p.id and good_id = p_good;
  return done(-p_qty || ' kasa ' || g.name || ' satıldı ($' || amount || ')'
    || case when old_cost is not null then ', kasa başı kâr $' || (price - old_cost) else '' end || '.');
end $$;

-- ─────────────── Yolculuk: gümrük yarısına el koyar ───────────────
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

  if exists (select 1 from player_goods where player_id = p.id and qty > 0) and random() < setting('customs_chance') then
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

-- ─────────────── Durum: iş süreleri/şansları, liman fiyatları ───────────────
alter function get_state() rename to state_avatar;
create or replace function get_state() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare base jsonb := state_avatar(); p players;
begin
  if base->'player' is null or base->'player' = 'null'::jsonb then return base; end if;
  select * into p from players where id = auth.uid();
  base := jsonb_set(base, '{crimes}', (select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'min_rank', c.min_rank, 'reward_min', c.reward_min, 'reward_max', c.reward_max,
      'xp', c.xp, 'cooldown_s', c.cooldown_s, 'chance', round(crime_chance_xp(c, p.xp), 3),
      'ready_at', coalesce(cooldown_left(p.id, 'crime:' || c.id), now())) order by c.sort) from crimes c));
  base := jsonb_set(base, '{market}', (select jsonb_agg(jsonb_build_object(
      'id', g.id, 'name', g.name, 'min_rank', g.min_rank,
      'price', price_of(p.city_id, g.id), 'sell', sell_price_of(p.city_id, g.id),
      'qty', coalesce(pg.qty, 0), 'avg_cost', pg.avg_cost, 'bought_city', pg.bought_city) order by g.sort)
    from goods g left join player_goods pg on pg.good_id = g.id and pg.player_id = p.id));
  return base || jsonb_build_object('car_chance', car_chance(rank_of(p.xp)));
end $$;

-- Araba çalma: şans car_chance() ile aynı (davranış değişmedi, sadece tek yerde)
create or replace function steal_car() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; car cars; msg text;
begin
  p := me_for_update();
  if blocked_msg(p) is not null then return fail(blocked_msg(p)); end if;
  if p.car_ready_at > now() then return fail('Ortalık hâlâ sıcak. ' || fmt_wait(p.car_ready_at) || ' bekle.'); end if;
  update players set car_ready_at = now() + make_interval(secs => setting('car_cooldown_s')) where id = p.id;
  if random() < car_chance(rank_of(p.xp)) then
    select * into car from cars order by -ln(1 - random()) / weight limit 1;
    insert into player_cars (player_id, car_id, city_id) values (p.id, car.id, p.city_id);
    update players set xp = xp + 8 where id = p.id;
    msg := 'Bir ' || car.name || ' çaldın! (değeri $' || car.value || ') +8 itibar.';
    perform log_event(p.id, msg);
    return jsonb_build_object('ok', true, 'success', true, 'msg', msg);
  end if;
  update players set jail_until = now() + make_interval(secs => setting('car_fail_jail_s')) where id = p.id;
  msg := 'Araba sahibi bağırdı, bekçi yakaladı! ' || setting('car_fail_jail_s') || ' sn hapis.';
  perform log_event(p.id, msg);
  return jsonb_build_object('ok', true, 'success', false, 'jailed', true, 'msg', msg);
end $$;

-- ─────────────── Gelen kutusu: karşı tarafın portresi ───────────────
create or replace function get_inbox() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'last_id')::bigint desc), '[]') from (
    select jsonb_build_object('nick', o.nick, 'avatar', o.avatar, 'last', c.text, 'at', c.created_at, 'last_id', c.id,
      'unread', (select count(*) from messages u where u.to_id = auth.uid() and u.from_id = o.id and u.read_at is null),
      'blocked', is_blocked(auth.uid(), o.id)) x
    from (select distinct on (other) id, text, created_at, other from (
            select id, text, created_at, case when from_id = auth.uid() then to_id else from_id end other
            from messages where from_id = auth.uid() or to_id = auth.uid()) m
          order by other, id desc) c
    join players o on o.id = c.other
    where not is_blocked(auth.uid(), o.id)
    limit 50
  ) s
$$;

select apply_grants();
