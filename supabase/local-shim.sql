-- Sadece yerel geliştirme/test için: Supabase'in auth parçalarını taklit eder.
-- Gerçek Supabase'de bu dosya ÇALIŞTIRILMAZ.
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
