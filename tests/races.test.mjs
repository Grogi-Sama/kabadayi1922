// Faz 3C: 8 kişilik büyük vurgun + yarışlar.
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player, set, get } = await setup();
const RANK6 = 6000;
const car = async (uid, kind, city = 'istanbul') => (await db.query(
  `insert into player_cars (player_id, car_id, city_id) values ($1, $2, $3) returning id`, [uid, kind, city])).rows[0].id;

// ─── Büyük vurgun: 8 rol, çoklu şoför/silahçı şartları
const nicks = ['Lider8', 'Sof1', 'Sof2', 'Sof3', 'Sil1', 'Sil2', 'Sil3', 'Pat1'];
const ids = {};
for (const n of nicks) ids[n] = await player(n, { xp: RANK6, cash: 500000, weapon_id: 'tabanca', bullets: 1000 });
const invites = { sofor: 'Sof1', sofor2: 'Sof2', sofor3: 'Sof3', silahci: 'Sil1', silahci2: 'Sil2', silahci3: 'Sil3', patlayici: 'Pat1' };
assert.equal((await as(ids.Lider8, `select create_crew('buyuk', $1)`, [invites])).ok, true);
const crewId = (await as(ids.Sof2, `select get_crews()`)).crews[0].id;
const members = (await as(ids.Sof2, `select get_crews()`)).crews[0].members;
assert.equal(members.length, 8);
for (const n of nicks.slice(1)) await as(ids[n], `select respond_crew($1, true)`, [crewId]);
assert.match((await as(ids.Lider8, `select start_crew()`)).msg, /Sof1 .*araba/, 'her şoför araba ister');
for (const n of ['Sof1', 'Sof2']) await car(ids[n], 'sedan');
assert.match((await as(ids.Lider8, `select start_crew()`)).msg, /Sof3/);
await car(ids.Sof3, 'sedan');
await set(ids.Sil3, { bullets: 10 });
assert.match((await as(ids.Lider8, `select start_crew()`)).msg, /Sil3/, 'her silahçı kurşun ister');
await set(ids.Sil3, { bullets: 1000 });
const r = await as(ids.Lider8, `select start_crew()`);
assert.equal(r.ok, true, r.msg);
for (const n of ['Sil1', 'Sil2', 'Sil3']) assert.equal((await get(ids[n])).bullets, 900, 'üç silahçı da kurşun harcar');
assert.equal((await get(ids.Pat1)).cash >= 500000 - 15000, true);
ok(`büyük vurgun: 8 rol, çoklu şart — ${r.msg}`);

// ─── Yarış
const A = await player('Yarisci_A', { cash: 100000 });
const B = await player('Yarisci_B', { cash: 100000 });
const C = await player('Yarisci_C', { cash: 500 });
const ca = await car(A, 'limuzin'), cb = await car(B, 'kamyonet'), cc = await car(C, 'taksi');
const cOther = await car(B, 'spor', 'izmir');
assert.equal((await as(A, `select create_race(500, $1)`, [ca])).ok, false, 'min ücret');
assert.equal((await as(A, `select create_race(5000, $1)`, [cb])).ok, false, 'başkasının arabası');
assert.equal((await as(A, `select create_race(5000, $1)`, [ca])).ok, true);
let races = await as(B, `select get_races()`);
const rid = races.open[0].id;
assert.equal((await as(B, `select join_race($1, $2)`, [rid, cOther])).ok, false, 'araba başka şehirde');
assert.equal((await as(B, `select join_race($1, $2)`, [rid, cb])).ok, true);
assert.equal((await as(C, `select join_race($1, $2)`, [rid, cc])).ok, false, 'ücret yetmez');
assert.equal((await as(B, `select start_race()`)).ok, false, 'sadece ev sahibi başlatır');
const res = await as(A, `select start_race()`);
assert.equal(res.ok, true, res.msg);
const winnerCash = Math.max((await get(A)).cash, (await get(B)).cash);
assert.equal(winnerCash, 100000 - 5000 + 9500, 'kazanan havuzun %95\'ini alır');
const fa = Number((await get(A)).race_form), fb = Number((await get(B)).race_form);
assert.deepEqual([fa, fb].sort(), [0, 0.5]);
ok(`yarış: ${res.msg}`);

// ─── Elenme: yarıştan önce araba satılırsa iade
await as(A, `select create_race(2000, $1)`, [ca]);
const rid2 = (await as(B, `select get_races()`)).open[0].id;
await as(B, `select join_race($1, $2)`, [rid2, cb]);
const bCash = (await get(B)).cash;
await as(B, `select sell_car($1)`, [cb]);
assert.equal((await as(A, `select start_race()`)).ok, false, 'tek kişi kaldı');
assert.equal((await get(B)).cash, bCash + 250 + 2000, 'elenen iade alır');
ok('arabasını satan yarışçı elenir, ücreti iade edilir');

// ─── Süre aşımı ve çekilme
await db.exec(`update races set created_at = now() - interval '31 minutes' where status = 'open'`);
const aCash = (await get(A)).cash;
await as(A, `select get_races()`);
assert.equal((await get(A)).cash, aCash + 2000, 'süresi dolan yarışın ücreti iade');
await as(A, `select create_race(3000, $1)`, [ca]);
assert.equal((await as(A, `select leave_race()`)).ok, true);
assert.equal((await get(A)).cash, aCash + 2000);
ok('süre aşımı + iptal iadeleri');

done('races');
