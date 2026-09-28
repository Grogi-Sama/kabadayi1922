-- Faz 3C: 8 kişilik büyük vurgun (Omerta Mega OC) + araba yarışları.

insert into crew_types values
  ('buyuk', 'Büyük Liman Vurgunu', 6,
   array['lider', 'sofor', 'sofor2', 'sofor3', 'silahci', 'silahci2', 'silahci3', 'patlayici'],
   3 * 86400, 0.40, 1500000, 4000000, 300, 150000, 3200, 3600);

-- ─────────────── Yarışlar ───────────────
insert into game_settings values
  ('race_ttl_s',      1800),
  ('race_max',           6),
  ('race_house_cut', 0.05),
  ('race_min_fee',    1000);

alter table players add column race_form numeric not null default 0;

create table races (
  id         bigserial primary key,
  city_id    text not null references cities(id),
  host_id    uuid not null references players(id) on delete cascade,
  fee        bigint not null,
  status     text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  result     text,
  created_at timestamptz not null default now()
);
create unique index one_open_race_per_host on races (host_id) where status = 'open';

create table race_entries (
  race_id   bigint not null references races(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  car_id    bigint not null,                  -- player_cars.id (yarış anında hâlâ onun olmalı)
  position  int,
  primary key (race_id, player_id)
);
alter table races        enable row level security;
alter table race_entries enable row level security;

-- Süresi dolan açık yarışlar iptal olur, giriş ücretleri iade edilir
create or replace function expire_races() returns void
language plpgsql as $$
declare r races;
begin
  for r in select * from races where status = 'open' and created_at < now() - make_interval(secs => setting('race_ttl_s')) for update loop
    update players set cash = cash + r.fee where id in (select player_id from race_entries where race_id = r.id);
    update races set status = 'cancelled', result = 'Yeterli yarışçı toplanmadı; ücretler iade edildi.' where id = r.id;
  end loop;
end $$;

create or replace function car_here(p players, p_car bigint) returns int   -- arabanın değeri ya da null
language sql stable as $$
  select k.value from player_cars pc join cars k on k.id = pc.car_id
  where pc.id = p_car and pc.player_id = p.id and pc.city_id = p.city_id
$$;

create or replace function create_race(p_fee bigint, p_car bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; rid bigint;
begin
  perform expire_races();
  p := me_for_update();
  if blocked_msg(p) is not null then return fail(blocked_msg(p)); end if;
  if p_fee < setting('race_min_fee') then return fail('Giriş ücreti en az $' || setting('race_min_fee') || '.'); end if;
  if p.cash < p_fee then return fail('Giriş ücretine paran yetmiyor.'); end if;
  if car_here(p, p_car) is null then return fail('Bu şehirde öyle bir araban yok.'); end if;
  if exists (select 1 from race_entries e join races r on r.id = e.race_id where e.player_id = p.id and r.status = 'open') then
    return fail('Zaten açık bir yarıştasın.');
  end if;
  insert into races (city_id, host_id, fee) values (p.city_id, p.id, p_fee) returning id into rid;
  insert into race_entries (race_id, player_id, car_id) values (rid, p.id, p_car);
  update players set cash = cash - p_fee where id = p.id;
  return done('Yarış açıldı. Diğer yarışçılar ' || (select name from cities where id = p.city_id) || ' şehrinden katılabilir.');
end $$;

create or replace function join_race(p_race bigint, p_car bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; r races;
begin
  perform expire_races();
  p := me_for_update();
  if blocked_msg(p) is not null then return fail(blocked_msg(p)); end if;
  select * into r from races where id = p_race and status = 'open' for update;
  if not found then return fail('Bu yarış artık yok.'); end if;
  if r.city_id <> p.city_id then return fail('Yarış başka şehirde.'); end if;
  if exists (select 1 from race_entries e join races x on x.id = e.race_id where e.player_id = p.id and x.status = 'open') then
    return fail('Zaten açık bir yarıştasın.');
  end if;
  if (select count(*) from race_entries where race_id = r.id) >= setting('race_max') then return fail('Yarış dolu.'); end if;
  if p.cash < r.fee then return fail('Giriş ücreti $' || r.fee || '.'); end if;
  if car_here(p, p_car) is null then return fail('Bu şehirde öyle bir araban yok.'); end if;
  insert into race_entries (race_id, player_id, car_id) values (r.id, p.id, p_car);
  update players set cash = cash - r.fee where id = p.id;
  return done('Yarışa katıldın. Ev sahibi başlatınca start verilecek.');
end $$;

create or replace function leave_race() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r races;
begin
  select x.* into r from races x join race_entries e on e.race_id = x.id
   where e.player_id = auth.uid() and x.status = 'open' for update;
  if not found then return fail('Açık bir yarışta değilsin.'); end if;
  if r.host_id = auth.uid() then
    update players set cash = cash + r.fee where id in (select player_id from race_entries where race_id = r.id);
    update races set status = 'cancelled', result = 'Ev sahibi yarışı iptal etti.' where id = r.id;
    return done('Yarış iptal edildi, ücretler iade edildi.');
  end if;
  delete from race_entries where race_id = r.id and player_id = auth.uid();
  update players set cash = cash + r.fee where id = auth.uid();
  return done('Yarıştan çekildin, ücretin iade edildi.');
end $$;

create or replace function start_race() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r races; e record; pl players; n int := 0; pot bigint; prize bigint; pos int := 0; winner uuid; wnick text; msg text; order_txt text := '';
begin
  perform expire_races();
  select * into r from races where host_id = auth.uid() and status = 'open' for update;
  if not found then return fail('Açık bir yarışın yok.'); end if;
  perform 1 from players where id in (select player_id from race_entries where race_id = r.id) for update;

  -- arabası kalmayan / şehirden ayrılan / hapse düşen yarışçı elenir, ücreti iade edilir
  for e in select * from race_entries where race_id = r.id loop
    select * into pl from players where id = e.player_id;
    if car_here(pl, e.car_id) is null or pl.city_id <> r.city_id or blocked_msg(pl) is not null then
      delete from race_entries where race_id = r.id and player_id = e.player_id;
      update players set cash = cash + r.fee where id = e.player_id;
      perform log_event(e.player_id, 'Yarışa gelemediğin için elendin; ücretin iade edildi.');
    end if;
  end loop;
  select count(*) into n from race_entries where race_id = r.id;
  if n < 2 then return fail('Yarış için en az 2 yarışçı lazım.'); end if;

  pot := r.fee * n;
  prize := floor(pot * (1 - setting('race_house_cut')));
  -- skor: arabanın gücü + form + bol şans (Omerta'da da şans baskındı)
  for e in
    select re.player_id, p.nick,
      sqrt(k.value) * 2 + p.race_form * 4 + random() * 120 as score
    from race_entries re join players p on p.id = re.player_id
    join player_cars pc on pc.id = re.car_id join cars k on k.id = pc.car_id
    where re.race_id = r.id order by score desc
  loop
    pos := pos + 1;
    update race_entries set position = pos where race_id = r.id and player_id = e.player_id;
    if pos = 1 then winner := e.player_id; wnick := e.nick; end if;
    order_txt := order_txt || pos || '. ' || e.nick || '  ';
    -- form: geçtiğin her rakip +0.5, seni geçen her rakip -0.5 (0..20)
    update players set race_form = least(20, greatest(0, race_form + 0.5 * (n - pos) - 0.5 * (pos - 1)))
      where id = e.player_id;
  end loop;
  update players set cash = cash + prize where id = winner;
  msg := 'Yarışı ' || wnick || ' kazandı ve $' || prize || ' aldı! ' || trim(order_txt);
  update races set status = 'done', result = msg where id = r.id;
  for e in select player_id from race_entries where race_id = r.id loop perform log_event(e.player_id, msg); end loop;
  return jsonb_build_object('ok', true, 'success', winner = auth.uid(), 'msg', msg);
end $$;

create or replace function get_races() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me players;
begin
  perform expire_races();
  select * into me from players where id = auth.uid();
  return jsonb_build_object(
    'form', me.race_form,
    'open', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'host', h.nick, 'fee', r.fee, 'i_host', r.host_id = me.id,
                'joined', exists (select 1 from race_entries where race_id = r.id and player_id = me.id),
                'racers', (select jsonb_agg(jsonb_build_object('nick', p.nick, 'car', k.name) order by p.nick)
                           from race_entries re join players p on p.id = re.player_id
                           join player_cars pc on pc.id = re.car_id join cars k on k.id = pc.car_id
                           where re.race_id = r.id)) order by r.id desc), '[]')
             from races r join players h on h.id = r.host_id where r.status = 'open' and r.city_id = me.city_id),
    'recent', (select coalesce(jsonb_agg(x.result order by x.id desc), '[]') from (
               select r.id, r.result from races r join race_entries e on e.race_id = r.id
               where e.player_id = me.id and r.status <> 'open' order by r.id desc limit 3) x));
end $$;

insert into api_rpcs values
  ('create_race(bigint, bigint)'), ('join_race(bigint, bigint)'), ('leave_race()'), ('start_race()'), ('get_races()');
select apply_grants();
