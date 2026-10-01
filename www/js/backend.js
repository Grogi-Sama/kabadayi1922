// Oyunun sunucuyla konuştuğu tek yer. İki uygulama, aynı arayüz: rpc(ad, argümanlar).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Yükleme ekranı için ilerleme bildirimi: (0–1 arası oran, aşama yazısı)
let report = () => {};
export async function createBackend(onProgress) {
  if (onProgress) report = onProgress;
  return SUPABASE_URL ? supabaseBackend() : localBackend();
}

async function supabaseBackend() {
  report(0.3, 'Sunucuya bağlanılıyor…');
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: { session } } = await client.auth.getSession();
  if (!session) {
    const { error } = await client.auth.signInAnonymously();
    if (error) throw error;
  }
  return {
    mode: 'online',
    async rpc(name, args = {}) {
      const { data, error } = await client.rpc(name, args);
      if (error) throw error;
      return data;
    },
  };
}

// Geliştirme modu: PGlite (tarayıcıda gerçek Postgres) + aynı migration dosyaları.
const LOCAL_UID = '00000000-0000-0000-0000-000000000001';
const MIGRATIONS = ['001_core.sql', '002_combat.sql', '003_families.sql', '004_crews.sql', '005_casino_transport.sql',
  '006_social.sql', '007_spots.sql', '008_bigjobs_races.sql', '009_extras.sql', '010_admin_seasons.sql', '011_avatar.sql', '012_chat.sql', '013_roles.sql', '014_filter.sql', '015_crests.sql', '016_lockdown.sql', '017_appeals.sql'];

const IDB_NAME = '/pglite/kabadayi-dev';
const deleteLocalDb = () => new Promise(r => {
  const q = indexedDB.deleteDatabase(IDB_NAME); q.onsuccess = q.onerror = q.onblocked = r;
});

async function localBackend() {
  // Yollar sayfaya göre: localhost:5180/www/ ve GitHub Pages (/kabadayi1922/www/) ikisinde de çalışsın.
  // PGlite yerelde node_modules'tan, yayında (node_modules yok) CDN'den gelir.
  const rel = (p) => new URL('../' + p, location.href).href;
  let PGlite;
  report(0.05, 'Oyun motoru yükleniyor…');
  try { ({ PGlite } = await import(rel('node_modules/@electric-sql/pglite/dist/index.js'))); }
  catch { ({ PGlite } = await import('https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.5.8/dist/index.js')); }
  const load = async (p) => (await fetch(rel(p))).text();
  report(0.15, 'Şehir kuralları okunuyor…');
  const sql = [await load('supabase/local-shim.sql'),
    ...await Promise.all(MIGRATIONS.map(m => load('supabase/migrations/' + m))),
    await load('supabase/local-seed.sql')];
  const version = String(sql.join('').split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0));

  report(0.25, 'Veritabanı açılıyor…');
  let db = new PGlite('idb://kabadayi-dev');
  // SQL kuralları değiştiyse yerel veritabanını baştan kur (sadece geliştirme modu)
  if (localStorage.getItem('kabadayi-sql-version') !== version) {
    await db.close();
    await deleteLocalDb();
    db = new PGlite('idb://kabadayi-dev');
    // İlk açılış: bütün kurallar tarayıcıda kurulur (en uzun adım)
    for (const [i, s] of sql.entries()) {
      report(0.3 + 0.65 * i / sql.length, `Şehir kuruluyor… (${i + 1}/${sql.length})`);
      await db.exec(s);
    }
    await db.exec(`insert into auth.users values ('${LOCAL_UID}');`);
    // Yönetim paneli yerelde sadece geliştiricinin kendi bilgisayarında (localhost) açılır;
    // yayındaki deneme sürümünde (GitHub Pages) kimse yetkili değildir.
    if (['localhost', '127.0.0.1'].includes(location.hostname)) {
      await db.exec(`insert into admins (user_id, role) values ('${LOCAL_UID}', 'owner');`);
    }
    localStorage.setItem('kabadayi-sql-version', version);
  }
  report(0.97, 'Sokaklara çıkılıyor…');
  await db.query(`select set_config('test.uid', $1, false)`, [LOCAL_UID]);
  return {
    mode: 'local',
    async rpc(name, args = {}) {
      const keys = Object.keys(args);
      const sql = `select ${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) r`;
      return (await db.query(sql, keys.map(k => args[k]))).rows[0].r;
    },
    // Sadece geliştirme: konsoldan ham SQL (ör. hızlı test için rütbe/para ayarlamak)
    sql: (q, params) => db.query(q, params),
    async reset() {
      await db.close();
      await deleteLocalDb();
      localStorage.removeItem('kabadayi-sql-version');
    },
  };
}
