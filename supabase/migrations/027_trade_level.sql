-- 027: Ticaret puanı. Üst seviye mallar rütbeyle değil ticaret puanıyla açılır.
-- Puan, malı ALDIĞIN şehirden BAŞKA bir şehirde satınca kazanılır (aynı limanda al-sat puan vermez).
-- Kasa başına puan malın değerine göre: en az 1, taban fiyatın her 100$'ı için 1.
-- Sezon sonunda ticaret puanı da sıfırlanır.

alter table players add column if not exists trade_xp int not null default 0;
alter table goods add column if not exists min_trade int not null default 0;
update goods set min_rank = 0, min_trade = v.t from (values
  ('kahve', 0), ('tutun', 0), ('sarap', 0), ('raki', 0), ('konyak', 50), ('viski', 150),
  ('hali', 400), ('mucevher', 1000), ('silah_parca', 2500)) v(id, t) where goods.id = v.id;

create or replace function trade_points(g goods) returns int
language sql immutable as $$ select greatest(1, round(g.base_price / 100.0))::int $$;

-- 020'deki trade_core'un yerine: kilit ticaret puanıyla, başka şehirde satışta puan
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
  if from_city is not null and from_city <> p.city_id then pts := -p_qty * trade_points(g); end if;
  update players set cash = cash + amount, trade_xp = trade_xp + pts where id = p.id;
  update player_goods set qty = qty + p_qty,
    avg_cost = case when qty + p_qty > 0 then avg_cost end,
    bought_city = case when qty + p_qty > 0 then bought_city end
    where player_id = p.id and good_id = p_good;
  -- bu satışla yeni açılan mallar
  select string_agg(name, ', ' order by sort) into unlocked from goods
   where min_trade > p.trade_xp and min_trade <= p.trade_xp + pts;
  return done(-p_qty || ' kasa ' || g.name || ' satıldı ($' || amount || ')'
    || case when old_cost is not null then ', kasa başı kâr $' || (price - old_cost) else '' end || '.'
    || case when pts > 0 then ' +' || pts || ' ticaret puanı.' else '' end
    || case when unlocked is not null then ' Yeni mal açıldı: ' || unlocked || '!' else '' end);
end $$;

alter function get_state() rename to state_shop;
create or replace function get_state() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare base jsonb := state_shop();
begin
  if base->'player' is null or base->'player' = 'null'::jsonb then return base; end if;
  base := jsonb_set(base, '{market}', (select jsonb_agg(m || jsonb_build_object('min_trade', g.min_trade, 'min_rank', 0,
                                          'points', trade_points(g)) order by i)
    from jsonb_array_elements(base->'market') with ordinality t(m, i) join goods g on g.id = m->>'id'));
  return jsonb_set(base, '{player}', (base->'player') || jsonb_build_object(
    'trade_xp', (select trade_xp from players where id = auth.uid())));
end $$;

alter function reset_world() rename to reset_world_trade;
create or replace function reset_world() returns void
language plpgsql as $$
begin
  perform reset_world_trade();
  update players set trade_xp = 0;
end $$;

select apply_grants();
