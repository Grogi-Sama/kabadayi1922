-- Faz 3D: piyango, kazı kazan, blackjack, oyuncu pazarı, evlilik, sığınak.

insert into game_settings values
  ('lottery_ticket',      1000),
  ('lottery_max_tickets',   50),
  ('lottery_draw_utc_h',    18),     -- 21:00 İstanbul
  ('lottery_payout',      0.90),
  ('scratch_price',        500),
  ('market_fee',          0.05),
  ('marriage_cost',      25000),
  ('hideout_cost_per_rank_h', 1000),
  ('hideout_max_h',         12);

-- Kumarda kaybedilen bahsin payı şehrin gazinosunun sahibine (007'deki kuralın ortak hâli)
create or replace function casino_loss_cut(p uuid, bet bigint) returns void
language sql as $$
  update families set bank = bank + floor(bet * setting('casino_owner_cut'))
  where id = (select owner_family from spots where kind = 'gazino' and city_id = (select city_id from players where id = p))
$$;

-- ─────────────── Piyango ───────────────
create table lottery_rounds (
  id       bigserial primary key,
  draw_at  timestamptz not null unique,
  winner   uuid references players(id) on delete set null,
  prize    bigint,
  drawn    boolean not null default false
);
create table lottery_tickets (
  round_id  bigint not null references lottery_rounds(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  qty       int not null,
  primary key (round_id, player_id)
);
alter table lottery_rounds  enable row level security;
alter table lottery_tickets enable row level security;

create or replace function next_draw_at(after timestamptz) returns timestamptz
language sql stable as $$
  select case when d > after then d else d + interval '1 day' end
  from (select date_trunc('day', after at time zone 'UTC') at time zone 'UTC'
               + make_interval(hours => setting('lottery_draw_utc_h')::int) d) x
$$;

-- Vakti gelen çekilişleri yapar ve açık bir tur olmasını garanti eder; açık turu döner
create or replace function lottery_tick() returns lottery_rounds
language plpgsql as $$
declare r lottery_rounds; total int; pick int; w uuid;
begin
  for r in select * from lottery_rounds where not drawn and draw_at <= now() order by draw_at for update loop
    select coalesce(sum(qty), 0) into total from lottery_tickets where round_id = r.id;
    if total > 0 then
      pick := floor(random() * total)::int;
      -- bilet sayısına göre ağırlıklı seçim
      select player_id into w from (
        select player_id, sum(qty) over (order by player_id) - qty as lo, sum(qty) over (order by player_id) as hi
        from lottery_tickets where round_id = r.id) t
      where pick >= lo and pick < hi;
      update lottery_rounds set drawn = true, winner = w,
        prize = floor(total * setting('lottery_ticket') * setting('lottery_payout')) where id = r.id;
      update players set cash = cash + floor(total * setting('lottery_ticket') * setting('lottery_payout')) where id = w;
      perform log_event(w, 'PİYANGO SANA VURDU! $' || floor(total * setting('lottery_ticket') * setting('lottery_payout')));
    else
      update lottery_rounds set drawn = true where id = r.id;
    end if;
  end loop;
  select * into r from lottery_rounds where not drawn order by draw_at limit 1;
  if not found then
    insert into lottery_rounds (draw_at) values (next_draw_at(now())) on conflict (draw_at) do nothing;
    select * into r from lottery_rounds where not drawn order by draw_at limit 1;
  end if;
  return r;
end $$;

create or replace function buy_lottery(p_qty int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; r lottery_rounds; have int; cost bigint;
begin
  r := lottery_tick();
  p := me_for_update();
  if p_qty < 1 then raise exception 'BAD_QTY'; end if;
  select coalesce(qty, 0) into have from lottery_tickets where round_id = r.id and player_id = p.id;
  have := coalesce(have, 0);
  if have + p_qty > setting('lottery_max_tickets') then
    return fail('Bir çekilişte en fazla ' || setting('lottery_max_tickets') || ' bilet. Kalan hakkın: ' || (setting('lottery_max_tickets') - have));
  end if;
  cost := p_qty * setting('lottery_ticket');
  if p.cash < cost then return fail('Paran yetmiyor ($' || cost || ').'); end if;
  update players set cash = cash - cost where id = p.id;
  insert into lottery_tickets values (r.id, p.id, p_qty)
    on conflict (round_id, player_id) do update set qty = lottery_tickets.qty + p_qty;
  return done(p_qty || ' bilet aldın. Bol şans!');
end $$;

create or replace function get_lottery() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r lottery_rounds; last lottery_rounds;
begin
  r := lottery_tick();
  select * into last from lottery_rounds where drawn and winner is not null order by draw_at desc limit 1;
  return jsonb_build_object(
    'draw_at', r.draw_at,
    'pot', (select coalesce(sum(qty), 0) * setting('lottery_ticket') * setting('lottery_payout') from lottery_tickets where round_id = r.id),
    'mine', (select coalesce(sum(qty), 0) from lottery_tickets where round_id = r.id and player_id = auth.uid()),
    'tickets', (select coalesce(sum(qty), 0) from lottery_tickets where round_id = r.id),
    'last_winner', (select nick from players where id = last.winner), 'last_prize', last.prize);
end $$;

-- ─────────────── Kazı kazan ───────────────
create or replace function scratch_card() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; roll numeric := random(); price int := setting('scratch_price'); win int;
begin
  p := me_for_update();
  if blocked_msg(p) is not null then return fail(blocked_msg(p)); end if;
  if p.casino_ready_at > now() then return fail('Bayi yeni kartları diziyor…'); end if;
  if p.cash < price then return fail('Kart $' || price || '.'); end if;
  -- geri dönüş ≈ %87
  win := case when roll < 0.0005 then 100000 when roll < 0.0045 then 20000 when roll < 0.0245 then 5000
              when roll < 0.1045 then 1000 when roll < 0.3545 then 500 else 0 end;
  update players set cash = cash - price + win,
    casino_ready_at = now() + make_interval(secs => setting('casino_cooldown_s')) where id = p.id;
  if win = 0 then perform casino_loss_cut(p.id, price); end if;
  if win >= 20000 then perform log_event(p.id, 'Kazı kazandan $' || win || ' çıktı!'); end if;
  return jsonb_build_object('ok', true, 'success', win > 0, 'win', win,
    'msg', case when win > 0 then '🎟 $' || win || ' kazandın!' else '🎟 Boş çıktı.' end);
end $$;

-- ─────────────── Blackjack ───────────────
-- Kartlar 0..51; değer = kart % 13 → 0=As, 1..9 = 2..10, 10..12 = J Q K
create table bj_games (
  player_id uuid primary key references players(id) on delete cascade,
  deck      int[] not null,
  hand      int[] not null,
  dealer    int[] not null,
  bet       bigint not null,
  created_at timestamptz not null default now()
);
alter table bj_games enable row level security;

create or replace function bj_value(h int[]) returns int
language sql immutable as $$
  select case when s + 10 <= 21 and aces > 0 then s + 10 else s end
  from (select sum(case when c % 13 = 0 then 1 when c % 13 >= 9 then 10 else c % 13 + 1 end)::int s,
               count(*) filter (where c % 13 = 0) aces from unnest(h) c) x
$$;

create or replace function bj_label(h int[]) returns text
language sql immutable as $$
  select string_agg((array['A','2','3','4','5','6','7','8','9','10','J','Q','K'])[c % 13 + 1]
                    || (array['♠','♥','♦','♣'])[c / 13 + 1], ' ') from unnest(h) c
$$;

create or replace function bj_view(g bj_games, reveal boolean) returns jsonb
language sql immutable as $$
  select jsonb_build_object('hand', bj_label(g.hand), 'hand_value', bj_value(g.hand), 'bet', g.bet,
    'dealer', case when reveal then bj_label(g.dealer) else bj_label(g.dealer[1:1]) || ' 🂠' end,
    'dealer_value', case when reveal then bj_value(g.dealer) end)
$$;

-- Oyunu bitirir: krupiye 17'ye kadar çeker, parayı öder, masayı kaldırır
create or replace function bj_finish(g bj_games) returns jsonb
language plpgsql as $$
declare pv int := bj_value(g.hand); dv int; win bigint := 0; res text;
begin
  if pv <= 21 then
    while bj_value(g.dealer) < 17 loop
      g.dealer := g.dealer || g.deck[1]; g.deck := g.deck[2:];
    end loop;
  end if;
  dv := bj_value(g.dealer);
  if pv > 21 then res := 'Battın.';
  elsif pv = 21 and array_length(g.hand, 1) = 2 and not (dv = 21 and array_length(g.dealer, 1) = 2) then
    win := floor(g.bet * 2.5); res := 'BLACKJACK!';
  elsif dv > 21 or pv > dv then win := g.bet * 2; res := 'Kazandın!';
  elsif pv = dv then win := g.bet; res := 'Berabere, bahis iade.';
  else res := 'Krupiye kazandı.';
  end if;
  update players set cash = cash + win where id = g.player_id;
  if win = 0 then perform casino_loss_cut(g.player_id, g.bet); end if;
  delete from bj_games where player_id = g.player_id;
  return jsonb_build_object('ok', true, 'done', true, 'success', win > g.bet, 'win', win,
    'msg', res || case when win > 0 then ' $' || win else '' end) || bj_view(g, true);
end $$;

create or replace function bj_start(p_bet bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; g bj_games; d int[];
begin
  p := me_for_update();
  if blocked_msg(p) is not null then return fail(blocked_msg(p)); end if;
  if exists (select 1 from bj_games where player_id = p.id) then return fail('Masada zaten bir elin var.'); end if;
  if p_bet < 10 then return fail('En az $10 oynanır.'); end if;
  if p_bet > max_bet(p) then return fail('Rütbene göre en fazla $' || max_bet(p) || ' oynayabilirsin.'); end if;
  if p.cash < p_bet then return fail('Cebinde o kadar yok.'); end if;
  select array_agg(c order by random()) into d from generate_series(0, 51) c;
  update players set cash = cash - p_bet where id = p.id;
  insert into bj_games (player_id, deck, hand, dealer, bet)
    values (p.id, d[5:], array[d[1], d[3]], array[d[2], d[4]], p_bet) returning * into g;
  if bj_value(g.hand) = 21 then return bj_finish(g); end if;
  return jsonb_build_object('ok', true, 'done', false) || bj_view(g, false);
end $$;

create or replace function bj_hit() returns jsonb
language plpgsql security definer set search_path = public as $$
declare g bj_games;
begin
  select * into g from bj_games where player_id = auth.uid() for update;
  if not found then return fail('Masada elin yok.'); end if;
  g.hand := g.hand || g.deck[1]; g.deck := g.deck[2:];
  update bj_games set hand = g.hand, deck = g.deck where player_id = g.player_id;
  if bj_value(g.hand) >= 21 then return bj_finish(g); end if;
  return jsonb_build_object('ok', true, 'done', false) || bj_view(g, false);
end $$;

create or replace function bj_stand() returns jsonb
language plpgsql security definer set search_path = public as $$
declare g bj_games;
begin
  select * into g from bj_games where player_id = auth.uid() for update;
  if not found then return fail('Masada elin yok.'); end if;
  return bj_finish(g);
end $$;

create or replace function bj_current() returns jsonb
language sql stable security definer set search_path = public as $$
  select bj_view(g, false) || jsonb_build_object('ok', true, 'done', false) from bj_games g where player_id = auth.uid()
$$;

-- ─────────────── Oyuncu pazarı ───────────────
create table market_listings (
  id         bigserial primary key,
  seller_id  uuid not null references players(id) on delete cascade,
  kind       text not null check (kind in ('bullets', 'car')),
  qty        int,                -- kurşun adedi
  car_type   text references cars(id),
  car_city   text references cities(id),
  price      bigint not null check (price > 0),
  created_at timestamptz not null default now()
);
alter table market_listings enable row level security;

create or replace function list_item(p_kind text, p_qty int, p_car bigint, p_price bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; ct text; cc text;
begin
  p := me_for_update();
  if p_price < 1 or p_price > 1e9 then return fail('Geçersiz fiyat.'); end if;
  if (select count(*) from market_listings where seller_id = p.id) >= 10 then return fail('En fazla 10 ilanın olabilir.'); end if;
  if p_kind = 'bullets' then
    if p_qty < 1 or p.bullets < p_qty then return fail('O kadar kurşunun yok.'); end if;
    update players set bullets = bullets - p_qty where id = p.id;       -- emanete alınır
    insert into market_listings (seller_id, kind, qty, price) values (p.id, 'bullets', p_qty, p_price);
    return done(p_qty || ' kurşun pazara çıktı.');
  elsif p_kind = 'car' then
    select car_id, city_id into ct, cc from player_cars where id = p_car and player_id = p.id;
    if not found then return fail('Böyle bir araban yok.'); end if;
    delete from player_cars where id = p_car;                           -- emanete alınır
    insert into market_listings (seller_id, kind, car_type, car_city, price) values (p.id, 'car', ct, cc, p_price);
    return done('Araba pazara çıktı.');
  end if;
  raise exception 'BAD_KIND';
end $$;

create or replace function cancel_listing(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l market_listings;
begin
  delete from market_listings where id = p_id and seller_id = auth.uid() returning * into l;
  if not found then return fail('Böyle bir ilanın yok.'); end if;
  if l.kind = 'bullets' then update players set bullets = bullets + l.qty where id = l.seller_id;
  else insert into player_cars (player_id, car_id, city_id) values (l.seller_id, l.car_type, l.car_city);
  end if;
  return done('İlan kaldırıldı, malın geri geldi.');
end $$;

create or replace function buy_listing(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; l market_listings; fee bigint;
begin
  p := me_for_update();
  select * into l from market_listings where id = p_id for update;
  if not found then return fail('İlan artık yok.'); end if;
  if l.seller_id = p.id then return fail('Kendi ilanını alamazsın.'); end if;
  if p.cash < l.price then return fail('Paran yetmiyor.'); end if;
  fee := ceil(l.price * setting('market_fee'));
  delete from market_listings where id = l.id;
  update players set cash = cash - l.price where id = p.id;
  update players set cash = cash + l.price - fee where id = l.seller_id;
  if l.kind = 'bullets' then
    update players set bullets = bullets + l.qty where id = p.id;
  else
    insert into player_cars (player_id, car_id, city_id) values (p.id, l.car_type, l.car_city);
  end if;
  perform log_event(l.seller_id, 'Pazardaki ilanın satıldı: $' || (l.price - fee) || ' (alıcı ' || p.nick || ')');
  return done('Satın alındı!' || case when l.kind = 'car' then ' Araba ' || (select name from cities where id = l.car_city) || ' garajında.' else '' end);
end $$;

create or replace function get_market() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'seller', s.nick, 'mine', l.seller_id = auth.uid(),
      'kind', l.kind, 'qty', l.qty, 'car', k.name, 'car_value', k.value, 'city', c.name, 'price', l.price,
      'unit', case when l.kind = 'bullets' then round(l.price::numeric / l.qty, 1) end)
    order by l.seller_id = auth.uid() desc, l.id desc), '[]')
  from (select * from market_listings order by id desc limit 100) l
  join players s on s.id = l.seller_id left join cars k on k.id = l.car_type left join cities c on c.id = l.car_city
$$;

-- ─────────────── Evlilik ───────────────
alter table players add column spouse_id uuid references players(id) on delete set null,
                    add column proposal_to uuid references players(id) on delete set null;

create or replace function propose(p_nick text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; t players;
begin
  p := me_for_update();
  if p.spouse_id is not null then return fail('Zaten evlisin.'); end if;
  t := player_by_nick(p_nick);
  if t.id is null or t.id = p.id then return fail('Geçersiz kişi.'); end if;
  if t.spouse_id is not null then return fail(t.nick || ' zaten evli.'); end if;
  if is_blocked(t.id, p.id) then return fail(t.nick || ' teklifine kapalı.'); end if;
  update players set proposal_to = t.id where id = p.id;
  perform log_event(t.id, p.nick || ' sana evlenme teklif etti! Profilinden kabul edebilirsin.');
  return done('Teklif iletildi. Kabul ederse düğün masrafı ($' || setting('marriage_cost') || ') senden çıkar.');
end $$;

create or replace function accept_proposal(p_nick text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; t players; cost int := setting('marriage_cost');
begin
  p := me_for_update();
  select * into t from players where lower(nick) = lower(p_nick) and proposal_to = p.id for update;
  if not found then return fail('Bu kişiden teklif yok.'); end if;
  if p.spouse_id is not null or t.spouse_id is not null then return fail('Biriniz zaten evli.'); end if;
  if t.cash < cost then return fail(t.nick || ' düğün masrafını karşılayamıyor.'); end if;
  update players set cash = cash - cost, spouse_id = p.id, proposal_to = null where id = t.id;
  update players set spouse_id = t.id, proposal_to = null where id = p.id;
  perform log_event(t.id, p.nick || ' teklifini kabul etti. Düğününüz kutlu olsun!');
  perform log_event(p.id, t.nick || ' ile evlendin. Maşallah!');
  return done('Evlendiniz! 💍');
end $$;

create or replace function divorce() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players;
begin
  p := me_for_update();
  if p.spouse_id is null then return fail('Evli değilsin.'); end if;
  update players set spouse_id = null where id in (p.id, p.spouse_id);
  perform log_event(p.spouse_id, p.nick || ' boşanma kâğıdını gönderdi.');
  return done('Boşandın.');
end $$;

-- ─────────────── Sığınak ───────────────
alter table players add column hideout_until timestamptz not null default now();

create or replace function blocked_msg(p players) returns text
language sql stable as $$
  select case
    when p.jail_until > now()     then 'Hapistesin. ' || fmt_wait(p.jail_until) || ' kaldı.'
    when p.hospital_until > now() then 'Hastanedesin. ' || fmt_wait(p.hospital_until) || ' kaldı.'
    when p.hideout_until > now()  then 'Sığınaktasın. ' || fmt_wait(p.hideout_until) || ' kaldı (erken çıkabilirsin).'
  end
$$;

create or replace function enter_hideout(p_hours int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; cost bigint;
begin
  p := me_for_update();
  if blocked_msg(p) is not null then return fail(blocked_msg(p)); end if;
  if p_hours < 1 or p_hours > setting('hideout_max_h') then return fail('1-' || setting('hideout_max_h') || ' saat arası.'); end if;
  cost := p_hours * setting('hideout_cost_per_rank_h') * (rank_of(p.xp) + 1);
  if p.cash < cost then return fail('Sığınak $' || cost || ' tutar.'); end if;
  update players set cash = cash - cost, hideout_until = now() + make_interval(hours => p_hours) where id = p.id;
  return done(p_hours || ' saatliğine yer altına indin. Kimse seni bulamaz.');
end $$;

create or replace function leave_hideout() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update players set hideout_until = now() where id = auth.uid() and hideout_until > now();
  if not found then return fail('Sığınakta değilsin.'); end if;
  return done('Sığınaktan çıktın. Gözünü dört aç.');
end $$;

-- Dedektifler sığınaktakini bulamaz
create or replace function resolve_searches(p uuid) returns void
language sql as $$
  update detective_searches d set resolved = true,
    success = d.success and (select hideout_until <= now() from players where id = d.target_id),
    city_found = case when d.success and (select hideout_until <= now() from players where id = d.target_id)
                      then (select city_id from players where id = d.target_id) end
  where d.player_id = p and not d.resolved and d.ready_at <= now()
$$;

-- Sığınaktakine ateş edilemez
alter function shoot(text, int) rename to shoot_families;
create or replace function shoot(p_nick text, p_bullets int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t players;
begin
  t := player_by_nick(p_nick);
  if t.id is not null and t.hideout_until > now() then
    update players set kill_ready_at = now() + make_interval(secs => setting('kill_cooldown_s')) where id = auth.uid();
    return jsonb_build_object('ok', true, 'success', false, 'msg', t.nick || ' yer altına inmiş; izi kaybettin.');
  end if;
  return shoot_families(p_nick, p_bullets);
end $$;

-- Profil & durum
alter function get_profile(text) rename to profile_social;
create or replace function get_profile(p_nick text) returns jsonb
language sql stable security definer set search_path = public as $$
  select profile_social(p_nick) || jsonb_build_object(
    'spouse', (select nick from players where id = t.spouse_id),
    'proposed_to_me', t.proposal_to = auth.uid(),
    'race_form', t.race_form,
    'status', case when t.hideout_until > now() then 'kayıp' else profile_social(p_nick)->>'status' end)
  from players t where lower(t.nick) = lower(p_nick)
$$;

alter function get_state() rename to state_social;
create or replace function get_state() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare base jsonb; p players;
begin
  base := state_social();
  if base->'player' = 'null'::jsonb then return base; end if;
  select * into p from players where id = auth.uid();
  return jsonb_set(base, '{player}', (base->'player') || jsonb_build_object(
    'hideout_until', p.hideout_until,
    'spouse', (select nick from players where id = p.spouse_id),
    'proposals', (select coalesce(jsonb_agg(nick), '[]') from players where proposal_to = p.id and spouse_id is null)));
end $$;

insert into api_rpcs values
  ('buy_lottery(integer)'), ('get_lottery()'), ('scratch_card()'),
  ('bj_start(bigint)'), ('bj_hit()'), ('bj_stand()'), ('bj_current()'),
  ('list_item(text, integer, bigint, bigint)'), ('cancel_listing(bigint)'), ('buy_listing(bigint)'), ('get_market()'),
  ('propose(text)'), ('accept_proposal(text)'), ('divorce()'),
  ('enter_hideout(integer)'), ('leave_hideout()');
select apply_grants();
