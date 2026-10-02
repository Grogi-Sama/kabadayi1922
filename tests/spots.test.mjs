// Faz 3B: mekânlar, haraç, baskın, tahkim, gazino payı.
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player, set, get } = await setup();
const RANK5 = 3000;
const A = await player('Arif', { xp: RANK5, cash: 1e6, bullets: 20000 });
const A2 = await player('Adil', { xp: 900, bullets: 1000 });
const B = await player('Burak', { xp: RANK5, cash: 1e6, bullets: 20000 });
await as(A, `select create_family('Aslanlar')`);
await as(A2, `select apply_family('Aslanlar')`); await as(A, `select answer_application('Adil', true)`);
await as(B, `select create_family('Boğalar')`);
const spotId = async (name) => (await db.query(`select id from spots where name = $1`, [name])).rows[0].id;
const pera = await spotId('Pera Gazinosu'), galata = await spotId('Galata Meyhanesi'), kordon = await spotId('Kordon Gazinosu');
const bank = async (name) => Number((await db.query(`select bank from families where name = $1`, [name])).rows[0].bank);

// ─── Yetki ve konum
assert.match((await as(A2, `select raid_spot($1, 1000)`, [pera])).msg, /Capo/, 'asker baskın yönetemez');
assert.match((await as(A, `select raid_spot($1, 1000)`, [kordon])).msg, /şehrinde/);
ok('baskın yetkisi + aynı şehir şartı');

// ─── Sahipsiz mekânı al
assert.equal((await as(A, `select raid_spot($1, 100)`, [pera])).success, false, 'yerel savunmayı (600) geçemez');
assert.match((await as(A, `select raid_spot($1, 1000)`, [pera])).msg, /bekle/, 'aile baskın bekleme süresi');
await db.exec(`update families set raid_ready_at = now()`);
const r = await as(A, `select raid_spot($1, 1000)`, [pera]);
assert.equal(r.success, true, r.msg);
let spots = (await as(A, `select get_spots()`)).spots;
const p1 = spots.find(s => s.id === pera);
assert.equal(p1.owner, 'Aslanlar'); assert.equal(p1.mine, true); assert.equal(p1.defense, 250);
assert.equal((await as(B, `select get_spots()`)).spots.find(s => s.id === pera).defense, null, 'rakip tam savunmayı göremez');
ok('sahipsiz mekân ele geçirildi, savunma gizli');

// ─── Koruma süresi, tahkim
await db.exec(`update families set raid_ready_at = now()`);
assert.match((await as(B, `select raid_spot($1, 5000)`, [pera])).msg, /el değiştirdi/);
assert.equal((await as(A2, `select fortify_spot($1, 500)`, [pera])).ok, true, 'her üye tahkim edebilir');
assert.equal((await as(B, `select fortify_spot($1, 10)`, [pera])).ok, false);
assert.equal((await as(A, `select fortify_spot($1, 20000)`, [pera])).ok, false, 'tavan');
ok('koruma süresi + tahkim');

// ─── Haraç: saatlik, 24 saat tavanı
const before = await bank('Aslanlar');
await db.query(`update spots set collected_at = now() - interval '3 hours 10 minutes' where id = $1`, [pera]);
await as(A, `select get_family()`);
assert.equal(await bank('Aslanlar') - before, 3 * 6000);
await db.query(`update spots set collected_at = now() - interval '100 hours' where id = $1`, [pera]);
const b2 = await bank('Aslanlar');
await as(B, `select get_spots()`);
assert.equal(await bank('Aslanlar') - b2, 24 * 6000, '24 saat tavanı');
ok('haraç: saatlik gelir, 24 sa tavanı');

// ─── Rakip baskını: savunma + çevrimiçi savunucu bonusu
await db.query(`update spots set protected_until = now() where id = $1`, [pera]);
await db.exec(`update families set raid_ready_at = now()`);
// 023: barikat canı 750/10 * (1 + 0.15*2) = 97,5; yarısını kırmak 5 turda ~975 kurşun ister
assert.equal((await as(B, `select raid_spot($1, 800)`, [pera])).success, false, 'savunucular varken 800 yetmez');
const left = (await as(A, `select get_spots()`)).spots.find(s => s.id === pera).defense;
assert.equal(left, 750 - 400, 'başarısız baskın savunmayı aşındırır');
await db.exec(`update families set raid_ready_at = now()`);
assert.equal((await as(B, `select raid_spot($1, 600)`, [pera])).success, true, 'aşınmış savunma düşer');
assert.equal((await as(A, `select get_spots()`)).spots.find(s => s.id === pera).owner, 'Boğalar');
const famA = await as(A, `select get_family()`);
assert.ok(famA.messages.some(m => /elimizden çıktı/.test(m.text)), 'eski sahibe haber gider');
ok(`rakip baskını: savunucu bonusu, aşınma, el değiştirme (kalan savunma ${left})`);

// ─── Gazino payı
const bb = await bank('Boğalar');
let lost = 0;
for (let i = 0; i < 30; i++) {
  await db.exec(`update players set casino_ready_at = now()`);
  const g = await as(A, `select play_casino('rulet', 1000, '17')`);
  if (Number(g.win) === 0) lost++;
}
assert.equal(await bank('Boğalar') - bb, lost * 100);
ok(`gazino sahibi kaybedilen ${lost} bahisten %10 aldı`);

// ─── Aile listesi
const fams = await as(A, `select get_families()`);
assert.equal(fams.find(f => f.name === 'Boğalar').spots, 1);
ok('aile listesinde mekân sayısı');

done('spots');
