// Faz 2C: ekip işleri (soygun, organize iş).
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player, set, get } = await setup();
const RANK4 = 1500;
const crews = (uid) => as(uid, `select get_crews()`);
const giveCar = (uid, car, city = 'istanbul') =>
  db.query(`insert into player_cars (player_id, car_id, city_id) values ($1, $2, $3)`, [uid, car, city]);

const L = await player('Lider', { xp: RANK4, cash: 100000, weapon_id: 'tabanca', bullets: 500 });
const S = await player('Sofor', { xp: RANK4 });
const G = await player('Silahci', { xp: RANK4, weapon_id: 'tabanca', bullets: 500 });
const E = await player('Patlayici', { xp: RANK4, cash: 50000 });
const C = await player('Caylak', { xp: 10 });

// ─── Kurma kuralları
assert.equal((await as(L, `select create_crew('soygun', $1)`, [{ sofor: 'Caylak' }])).ok, false, 'çaylak davet edilemez');
assert.equal((await as(L, `select create_crew('soygun', $1)`, [{ sofor: 'Lider' }])).ok, false, 'kendini davet edemez');
assert.equal((await as(L, `select create_crew('organize', $1)`, [{ sofor: 'Sofor', silahci: 'Sofor', patlayici: 'Patlayici' }])).ok, false, 'iki rol');
assert.equal((await as(L, `select create_crew('soygun', $1)`, [{ sofor: 'Sofor' }])).ok, true);
assert.equal((await as(L, `select create_crew('soygun', $1)`, [{ sofor: 'Sofor' }])).ok, false, 'tek ekip');
let cs = await crews(S);
const crewId = cs.crews[0].id;
assert.equal(cs.crews[0].leader, 'Lider');
ok('ekip kurma kuralları + davet görünür');

// ─── Şartlar başlatmada kontrol edilir
let r = await as(L, `select start_crew()`);
assert.match(r.msg, /kabul etmedi/);
await as(S, `select respond_crew($1, true)`, [crewId]);
r = await as(L, `select start_crew()`);
assert.match(r.msg, /araba/, 'şoförün arabası yok');
await giveCar(S, 'kamyonet');
assert.match((await as(L, `select start_crew()`)).msg, /araba/, 'araba değeri yetersiz');
await giveCar(S, 'aile');
await set(S, { city_id: 'izmir' });
assert.match((await as(L, `select start_crew()`)).msg, /şehirde değil/);
await set(S, { city_id: 'istanbul' });
ok('şartlar: kabul, araba değeri, aynı şehir');

// ─── Başlat: masraflar, bekleme süresi, sonuç
const cashBefore = (await get(L)).cash;
r = await as(L, `select start_crew()`);
assert.equal(r.ok, true, JSON.stringify(r));
const l = await get(L);
if (r.success) assert.ok(l.cash > cashBefore - 5000, 'kazançlı');
else assert.equal(l.cash, cashBefore - 5000);
assert.equal(l.bullets, 450, 'lider 50 kurşun harcar');
cs = await crews(L);
assert.equal(cs.crews[0].status, 'done');
assert.ok(cs.types.find(t => t.id === 'soygun').ready_at, 'bekleme süresi başladı');
await db.exec(`update players set jail_until = now()`);
assert.match((await as(L, `select create_crew('soygun', $1)`, [{ sofor: 'Sofor' }])).msg, /beklemelisin/);
ok(`soygun: ${r.success ? 'başarılı' : 'başarısız'} — ${r.msg}`);

// ─── Organize iş: çok sayıda deneme, ekonomi ve kurallar tutarlı
let wins = 0, jails = 0;
for (let i = 0; i < 40; i++) {
  await db.exec(`delete from player_cooldowns; update players set jail_until = now(), cash = greatest(cash, 100000),
    bullets = greatest(bullets, 500)`);
  await db.query(`insert into player_cars (player_id, car_id, city_id) select $1, 'spor', 'istanbul'
    where not exists (select 1 from player_cars where player_id = $1 and car_id = 'spor')`, [S]);
  const c = await as(L, `select create_crew('organize', $1)`, [{ sofor: 'Sofor', silahci: 'Silahci', patlayici: 'Patlayici' }]);
  assert.equal(c.ok, true, c.msg);
  const id = (await crews(L)).crews[0].id;
  for (const u of [S, G, E]) await as(u, `select respond_crew($1, true)`, [id]);
  const res = await as(L, `select start_crew()`);
  assert.equal(res.ok, true, res.msg);
  if (res.success) wins++;
  if (/içeri alındı/.test(res.msg)) jails++;
}
assert.ok(wins > 10 && wins < 35, `başarı oranı makul: ${wins}/40`);
ok(`organize iş: 40 denemede ${wins} başarı, ${jails} toplu hapis`);

// ─── Red & iptal
await db.exec(`delete from player_cooldowns; update players set jail_until = now()`);
await as(L, `select create_crew('soygun', $1)`, [{ sofor: 'Sofor' }]);
let id = (await crews(L)).crews[0].id;
await as(S, `select respond_crew($1, false)`, [id]);
assert.equal((await crews(L)).crews[0].status, 'cancelled');
assert.equal((await as(G, `select respond_crew($1, true)`, [id])).ok, false, 'davetsiz katılamaz');
await as(L, `select create_crew('soygun', $1)`, [{ sofor: 'Sofor' }]);
assert.equal((await as(L, `select cancel_crew()`)).ok, true);
// süre aşımı
await as(L, `select create_crew('soygun', $1)`, [{ sofor: 'Sofor' }]);
await db.exec(`update crews set created_at = now() - interval '31 minutes' where status = 'forming'`);
assert.equal((await crews(L)).crews[0].status, 'cancelled');
ok('red, iptal ve süre aşımı');

done('crews');
