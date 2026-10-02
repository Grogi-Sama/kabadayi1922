-- 024: Profilde ve Konak'ta eşin rütbesi ve portresi.

-- Tekrar çalıştırılabilir: yeniden adlandırma sadece ilk seferde
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'profile_gender') then alter function get_profile(text) rename to profile_gender; end if;
  if not exists (select 1 from pg_proc where proname = 'state_gender') then alter function get_state() rename to state_gender; end if;
end $$;
create or replace function get_profile(p_nick text) returns jsonb
language sql stable security definer set search_path = public as $$
  select profile_gender(p_nick) || jsonb_build_object(
    'spouse_rank', (select rank_of(s.xp) from players t join players s on s.id = t.spouse_id where lower(t.nick) = lower(p_nick)),
    'spouse_avatar', (select s.avatar from players t join players s on s.id = t.spouse_id where lower(t.nick) = lower(p_nick)))
$$;

create or replace function get_state() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare base jsonb := state_gender();
begin
  if base->'player' is null or base->'player' = 'null'::jsonb then return base; end if;
  return jsonb_set(base, '{player}', (base->'player') || coalesce((
    select jsonb_build_object('spouse_rank', rank_of(s.xp), 'spouse_avatar', s.avatar, 'spouse_city', s.city_id)
    from players p join players s on s.id = p.spouse_id where p.id = auth.uid()), '{}'));
end $$;

select apply_grants();
