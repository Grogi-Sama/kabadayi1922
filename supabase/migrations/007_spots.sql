-- Faz 3B: mekânlar (Omerta "spots"). Aileler mekân ele geçirir, saatlik haraç toplar, birbirine baskın yapar.
-- Gazino türündeki mekânın sahibi, o şehirde kumarda kaybedilen bahislerin bir payını alır.

insert into game_settings values
  ('spot_income_cap_h',   24),     -- en fazla 24 saatlik birikmiş haraç
  ('spot_protect_s',    7200),     -- ele geçirildikten sonra 2 saat baskın yapılamaz
  ('raid_cooldown_s',   1800),     -- aile başına baskın bekleme süresi
  ('raid_ally_bonus',   0.15),     -- şehirde çevrimiçi her ek üye gücü %15 artırır
  ('spot_defense_cap', 20000),
  ('casino_owner_cut',  0.10);

create table spots (
  id              serial primary key,
  city_id         text not null references cities(id),
  name            text not null,
  kind            text not null check (kind in ('gazino', 'meyhane', 'kahvehane', 'antrepo')),
  income          int  not null,             -- saatlik haraç
  owner_family    bigint references families(id) on delete set null,
  defense         int  not null default 0,   -- sahibin yığdığı kurşun
  collected_at    timestamptz not null default now(),
  protected_until timestamptz not null default now()
);
alter table spots enable row level security;
insert into spots (city_id, name, kind, income) values
  ('istanbul', 'Pera Gazinosu', 'gazino', 6000), ('istanbul', 'Galata Meyhanesi', 'meyhane', 3000), ('istanbul', 'Karaköy Antreposu', 'antrepo', 4000),
  ('izmir', 'Kordon Gazinosu', 'gazino', 5000), ('izmir', 'Kemeraltı Kahvehanesi', 'kahvehane', 2500), ('izmir', 'Pasaport Antreposu', 'antrepo', 4000),
  ('selanik', 'Beyaz Kule Gazinosu', 'gazino', 5000), ('selanik', 'Ladadika Meyhanesi', 'meyhane', 3000), ('selanik', 'Selanik Antreposu', 'antrepo', 3500),
  ('pire', 'Pire Gazinosu', 'gazino', 5000), ('pire', 'Liman Tavernası', 'meyhane', 3000), ('pire', 'Rıhtım Kahvehanesi', 'kahvehane', 2500),
  ('iskenderiye', 'Corniche Gazinosu', 'gazino', 5500), ('iskenderiye', 'Çarşı Kahvehanesi', 'kahvehane', 2500), ('iskenderiye', 'Mısır Antreposu', 'antrepo', 4000),
  ('beyrut', 'Beyrut Gazinosu', 'gazino', 5500), ('beyrut', 'Şam Yolu Kahvehanesi', 'kahvehane', 2500), ('beyrut', 'Levant Antreposu', 'antrepo', 4000);

alter table families add column raid_ready_at timestamptz not null default now();

-- Sahipsiz mekânı yerel kabadayılar korur: gelire göre sabit savunma
create or replace function spot_base_defense(s spots) returns int
language sql immutable as $$ select (s.income / 10)::int $$;

-- Birikmiş haracı sahip ailenin kasasına aktarır (tembel, cron gerekmez)
create or replace function collect_spots() returns void
language plpgsql as $$
declare s spots; hours int;
begin
  for s in select * from spots where collected_at <= now() - interval '1 hour' for update loop
    hours := floor(extract(epoch from now() - s.collected_at) / 3600);
    if s.owner_family is not null then
      update families set bank = bank + least(hours, setting('spot_income_cap_h')) * s.income where id = s.owner_family;
    end if;
    update spots set collected_at = collected_at + make_interval(hours => hours) where id = s.id;
  end loop;
end $$;

create or replace function online_in_city(fid bigint, city text) returns int
language sql stable as $$
  select count(*)::int from players where family_id = fid and city_id = city
    and last_seen > now() - interval '15 minutes' and hospital_until <= now() and jail_until <= now()
$$;

create or replace function raid_spot(p_spot int, p_bullets int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; s spots; f families; allies int; defenders int := 0; power numeric; def_power numeric; msg text;
        prev_owner bigint; fname text;
begin
  perform collect_spots();
  p := me_for_update();
  if blocked_msg(p) is not null then return fail(blocked_msg(p)); end if;
  if p.family_role is null or p.family_role not in ('don', 'sottocapo', 'capo') then
    return fail('Baskını ancak Don, Sottocapo ya da bir Capo yönetebilir.');
  end if;
  if p_bullets < 1 then return fail('Kaç kurşunla gireceğini yaz.'); end if;
  if p.bullets < p_bullets then return fail('O kadar kurşunun yok.'); end if;
  select * into s from spots where id = p_spot for update;
  if not found then raise exception 'BAD_SPOT'; end if;
  if s.city_id <> p.city_id then return fail('Baskın için mekânın şehrinde olmalısın.'); end if;
  if s.owner_family = p.family_id then return fail('Burası zaten sizin.'); end if;
  if s.protected_until > now() then return fail('Mekân yeni el değiştirdi; ' || fmt_wait(s.protected_until) || ' sonra.'); end if;
  select * into f from families where id = p.family_id for update;
  if f.raid_ready_at > now() then return fail('Ailen yeni baskın yaptı; ' || fmt_wait(f.raid_ready_at) || ' bekle.'); end if;

  allies := online_in_city(p.family_id, p.city_id);
  power := p_bullets * (1 + setting('raid_ally_bonus') * greatest(0, allies - 1));
  if s.owner_family is null then
    def_power := spot_base_defense(s);
  else
    defenders := online_in_city(s.owner_family, s.city_id);
    def_power := s.defense * (1 + setting('raid_ally_bonus') * defenders);
  end if;

  update players set bullets = bullets - p_bullets where id = p.id;
  update families set raid_ready_at = now() + make_interval(secs => setting('raid_cooldown_s')) where id = f.id;
  prev_owner := s.owner_family;

  if power > def_power then
    update spots set owner_family = f.id, defense = floor(p_bullets * 0.25), collected_at = now(),
      protected_until = now() + make_interval(secs => setting('spot_protect_s')) where id = s.id;
    msg := s.name || ' baskınla ele geçirildi! (' || p_bullets || ' kurşun, ' || allies || ' adam)';
    perform family_msg(f.id, null, p.nick || ' liderliğinde ' || msg);
    if prev_owner is not null then
      select name into fname from families where id = f.id;
      perform family_msg(prev_owner, null, s.name || ' ' || fname || ' ailesinin baskınıyla elimizden çıktı!');
    end if;
    return jsonb_build_object('ok', true, 'success', true, 'msg', msg);
  end if;

  if prev_owner is not null then
    update spots set defense = greatest(0, defense - floor(p_bullets * 0.5)) where id = s.id;
    select name into fname from families where id = f.id;
    perform family_msg(prev_owner, null, fname || ' ailesi ' || s.name || ' mekânına baskın yaptı ama püskürtüldü.');
  end if;
  msg := s.name || ' baskını püskürtüldü. ' || p_bullets || ' kurşun boşa gitti.';
  perform family_msg(f.id, null, p.nick || ': ' || msg);
  return jsonb_build_object('ok', true, 'success', false, 'msg', msg);
end $$;

create or replace function fortify_spot(p_spot int, p_bullets int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players; s spots;
begin
  p := me_for_update();
  if p_bullets < 1 then return fail('Kaç kurşun bırakacağını yaz.'); end if;
  if p.bullets < p_bullets then return fail('O kadar kurşunun yok.'); end if;
  select * into s from spots where id = p_spot for update;
  if not found or s.owner_family is distinct from p.family_id then return fail('Bu mekân ailenin değil.'); end if;
  if s.city_id <> p.city_id then return fail('Mekânın şehrinde olmalısın.'); end if;
  if s.defense + p_bullets > setting('spot_defense_cap') then
    return fail('Mekâna en fazla ' || (setting('spot_defense_cap') - s.defense) || ' kurşun daha sığar.');
  end if;
  update players set bullets = bullets - p_bullets where id = p.id;
  update spots set defense = defense + p_bullets where id = s.id;
  return done(s.name || ' tahkim edildi (+' || p_bullets || ' kurşun).');
end $$;

create or replace function get_spots() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me players;
begin
  perform collect_spots();
  select * into me from players where id = auth.uid();
  return jsonb_build_object('spots', (select jsonb_agg(jsonb_build_object(
      'id', s.id, 'city', s.city_id, 'name', s.name, 'kind', s.kind, 'income', s.income,
      'owner', f.name, 'mine', s.owner_family is not null and s.owner_family = me.family_id,
      -- savunmanın tam sayısını sadece sahipler görür; diğerleri kabaca
      'defense', case when s.owner_family = me.family_id then s.defense end,
      'strength', case
         when s.owner_family is null then 'yerel kabadayılar'
         when s.defense < 500 then 'zayıf' when s.defense < 3000 then 'orta' else 'güçlü' end,
      'protected_until', case when s.protected_until > now() then s.protected_until end)
    order by s.city_id = me.city_id desc, s.city_id, s.income desc)
    from spots s left join families f on f.id = s.owner_family),
    'raid_ready_at', (select raid_ready_at from families where id = me.family_id and raid_ready_at > now()));
end $$;

-- Aile listesinde mekân sayısı, aile ekranında haraç tahsili
alter function get_families() rename to families_core;
create or replace function get_families() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(f || jsonb_build_object('spots',
    (select count(*) from spots s join families fa on fa.id = s.owner_family where fa.name = f->>'name'))), '[]')
  from jsonb_array_elements(families_core()) f
$$;

alter function get_family() rename to family_social;
create or replace function get_family() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform collect_spots();
  return family_social();
end $$;

-- Kumarhane: kaybedilen bahsin payı şehrin gazinosunun sahibine
alter function play_casino(text, bigint, text) rename to play_casino_core;
create or replace function play_casino(p_game text, p_bet bigint, p_choice text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; owner bigint;
begin
  r := play_casino_core(p_game, p_bet, p_choice);
  if (r->>'ok')::boolean and (r->>'win')::bigint = 0 then
    select owner_family into owner from spots
      where kind = 'gazino' and city_id = (select city_id from players where id = auth.uid());
    if owner is not null then
      update families set bank = bank + floor(p_bet * setting('casino_owner_cut')) where id = owner;
    end if;
  end if;
  return r;
end $$;

insert into api_rpcs values ('raid_spot(integer, integer)'), ('fortify_spot(integer, integer)'), ('get_spots()');
select apply_grants();
