-- Bildirim zamanlayıcısı: SADECE canlı Supabase'de, 032 yüklendikten ve "push" Edge Function'ı kurulduktan sonra bir kez çalıştırılır.
-- <CRON_SECRET> yerine Edge Function sırlarına yazdığın değerin aynısını koy (bu dosyada gerçek değer TUTULMAZ, repo açık).
create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'kabadayi-push';
select cron.schedule('kabadayi-push', '* * * * *', $$
  select net.http_post(
    url     := 'https://egabjhoezsnrwoemgrhn.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{}'::jsonb)
$$);
