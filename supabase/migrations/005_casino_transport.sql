-- Faz 2D: kumarhane (zar, rulet, slot), ulaşım yükseltmeleri, hurdacı (araba → kurşun).
-- Kumar sadece oyun parasıyla; gerçek para yok. Kasa avantajı ~%3-5.

insert into game_settings values
  ('casino_cooldown_s', 3),
  ('crusher_divisor',  20);   -- araba değeri / 20 = kurşun

alter table players add column casino_ready_at timestamptz not null default now();

create or replace function max_bet(p players) returns bigint
language sql stable as $$ select 1000 * (rank_of(p.xp) + 1)^2 $$;

-- p_game: 'zar' (choice: yuksek|dusuk), 'rulet' (choice: kirmizi|siyah|0..36), 'slot' (choice yok)
create or replace function play_casino(p_game text, p_bet bigint, p_choice text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; win bigint := 0; d1 int; d2 int; n int; red int[] := array[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
        reels text[]; sym text[] := array['🍒','🍋','🔔','🍀','💎','7️⃣']; w int[] := array[30,25,18,14,9,4];
        detail text; i int; roll int; acc int;
begin
  p := me_for_update();
  if blocked_msg(p) is not null then return fail(blocked_msg(p)); end if;
  if p.casino_ready_at > now() then return fail('Krupiye kartları karıştırıyor…'); end if;
  if p_bet < 10 then return fail('En az $10 oynanır.'); end if;
  if p_bet > max_bet(p) then return fail('Rütbene göre en fazla $' || max_bet(p) || ' oynayabilirsin.'); end if;
  if p.cash < p_bet then return fail('Cebinde o kadar yok.'); end if;

  if p_game = 'zar' then
    if p_choice not in ('yuksek', 'dusuk') then raise exception 'BAD_CHOICE'; end if;
    d1 := 1 + floor(random() * 6)::int; d2 := 1 + floor(random() * 6)::int;
    detail := '🎲 ' || d1 || ' + ' || d2 || ' = ' || (d1 + d2);
    if (p_choice = 'yuksek' and d1 + d2 >= 8) or (p_choice = 'dusuk' and d1 + d2 <= 6) then
      win := floor(p_bet * 2.3);           -- 15/36 * 2.3 ≈ %96 geri dönüş
    end if;
  elsif p_game = 'rulet' then
    n := floor(random() * 37)::int;
    detail := '🎡 ' || n || case when n = 0 then ' (yeşil)' when n = any(red) then ' (kırmızı)' else ' (siyah)' end;
    if p_choice = 'kirmizi' then
      if n = any(red) then win := p_bet * 2; end if;
    elsif p_choice = 'siyah' then
      if n <> 0 and not n = any(red) then win := p_bet * 2; end if;
    elsif p_choice ~ '^\d{1,2}$' and p_choice::int between 0 and 36 then
      if n = p_choice::int then win := p_bet * 36; end if;
    else
      raise exception 'BAD_CHOICE';
    end if;
  elsif p_game = 'slot' then
    reels := array[]::text[];
    for i in 1..3 loop
      roll := floor(random() * 100)::int; acc := 0;
      for n in 1..6 loop
        acc := acc + w[n];
        if roll < acc then reels := reels || sym[n]; exit; end if;
      end loop;
    end loop;
    detail := array_to_string(reels, ' ');
    if reels[1] = reels[2] and reels[2] = reels[3] then
      win := p_bet * case reels[1] when '7️⃣' then 250 when '💎' then 60 when '🍀' then 25
                                   when '🔔' then 14 when '🍋' then 8 else 5 end;
    elsif reels[1] = '🍒' and reels[2] = '🍒' then win := p_bet * 3;
    elsif reels[1] = '🍒' then win := floor(p_bet * 1.2);
    end if;
  else
    raise exception 'BAD_GAME';
  end if;

  update players set cash = cash - p_bet + win,
    casino_ready_at = now() + make_interval(secs => setting('casino_cooldown_s')) where id = p.id;
  if win >= p_bet * 20 then perform log_event(p.id, 'Kumarhanede büyük vurgun: $' || win || '!'); end if;
  return jsonb_build_object('ok', true, 'success', win > 0, 'win', win, 'detail', detail, 'game', p_game,
    -- ekranda zar/rulet/slot çizebilmek için ayrı alanlar
    'd1', d1, 'd2', d2, 'num', case when p_game = 'rulet' then n end, 'reels', to_jsonb(reels),
    'msg', detail || ' — ' || case when win > 0 then '$' || win || ' kazandın!' else '$' || p_bet || ' kaybettin.' end);
end $$;

-- ─────────────── Ulaşım ───────────────
create table transports (
  id         text primary key,
  name       text not null,
  cooldown_s int  not null,
  price      int  not null,
  min_rank   int  not null
);
insert into transports values
  ('vapur',     'Vapur bileti',   900,      0, 0),
  ('motorbot',  'Motorbot',       600,  25000, 3),
  ('deniz_ucagi','Deniz Uçağı',   360, 150000, 6);
alter table transports enable row level security;

alter table players add column transport_id text not null default 'vapur' references transports(id);

create or replace function buy_transport(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; t transports;
begin
  p := me_for_update();
  select * into t from transports where id = p_id;
  if not found then raise exception 'BAD_TRANSPORT'; end if;
  if rank_of(p.xp) < t.min_rank then return fail('Bunun için rütben yetmiyor.'); end if;
  if (select cooldown_s from transports where id = p.transport_id) <= t.cooldown_s then return fail('Elindeki bundan iyi.'); end if;
  if p.cash < t.price then return fail('Paran yetmiyor.'); end if;
  update players set cash = cash - t.price, transport_id = t.id where id = p.id;
  return done(t.name || ' senin! Yolculuk bekleme süresi ' || t.cooldown_s / 60 || ' dk.');
end $$;

alter function travel(text) rename to travel_core;
create or replace function travel(p_city text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := travel_core(p_city);
  if (r->>'ok')::boolean then
    update players set travel_ready_at = now() + make_interval(secs => (select cooldown_s from transports where id = transport_id))
      where id = auth.uid();
  end if;
  return r;
end $$;

-- ─────────────── Hurdacı ───────────────
create or replace function crush_car(p_car_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; v int; nm text; b int;
begin
  p := me_for_update();
  select c.value, c.name into v, nm from player_cars pc join cars c on c.id = pc.car_id
   where pc.id = p_car_id and pc.player_id = p.id and pc.city_id = p.city_id;
  if not found then return fail('Bu araba burada değil.'); end if;
  b := greatest(1, v / setting('crusher_divisor'))::int;
  delete from player_cars where id = p_car_id;
  update players set bullets = bullets + b where id = p.id;
  return done(nm || ' preste ezildi, hurdasından ' || b || ' kurşun döküldü.');
end $$;

-- get_state: ulaşım + kumarhane bilgisi
alter function get_state() rename to state_families;
create or replace function get_state() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare base jsonb; p players;
begin
  base := state_families();
  if base->'player' = 'null'::jsonb then return base; end if;
  select * into p from players where id = auth.uid();
  return jsonb_set(base, '{player}', (base->'player') || jsonb_build_object(
      'transport', p.transport_id, 'max_bet', max_bet(p), 'casino_ready_at', p.casino_ready_at))
    || jsonb_build_object('transports', (select jsonb_agg(to_jsonb(t) order by t.cooldown_s desc) from transports t));
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
  get_hitlist(), get_family(), get_families(),
  create_crew(text, jsonb), respond_crew(bigint, boolean), cancel_crew(), start_crew(), get_crews(),
  play_casino(text, bigint, text), buy_transport(text), crush_car(bigint)
  to authenticated;
