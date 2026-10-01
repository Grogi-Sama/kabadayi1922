// Ortak test kurulumu: PGlite + Supabase taklidi + tüm migration'lar sırayla.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../supabase/', import.meta.url);

export async function setup() {
  const db = new PGlite();
  await db.exec(readFileSync(new URL('local-shim.sql', dir), 'utf8'));
  for (const f of readdirSync(new URL('migrations/', dir)).filter(f => f.endsWith('.sql')).sort()) {
    try { await db.exec(readFileSync(new URL('migrations/' + f, dir), 'utf8')); }
    catch (e) { throw new Error(`${f}: ${e.message}${e.where ? ' @ ' + e.where : ''}`); }
  }
  // Planlı etkinlikler gerçek saate bağlı: testler hangi saatte çalışırsa çalışsın etkilenmesin (events testi açar)
  await db.exec(`update game_settings set value = 0 where key = 'ev_planned'`);

  const as = async (uid, sql, params = []) => {
    await db.query(`select set_config('test.uid', $1, false)`, [uid]);
    try {
      const r = await db.query(sql, params);
      return Object.values(r.rows[0])[0];
    } catch (e) {
      throw new Error(`${e.message}${e.where ? ' @ ' + e.where.split(/\n/)[0] : ''} — ${sql}`);
    }
  };

  // Oyuncu oluşturur; istenirse xp/para/şehir ayarlar. uid döner.
  let n = 0;
  const player = async (nick, fields = {}) => {
    const uid = `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`;
    await db.query(`insert into auth.users values ($1)`, [uid]);
    const r = await as(uid, `select create_player($1)`, [nick]);
    if (!r.ok) throw new Error(r.msg);
    await set(uid, fields);
    return uid;
  };
  const set = async (uid, fields) => {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    await db.query(`update players set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`,
      [uid, ...keys.map(k => fields[k])]);
  };
  const get = async (uid) => (await db.query(`select * from players where id = $1`, [uid])).rows[0];
  // Bütün bekleme sürelerini sıfırla
  const ready = (uid) => db.query(`update players set crime_ready_at = now(), car_ready_at = now(),
    travel_ready_at = now(), jail_until = now(), hospital_until = now(), kill_ready_at = now(),
    bust_ready_at = now(), practice_ready_at = now() where id = $1`, [uid]);

  return { db, as, player, set, get, ready };
}

let passed = 0;
export const ok = (name) => { passed++; console.log('  ✓', name); };
export const done = (file) => console.log(`${file}: ${passed} test grubu geçti.\n`);
