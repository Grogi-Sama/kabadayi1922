-- Faz 2C: ekip işleri. Lider ekibi kurar ve rollere oyuncu davet eder; herkes kabul edince lider başlatır.
-- Şartlar başlatma anında kontrol edilir ve masraflar o an düşülür (kabul sadece onaydır).

create table crew_types (
  id           text primary key,
  name         text not null,
  min_rank     int  not null,
  roles        text[] not null,       -- ilk rol her zaman 'lider'
  cooldown_s   int  not null,
  base_rate    numeric not null,
  payout_min   int  not null,
  payout_max   int  not null,
  xp           int  not null,
  leader_cost  int  not null,         -- liderin hazırlık masrafı
  car_min_value int not null,         -- şoförün arabası en az bu değerde olmalı
  jail_s       int  not null
);
insert into crew_types values
  ('soygun',   'Tren Soygunu',       3, array['lider', 'sofor'],                          3 * 3600, 0.55,  30000, 120000,  40,  5000,  900,  300),
  ('organize', 'Banka Soygunu', 4, array['lider', 'sofor', 'silahci', 'patlayici'], 12 * 3600, 0.45, 150000, 480000, 100, 25000, 1600,  900);

insert into game_settings values
  ('crew_gunner_bullets', 100),     -- silahçı bu kadar kurşun harcar
  ('crew_leader_bullets',  50),
  ('crew_explosive_cost', 15000),   -- patlayıcı uzmanı dinamit parası öder
  ('crew_invite_ttl_s',  1800);

create table crews (
  id         bigserial primary key,
  type_id    text not null references crew_types(id),
  leader_id  uuid not null references players(id) on delete cascade,
  city_id    text not null references cities(id),
  status     text not null default 'forming' check (status in ('forming', 'done', 'cancelled')),
  result     text,
  created_at timestamptz not null default now()
);
create unique index one_forming_crew_per_leader on crews (leader_id) where status = 'forming';

create table crew_members (
  crew_id   bigint not null references crews(id) on delete cascade,
  role      text not null,
  player_id uuid not null references players(id) on delete cascade,
  accepted  boolean,                 -- null = cevap yok
  primary key (crew_id, role)
);
create index on crew_members (player_id);

create table player_cooldowns (
  player_id uuid not null references players(id) on delete cascade,
  kind      text not null,
  ready_at  timestamptz not null,
  primary key (player_id, kind)
);

alter table crew_types       enable row level security;
alter table crews            enable row level security;
alter table crew_members     enable row level security;
alter table player_cooldowns enable row level security;

create or replace function cooldown_left(p uuid, k text) returns timestamptz
language sql stable as $$ select ready_at from player_cooldowns where player_id = p and kind = k and ready_at > now() $$;

create or replace function set_cooldown(p uuid, k text, secs numeric) returns void
language sql as $$
  insert into player_cooldowns values (p, k, now() + make_interval(secs => secs))
  on conflict (player_id, kind) do update set ready_at = excluded.ready_at
$$;

-- Süresi geçen davetli ekipleri iptal eder
create or replace function expire_crews() returns void
language sql as $$
  update crews set status = 'cancelled', result = 'Süre doldu.'
  where status = 'forming' and created_at < now() - make_interval(secs => setting('crew_invite_ttl_s'))
$$;

-- Aynı rolden birden fazla olabilir: 'sofor', 'sofor2', 'sofor3' → Şoför, Şoför 2, Şoför 3
create or replace function role_kind(r text) returns text
language sql immutable as $$ select regexp_replace(r, '\d+$', '') $$;

create or replace function role_name(r text) returns text
language sql immutable as $$
  select case role_kind(r) when 'lider' then 'Lider' when 'sofor' then 'Şoför' when 'silahci' then 'Silahçı'
                when 'patlayici' then 'Patlayıcı Uzmanı' else r end
         || coalesce(' ' || substring(r from '\d+$'), '')
$$;

-- p_invites: {"sofor": "nick", "silahci": "nick", ...}
create or replace function create_crew(p_type text, p_invites jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; ct crew_types; cid bigint; r text; t players; seen uuid[] := array[]::uuid[];
begin
  p := me_for_update();
  perform expire_crews();
  select * into ct from crew_types where id = p_type;
  if not found then raise exception 'BAD_TYPE'; end if;
  if blocked_msg(p) is not null then return fail(blocked_msg(p)); end if;
  if rank_of(p.xp) < ct.min_rank then return fail(ct.name || ' için ' || (select name from ranks where id = ct.min_rank) || ' olmalısın.'); end if;
  if cooldown_left(p.id, p_type) is not null then return fail('Bu iş için ' || fmt_wait(cooldown_left(p.id, p_type)) || ' beklemelisin.'); end if;
  if exists (select 1 from crews where leader_id = p.id and status = 'forming') then return fail('Zaten kurulmakta olan bir ekibin var.'); end if;

  seen := array[p.id];
  foreach r in array ct.roles[2:] loop
    t := player_by_nick(p_invites->>r);
    if t.id is null then return fail(role_name(r) || ' için geçerli bir oyuncu yaz.'); end if;
    if t.id = any(seen) then return fail('Bir kişi iki rol alamaz.'); end if;
    if rank_of(t.xp) < ct.min_rank then return fail(t.nick || ' bu iş için fazla çaylak.'); end if;
    seen := seen || t.id;
  end loop;

  insert into crews (type_id, leader_id, city_id) values (p_type, p.id, p.city_id) returning id into cid;
  insert into crew_members values (cid, 'lider', p.id, true);
  foreach r in array ct.roles[2:] loop
    t := player_by_nick(p_invites->>r);
    insert into crew_members values (cid, r, t.id, null);
    perform log_event(t.id, p.nick || ' seni ' || ct.name || ' için ' || role_name(r) || ' olarak çağırıyor.');
  end loop;
  return done('Ekip kuruldu, davetler gönderildi. Herkes ' || (select name from cities where id = p.city_id) || ' şehrinde olmalı.');
end $$;

create or replace function respond_crew(p_crew bigint, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c crews;
begin
  perform expire_crews();
  select * into c from crews where id = p_crew and status = 'forming';
  if not found then return fail('Bu ekip artık yok.'); end if;
  update crew_members set accepted = p_accept where crew_id = p_crew and player_id = auth.uid() and role <> 'lider';
  if not found then return fail('Bu ekipte davetin yok.'); end if;
  if not p_accept then
    update crews set status = 'cancelled', result = 'Bir davetli reddetti.' where id = p_crew;
    return done('Daveti reddettin; ekip dağıldı.');
  end if;
  return done('Ekibe katıldın. Lider başlatınca iş yapılacak.');
end $$;

create or replace function cancel_crew() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update crews set status = 'cancelled', result = 'Lider iptal etti.' where leader_id = auth.uid() and status = 'forming';
  if not found then return fail('İptal edilecek ekip yok.'); end if;
  return done('Ekip dağıtıldı.');
end $$;

-- Her üyenin şartını kontrol eder; sorun yoksa null döner.
create or replace function crew_problem(c crews, ct crew_types) returns text
language plpgsql stable as $$
declare m record; pl players;
begin
  for m in select * from crew_members where crew_id = c.id loop
    select * into pl from players where id = m.player_id;
    if m.accepted is not true then return pl.nick || ' henüz kabul etmedi.'; end if;
    if pl.city_id <> c.city_id then return pl.nick || ' şehirde değil.'; end if;
    if blocked_msg(pl) is not null then return pl.nick || ' şu an iş yapamaz (hapis/hastane).'; end if;
    if cooldown_left(pl.id, ct.id) is not null then return pl.nick || ' bu iş için henüz hazır değil.'; end if;
    if m.role = 'lider' then
      if pl.cash < ct.leader_cost then return 'Liderin $' || ct.leader_cost || ' hazırlık parası yok.'; end if;
      if pl.weapon_id is null or pl.bullets < setting('crew_leader_bullets') then
        return 'Liderin silahı ve ' || setting('crew_leader_bullets') || ' kurşunu olmalı.';
      end if;
    elsif role_kind(m.role) = 'sofor' then
      if not exists (select 1 from player_cars pc join cars k on k.id = pc.car_id
                     where pc.player_id = pl.id and pc.city_id = c.city_id and k.value >= ct.car_min_value) then
        return pl.nick || ' bu şehirde en az $' || ct.car_min_value || ' değerinde bir araba bulundurmalı.';
      end if;
    elsif role_kind(m.role) = 'silahci' then
      if pl.weapon_id is null or pl.bullets < setting('crew_gunner_bullets') then
        return pl.nick || ' silahlı olmalı ve ' || setting('crew_gunner_bullets') || ' kurşun getirmeli.';
      end if;
    elsif role_kind(m.role) = 'patlayici' then
      if pl.cash < setting('crew_explosive_cost') then return pl.nick || ' dinamit için $' || setting('crew_explosive_cost') || ' bulmalı.'; end if;
    end if;
  end loop;
  return null;
end $$;

create or replace function start_crew() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c crews; ct crew_types; problem text; avg_rank numeric; chance numeric; payout bigint; share bigint;
        n int; m record; msg text; won boolean; driver uuid;
begin
  perform me_for_update();
  perform expire_crews();
  select * into c from crews where leader_id = auth.uid() and status = 'forming' for update;
  if not found then return fail('Kurulmakta olan bir ekibin yok.'); end if;
  select * into ct from crew_types where id = c.type_id;
  -- tüm üyeleri kilitle
  perform 1 from players where id in (select player_id from crew_members where crew_id = c.id) for update;
  problem := crew_problem(c, ct);
  if problem is not null then return fail(problem); end if;

  -- masraflar
  update players set cash = cash - ct.leader_cost, bullets = bullets - setting('crew_leader_bullets') where id = c.leader_id;
  update players set bullets = bullets - setting('crew_gunner_bullets')
    where id in (select player_id from crew_members where crew_id = c.id and role_kind(role) = 'silahci');
  update players set cash = cash - setting('crew_explosive_cost')
    where id in (select player_id from crew_members where crew_id = c.id and role_kind(role) = 'patlayici');
  select player_id into driver from crew_members where crew_id = c.id and role = 'sofor';

  select avg(rank_of(pl.xp)), count(*) into avg_rank, n
    from crew_members cm join players pl on pl.id = cm.player_id where cm.crew_id = c.id;
  chance := least(0.85, ct.base_rate + 0.03 * (avg_rank - ct.min_rank));
  for m in select player_id from crew_members where crew_id = c.id loop
    perform set_cooldown(m.player_id, ct.id, ct.cooldown_s);
  end loop;

  won := random() < chance;
  if won then
    payout := round((ct.payout_min + random() * (ct.payout_max - ct.payout_min)) * (1 + 0.05 * avg_rank));
    share := payout / n;
    update players set cash = cash + share, xp = xp + ct.xp
      where id in (select player_id from crew_members where crew_id = c.id);
    msg := ct.name || ' başarılı! Toplam $' || payout || ', kişi başı $' || share || '.';
  else
    msg := ct.name || ' ters gitti!';
    if random() < 0.5 then
      update players set jail_until = now() + make_interval(secs => ct.jail_s)
        where id in (select player_id from crew_members where crew_id = c.id);
      msg := msg || ' Bütün ekip içeri alındı (' || fmt_wait(now() + make_interval(secs => ct.jail_s)) || ').';
    else
      msg := msg || ' Eli boş kaçtınız.';
    end if;
    if random() < 0.3 then
      delete from player_cars where id = (select pc.id from player_cars pc join cars k on k.id = pc.car_id
        where pc.player_id = driver and pc.city_id = c.city_id and k.value >= ct.car_min_value order by k.value limit 1);
      msg := msg || ' Şoförün arabasına el konuldu.';
    end if;
  end if;

  update crews set status = 'done', result = msg where id = c.id;
  for m in select player_id from crew_members where crew_id = c.id loop
    perform log_event(m.player_id, msg);
  end loop;
  return jsonb_build_object('ok', true, 'success', won, 'msg', msg);
end $$;

create or replace function get_crews() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  perform expire_crews();
  return jsonb_build_object(
    'types', (select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'min_rank', t.min_rank, 'roles', t.roles,
                'payout_min', t.payout_min, 'payout_max', t.payout_max, 'leader_cost', t.leader_cost,
                'car_min_value', t.car_min_value, 'ready_at', cooldown_left(me, t.id)) order by t.min_rank) from crew_types t),
    'crews', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', c.id, 'type', c.type_id, 'city', c.city_id, 'status', c.status, 'result', c.result,
                'leader', (select nick from players where id = c.leader_id), 'i_lead', c.leader_id = me,
                'members', (select jsonb_agg(jsonb_build_object('role', cm.role, 'nick', pl.nick, 'accepted', cm.accepted)
                                             order by array_position(t.roles, cm.role))
                            from crew_members cm join players pl on pl.id = cm.player_id where cm.crew_id = c.id))
              order by c.id desc), '[]')
              from crews c join crew_types t on t.id = c.type_id
              where c.id in (select crew_id from crew_members where player_id = me)
                and (c.status = 'forming' or c.created_at > now() - interval '1 day')
              limit 5),
    'settings', jsonb_build_object('gunner_bullets', setting('crew_gunner_bullets'), 'leader_bullets', setting('crew_leader_bullets'),
                'explosive_cost', setting('crew_explosive_cost')));
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
  create_crew(text, jsonb), respond_crew(bigint, boolean), cancel_crew(), start_crew(), get_crews()
  to authenticated;
