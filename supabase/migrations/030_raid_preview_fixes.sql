-- 030: Hapis/hastane/sığınaktayken para ve mal hareketi yok; baskın önizlemesi; bildirim yoklaması. Tekrar çalıştırılabilir.

-- ─────────────── Hapisteyken yapılamayanlar ───────────────
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'family_deposit_free') then alter function family_deposit(bigint) rename to family_deposit_free; end if;
  if not exists (select 1 from pg_proc where proname = 'family_pay_free') then alter function family_pay(text, bigint) rename to family_pay_free; end if;
  if not exists (select 1 from pg_proc where proname = 'list_item_free') then alter function list_item(text, int, bigint, bigint) rename to list_item_free; end if;
  if not exists (select 1 from pg_proc where proname = 'buy_listing_free') then alter function buy_listing(bigint) rename to buy_listing_free; end if;
  if not exists (select 1 from pg_proc where proname = 'cancel_listing_free') then alter function cancel_listing(bigint) rename to cancel_listing_free; end if;
  if not exists (select 1 from pg_proc where proname = 'hire_bodyguard_free') then alter function hire_bodyguard() rename to hire_bodyguard_free; end if;
  if not exists (select 1 from pg_proc where proname = 'buy_transport_free') then alter function buy_transport(text) rename to buy_transport_free; end if;
  if not exists (select 1 from pg_proc where proname = 'sell_car_free') then alter function sell_car(bigint) rename to sell_car_free; end if;
  if not exists (select 1 from pg_proc where proname = 'crush_car_free') then alter function crush_car(bigint) rename to crush_car_free; end if;
  if not exists (select 1 from pg_proc where proname = 'buy_factory_free') then alter function buy_factory() rename to buy_factory_free; end if;
  if not exists (select 1 from pg_proc where proname = 'fortify_spot_free') then alter function fortify_spot(int, int) rename to fortify_spot_free; end if;
  if not exists (select 1 from pg_proc where proname = 'station_men_free') then alter function station_men(int, text, int) rename to station_men_free; end if;
end $$;

create or replace function family_deposit(p_amount bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b text := blocked_msg((select p from players p where id = auth.uid()));
begin
  if b is not null then return fail(b); end if;
  return family_deposit_free(p_amount);
end $$;

create or replace function family_pay(p_nick text, p_amount bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b text := blocked_msg((select p from players p where id = auth.uid()));
begin
  if b is not null then return fail(b); end if;
  return family_pay_free(p_nick, p_amount);
end $$;

create or replace function list_item(p_kind text, p_qty int, p_car bigint, p_price bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b text := blocked_msg((select p from players p where id = auth.uid()));
begin
  if b is not null then return fail(b); end if;
  return list_item_free(p_kind, p_qty, p_car, p_price);
end $$;

create or replace function buy_listing(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b text := blocked_msg((select p from players p where id = auth.uid()));
begin
  if b is not null then return fail(b); end if;
  return buy_listing_free(p_id);
end $$;

create or replace function cancel_listing(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b text := blocked_msg((select p from players p where id = auth.uid()));
begin
  if b is not null then return fail(b); end if;
  return cancel_listing_free(p_id);
end $$;

create or replace function hire_bodyguard() returns jsonb
language plpgsql security definer set search_path = public as $$
declare b text := blocked_msg((select p from players p where id = auth.uid()));
begin
  if b is not null then return fail(b); end if;
  return hire_bodyguard_free();
end $$;

create or replace function buy_transport(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b text := blocked_msg((select p from players p where id = auth.uid()));
begin
  if b is not null then return fail(b); end if;
  return buy_transport_free(p_id);
end $$;

create or replace function sell_car(p_car_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b text := blocked_msg((select p from players p where id = auth.uid()));
begin
  if b is not null then return fail(b); end if;
  return sell_car_free(p_car_id);
end $$;

create or replace function crush_car(p_car_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b text := blocked_msg((select p from players p where id = auth.uid()));
begin
  if b is not null then return fail(b); end if;
  return crush_car_free(p_car_id);
end $$;

create or replace function buy_factory() returns jsonb
language plpgsql security definer set search_path = public as $$
declare b text := blocked_msg((select p from players p where id = auth.uid()));
begin
  if b is not null then return fail(b); end if;
  return buy_factory_free();
end $$;

create or replace function fortify_spot(p_spot int, p_bullets int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b text := blocked_msg((select p from players p where id = auth.uid()));
begin
  if b is not null then return fail(b); end if;
  return fortify_spot_free(p_spot, p_bullets);
end $$;

create or replace function station_men(p_spot int, p_type text, p_qty int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b text := blocked_msg((select p from players p where id = auth.uid()));
begin
  if b is not null then return fail(b); end if;
  return station_men_free(p_spot, p_type, p_qty);
end $$;

-- ─────────────── Baskın önizlemesi ───────────────
-- Savaşın aynısını rastgelelikle N kez dener, kazanma yüzdesini verir (raid_spot_events ile aynı kurallar).
create or replace function battle_sim(a_hp numeric[], a_dm numeric[], d_hp numeric[], d_dm numeric[],
                                      extra_dmg numeric, a_mult numeric, d_mult numeric) returns boolean
language plpgsql volatile as $$
declare a_hp0 numeric := coalesce((select sum(x) from unnest(a_hp) x), 0); d_hp0 numeric := coalesce((select sum(x) from unnest(d_hp) x), 0);
        ad numeric; dd numeric; r int;
begin
  if d_hp0 = 0 then return true; end if;
  for r in 1 .. setting('battle_rounds')::int loop
    ad := ((select coalesce(sum(d), 0) from unnest(a_hp, a_dm) u(h, d) where h > 0) + extra_dmg) * a_mult * (0.85 + random() * 0.3);
    dd := (select coalesce(sum(d), 0) from unnest(d_hp, d_dm) u(h, d) where h > 0) * d_mult * (0.85 + random() * 0.3);
    d_hp := battle_hit(d_hp, ad);
    a_hp := battle_hit(a_hp, dd);
    if (select coalesce(sum(x), 0) from unnest(d_hp) x) <= d_hp0 * (1 - setting('battle_break')) then return true; end if;
    if a_hp0 > 0 and (select coalesce(sum(x), 0) from unnest(a_hp) x) <= a_hp0 * (1 - setting('battle_break')) then return false; end if;
  end loop;
  return a_hp0 > 0 and (select coalesce(sum(x), 0) from unnest(a_hp) x) / a_hp0 > (select coalesce(sum(x), 0) from unnest(d_hp) x) / d_hp0;
end $$;

-- Baskından önce: iki tarafın gücü ve kazanma ihtimali. Rakip ailenin mekânında sayılar 10'a yuvarlanır (tahmini istihbarat).
create or replace function raid_preview(p_spot int, p_bullets int) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare p players; s spots; a_hp numeric[]; a_dm numeric[]; d_hp numeric[] := '{}'; d_dm numeric[] := '{}';
        npc int := 0; wall_hp numeric := 0; wall_dm numeric := 0; posted int := 0; defenders int := 0; allies int;
        a_mult numeric; d_mult numeric; support numeric; bullets int := greatest(0, coalesce(p_bullets, 0)); wins int := 0; i int;
        own boolean; scouts int; rnd numeric;
begin
  select * into p from players where id = auth.uid();
  if p.id is null then raise exception 'NO_PLAYER'; end if;
  select * into s from spots where id = p_spot;
  if not found then raise exception 'BAD_SPOT'; end if;
  select array_agg(t.defense), array_agg(t.attack) into a_hp, a_dm from player_men m join man_types t on t.id = m.type_id
   where m.player_id = p.id and m.ready_at <= now() and m.spot_id is null and not t.scout;
  select count(*) into scouts from player_men m join man_types t on t.id = m.type_id where m.player_id = p.id and t.scout;
  a_hp := coalesce(a_hp, '{}'); a_dm := coalesce(a_dm, '{}');
  own := s.owner_family is not null;
  if not own then
    npc := greatest(2, s.income / setting('battle_npc_per'))::int;
    d_hp := array_fill(setting('battle_npc_hp'), array[npc]); d_dm := array_fill(setting('battle_npc_dmg'), array[npc]);
  else
    defenders := online_in_city(s.owner_family, s.city_id);
    if s.defense > 0 then
      wall_hp := s.defense / setting('battle_wall_hp_div') * (1 + setting('raid_ally_bonus') * defenders);
      wall_dm := s.defense / setting('battle_wall_dmg_div');
      d_hp := array[wall_hp]; d_dm := array[wall_dm];
    end if;
    select d_hp || coalesce(array_agg(t.defense), '{}'), d_dm || coalesce(array_agg(t.attack), '{}'), count(*)
      into d_hp, d_dm, posted
      from player_men m join man_types t on t.id = m.type_id join players pl on pl.id = m.player_id
     where m.spot_id = s.id and m.ready_at <= now() and pl.family_id = s.owner_family;
  end if;
  allies := case when p.family_id is null then 1 else online_in_city(p.family_id, p.city_id) end;
  a_mult := 1 + setting('raid_ally_bonus') * greatest(0, allies - 1);
  d_mult := setting('battle_def_bonus') * (1 + setting('raid_ally_bonus') * defenders);
  support := setting('men_support_share') * coalesce((select sum(men_free_power(id, 'attack')) from players
                                                       where family_id = p.family_id and id <> p.id), 0);
  for i in 1 .. 60 loop
    if battle_sim(a_hp, a_dm, d_hp, d_dm, bullets / setting('battle_bullet_div') + support, a_mult, d_mult) then wins := wins + 1; end if;
  end loop;
  rnd := case when own and s.owner_family is distinct from p.family_id then 10 else 1 end;
  return jsonb_build_object(
    'chance', round(wins * 100.0 / 60),
    'me', jsonb_build_object('men', coalesce(array_length(a_hp, 1), 0), 'hp', (select coalesce(sum(x), 0) from unnest(a_hp) x),
      'dmg', round(((select coalesce(sum(x), 0) from unnest(a_dm) x) + bullets / setting('battle_bullet_div') + support) * a_mult, 1),
      'bullet_dmg', round(bullets / setting('battle_bullet_div'), 1), 'support', round(support, 1), 'allies', allies,
      'bullets_have', p.bullets, 'scouts', scouts),
    'enemy', jsonb_build_object('npc', npc, 'men', case when rnd = 1 then posted else round(posted / rnd) * rnd end,
      'wall_hp', round(wall_hp / rnd) * rnd,
      'hp', round((select coalesce(sum(x), 0) from unnest(d_hp) x) / rnd) * rnd,
      'dmg', round((select coalesce(sum(x), 0) from unnest(d_dm) x) * d_mult, 1), 'defenders', defenders),
    'rounds', setting('battle_rounds'), 'break', setting('battle_break'));
end $$;

-- ─────────────── Bildirim yoklaması ───────────────
-- Sohbet kanallarının son mesajı (başkasından), okunmamış özel mesaj, verilen andan sonraki olaylar ve aile duyuruları
create or replace function notify_poll(p_since timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p players;
begin
  select * into p from players where id = auth.uid();
  if p.id is null then return '{}'; end if;
  return jsonb_build_object(
    'heads', jsonb_build_object(
      'global', (select max(id) from chat_messages where channel = 'global' and player_id <> p.id),
      'city', (select max(id) from chat_messages where channel = 'city:' || p.city_id and player_id <> p.id),
      'family', case when p.family_id is not null then
        (select max(id) from family_messages where family_id = p.family_id and player_id is distinct from p.id) end,
      -- Aile sekmesi: yeni başvuru (yöneticiler için) ya da aile duyurusu; İşler sekmesi: ekip daveti
      'apps', case when p.family_role in ('don', 'sottocapo') then
        (select floor(extract(epoch from max(created_at)))::bigint from family_applications where family_id = p.family_id) end,
      'famnews', case when p.family_id is not null then
        (select max(id) from family_messages where family_id = p.family_id and player_id is null) end,
      'crew', (select max(m.crew_id) from crew_members m join crews c on c.id = m.crew_id
               where m.player_id = p.id and m.accepted is null and c.status = 'forming' and c.leader_id <> p.id)),
    'unread', (select count(*) from messages where to_id = p.id and read_at is null),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('text', e.text, 'at', e.created_at) order by e.id), '[]')
               from (select * from events where player_id = p.id and created_at > p_since order by id desc limit 5) e),
    'family_news', case when p.family_id is not null then
      (select coalesce(jsonb_agg(jsonb_build_object('text', m.text, 'at', m.created_at) order by m.id), '[]')
       from (select * from family_messages where family_id = p.family_id and player_id is null and created_at > p_since
             order by id desc limit 3) m) else '[]' end,
    'now', now());
end $$;

insert into api_rpcs values ('raid_preview(integer, integer)'), ('notify_poll(timestamp with time zone)') on conflict do nothing;
select apply_grants();
