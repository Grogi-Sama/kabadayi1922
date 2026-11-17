-- 038: Uyandırma için giriş gerektirmeyen ping (ücretsiz plan bir hafta hareketsiz kalan projeyi uyutur).
-- GitHub Actions günde bir kez çağırır (.github/workflows/keepalive.yml). Hiçbir oyuncu verisi döndürmez.
-- apply_grants() her seferinde anon yetkilerini sıfırladığı için anon'a açık fonksiyonlar ayrı listede tutulur.
-- Tekrar çalıştırılabilir.

create table if not exists api_rpcs_anon (sig text primary key);
alter table api_rpcs_anon enable row level security;

create or replace function ping() returns text
language sql stable security definer set search_path = public as $$
  select 'ok ' || (select count(*) from seasons)::text   -- veritabanına gerçekten dokunsun
$$;

create or replace function apply_grants() returns void
language plpgsql as $$
declare s text;
begin
  execute 'revoke execute on all functions in schema public from public, anon, authenticated';
  for s in select sig from api_rpcs loop
    execute format('grant execute on function %s to authenticated', s);
  end loop;
  for s in select sig from api_rpcs_anon loop
    execute format('grant execute on function %s to anon, authenticated', s);
  end loop;
end $$;

insert into api_rpcs_anon values ('ping()') on conflict do nothing;
select apply_grants();
