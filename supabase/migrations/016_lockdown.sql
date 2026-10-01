-- Çok oyunculu yayına geçmeden kilit: oyuncular veritabanına SADECE izinli oyun fonksiyonlarıyla (RPC) erişir.
-- Supabase, public şemadaki tabloları varsayılan olarak REST üzerinden anon/authenticated rollerine açar.
-- Satır güvenliği (RLS) açık + hiç policy yok = tablolara doğrudan okuma/yazma tamamen kapalı.
-- Oyun fonksiyonları "security definer" olduğu için kendi işlerini yapmaya devam eder.
-- apply_grants() her migration sonunda çalıştığı için ileride eklenecek tablolar da otomatik kilitlenir.

create or replace function apply_grants() returns void
language plpgsql as $$
declare s text; t record;
begin
  -- Fonksiyonlar: sadece api_rpcs listesindekiler çağrılabilir
  execute 'revoke execute on all functions in schema public from public, anon, authenticated';
  for s in select sig from api_rpcs loop
    execute format('grant execute on function %s to authenticated', s);
  end loop;
  -- Tablolar: RLS açık, istemci rollerinin hiçbir doğrudan yetkisi yok
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('revoke all on table public.%I from public, anon, authenticated', t.tablename);
  end loop;
  execute 'revoke all on all sequences in schema public from public, anon, authenticated';
end $$;

-- Bundan sonra oluşturulan tablo/fonksiyonlara istemci rolleri varsayılan yetki almasın
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

select apply_grants();
