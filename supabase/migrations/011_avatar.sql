-- Faz 4B: oyuncu portresi (8 hazır portreden biri). Sadece görünüş; oyun etkisi yok.

alter table players add column avatar int not null default 1 check (avatar between 1 and 8);

create or replace function set_avatar(p_avatar int) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_avatar not between 1 and 8 then raise exception 'BAD_AVATAR'; end if;
  perform me_for_update();
  update players set avatar = p_avatar where id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

alter function get_profile(text) rename to profile_seasons;
create or replace function get_profile(p_nick text) returns jsonb
language sql stable security definer set search_path = public as $$
  select profile_seasons(p_nick) || jsonb_build_object('avatar', t.avatar)
  from players t where lower(t.nick) = lower(p_nick)
$$;

alter function get_state() rename to state_seasons;
create or replace function get_state() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare base jsonb := state_seasons();
begin
  if base->'player' is null or base->'player' = 'null'::jsonb then return base; end if;
  -- arabalara türünü de ekle (ikon seçimi için)
  base := jsonb_set(base, '{cars}', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', pc.id, 'type', c.id, 'name', c.name, 'value', c.value, 'city', pc.city_id) order by pc.id desc), '[]')
    from player_cars pc join cars c on c.id = pc.car_id where pc.player_id = auth.uid()));
  return jsonb_set(base, '{player}', (base->'player') ||
    jsonb_build_object('avatar', (select avatar from players where id = auth.uid())));
end $$;

-- Aile ekranları için portreler: listede Don'unki, aile ekranında her üyeninki
alter function get_families() rename to families_spots;
create or replace function get_families() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(f || jsonb_build_object('don_avatar', (select p.avatar from players p where p.nick = f->>'don'))
    order by i), '[]')
  from jsonb_array_elements(families_spots()) with ordinality t(f, i)
$$;

alter function get_family() rename to family_spots;
create or replace function get_family() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := family_spots();
begin
  if jsonb_typeof(r->'members') is distinct from 'array' then return r; end if;
  return jsonb_set(r, '{members}', (select coalesce(jsonb_agg(m || jsonb_build_object('avatar', p.avatar) order by i), '[]')
    from jsonb_array_elements(r->'members') with ordinality t(m, i) left join players p on p.nick = m->>'nick'));
end $$;

-- Defter: çevrimiçi ve en büyükler listesinde portreler
alter function get_players() rename to players_core;
create or replace function get_players() returns jsonb
language sql stable security definer set search_path = public as $$
  select r || jsonb_build_object(
    'online', (select coalesce(jsonb_agg(o || jsonb_build_object('avatar', p.avatar) order by i), '[]')
      from jsonb_array_elements(r->'online') with ordinality t(o, i) left join players p on p.nick = o->>'nick'),
    'top', (select coalesce(jsonb_agg(o || jsonb_build_object('avatar', p.avatar) order by i), '[]')
      from jsonb_array_elements(r->'top') with ordinality t(o, i) left join players p on p.nick = o->>'nick'))
  from (select players_core() r) x
$$;

insert into api_rpcs values ('set_avatar(integer)');
select apply_grants();
