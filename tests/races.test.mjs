// Faz 3C: 8 kişilik büyük vurgun + yarışlar.
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player, set, get } = await setup();
const RANK6 = 6000;
const car = async (uid, kind, city = 'istanbul') => (await db.query(
  `insert into player_cars (player_id, car_id, city_id) values ($1, $2, $3) returning id`, [uid, kind, city])).rows[0].id;

// ─── Büyük vurgun: 8 rol, çoklu şoför/silahçı şartları
const nicks = ['LiderSekiz', 'SofBir', 'SofIki', 'SofUc', 'SilBir', 'SilIki', 'SilUc', 'PatBir'];
const ids = {};
for (const n of nicks) ids[n] = await player(n, { xp: RANK6, cash: 500000, weapon_id: 'tabanca', bullets: 1000 });
const invites = { sofor: 'SofBir', sofor2: 'SofIki', sofor3: 'SofUc', silahci: 'SilBir', silahci2: 'SilIki', silahci3: 'SilUc', patlayici: 'PatBir' };
assert.equal((await as(ids.LiderSekiz, `select create_crew('buyuk', $1)`, [invites])).ok, true);
const crewId = (await as(ids.SofIki, `select get_crews()`)).crews[0].id;
const members = (await as(ids.SofIki, `select get_crews()`)).crews[0].members;
assert.equal(members.length, 8);
for (const n of nicks.slice(1)) await as(ids[n], `select respond_crew($1, true)`, [crewId]);
assert.match((await as(ids.LiderSekiz, `select start_crew()`)).msg, /SofBir .*araba/, 'her şoför araba ister');
for (const n of ['SofBir', 'SofIki']) await car(ids[n], 'sedan');
assert.match((await as(ids.LiderSekiz, `select start_crew()`)).msg, /SofUc/);
await car(ids.SofUc, 'sedan');
await set(ids.SilUc, { bullets: 10 });
assert.match((await as(ids.LiderSekiz, `select start_crew()`)).msg, /SilUc/, 'her silahçı kurşun ister');
await set(ids.SilUc, { bullets: 1000 });
const r = await as(ids.LiderSekiz, `select start_crew()`);
assert.equal(r.ok, true, r.msg);
for (const n of ['SilBir', 'SilIki', 'SilUc']) assert.equal((await get(ids[n])).bullets, 900, 'üç silahçı da kurşun harcar');
assert.equal((await get(ids.PatBir)).cash >= 500000 - 15000, true);
ok(`büyük vurgun: 8 rol, çoklu şart — ${r.msg}`);

// ─── Yarış
const A = await player('YarisciA', { cash: 100000 });
const B = await player('YarisciB', { cash: 100000 });
const C = await player('YarisciC', { cash: 500 });
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
