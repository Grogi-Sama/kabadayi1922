// Supabase Edge Function "push": her dakika zamanlayıcı (pg_cron + pg_net) çağırır.
// 1) süresi az önce dolanları kuyruğa ekler, 2) kuyruktaki bildirimleri Web Push ile gönderir, 3) ölü abonelikleri siler.
// Sırlar (Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…), CRON_SECRET
// SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY Supabase tarafından otomatik verilir (koda yazılmaz).
// Fonksiyon ayarlarında "Verify JWT" KAPALI olmalı; çağrıyı CRON_SECRET başlığı korur.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const env = Deno.env.toObject();
webpush.setVapidDetails(env.VAPID_SUBJECT || 'mailto:info@omnipopgames.com', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (!env.CRON_SECRET || req.headers.get('x-cron-secret') !== env.CRON_SECRET) return new Response('yetkisiz', { status: 401 });
  await db.rpc('queue_ready_pushes');
  const { data, error } = await db.rpc('push_take', { p_limit: 200 });
  if (error) return new Response(error.message, { status: 500 });
  let sent = 0, gone = 0;
  await Promise.all((data ?? []).map(async (r: any) => {
    try {
      await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
        JSON.stringify({ title: r.title, body: r.body, tag: r.tag }), { TTL: 3600 });
      sent++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) { gone++; await db.rpc('push_drop_sub', { p_endpoint: r.endpoint }); }
    }
  }));
  if (Math.random() < 0.02) await db.rpc('push_cleanup');
  return Response.json({ sent, gone });
});
