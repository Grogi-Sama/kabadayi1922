-- Aile armaları: ailenin "profil resmi". Başlangıçta 8 ücretsiz arma; 0 = ailenin baş harfiyle otomatik arma.
-- İleride kozmetik arma paketleri eklenecekse: yeni numaralar + sahiplik tablosu (oyun gücü vermez).

alter table families add column crest int not null default 0 check (crest between 0 and 8);

create or replace function set_family_crest(p_crest int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p players;
begin
  p := me_for_update();
  if p_crest not between 0 and 8 then raise exception 'BAD_CREST'; end if;
  if p.family_id is null then return fail('Bir ailen yok.'); end if;
  if p.family_role <> 'don' then return fail('Armayı sadece Don seçer.'); end if;
  update families set crest = p_crest where id = p.family_id;
  return done('Ailenin arması değişti.');
end $$;

alter function get_families() rename to families_avatar;
create or replace function get_families() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(f || jsonb_build_object('crest', (select crest from families where name = f->>'name')) order by i), '[]')
  from jsonb_array_elements(families_avatar()) with ordinality t(f, i)
$$;

alter function get_family() rename to family_avatar;
create or replace function get_family() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := family_avatar();
begin
  if jsonb_typeof(r->'family') is distinct from 'object' then return r; end if;
  return jsonb_set(r, '{family,crest}', to_jsonb((select crest from families where id = (r->'family'->>'id')::bigint)));
end $$;

insert into api_rpcs values ('set_family_crest(integer)');
select apply_grants();
