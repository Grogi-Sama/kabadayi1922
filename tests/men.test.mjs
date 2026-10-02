// 021: adamlar — tutma, eğitim, sınır, maaş/dağılma, koruma, gözcü, baskın gücü ve kayıplar, nöbet, güç
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player, set, ready } = await setup();
const RANK5 = 3000;
const A = await player('Arif', { xp: RANK5, cash: 1e7, bullets: 20000 });
const B = await player('Burak', { xp: RANK5, cash: 1e7, bullets: 20000 });
const C = await player('Cemil', { xp: 0, cash: 1e6 });
const q = (sql, args) => db.query(sql, args);
const train = (uid) => q(`update player_men set ready_at = now() - interval '1 second' where player_id = $1`, [uid]);
const nocd = (uid) => q(`delete from player_cooldowns where player_id = $1 and kind = 'hire_man'`, [uid]);
const hire = async (uid, type, n = 1) => { for (let i = 0; i < n; i++) { await nocd(uid); const r = await as(uid, `select hire_man($1)`, [type]); if (!r.ok) return r; } return { ok: true }; };

// ─── Tutma: fiyat, eğitim, bekleme, rütbe ve sayı sınırı
let r = await as(C, `select hire_man('zorba')`);
assert.equal(r.ok, true); assert.match(r.msg, /dakika eğitim/);
assert.match((await as(C, `select hire_man('zorba')`)).msg, /uğra/, 'iki tutma arası bekleme');
await nocd(C);
assert.match((await as(C, `select hire_man('nisanci')`)).msg, /en az/, 'nişancı rütbe ister');
let m = await as(C, `select get_men()`);
assert.equal(m.owned, 1); assert.equal(m.cap, 5); assert.equal(m.training.length, 1);
assert.equal(m.attack, 0, 'eğitimdeki adam güç vermez');
const t = m.training[0].ready_at, mins = (new Date(t) - Date.now()) / 60000;
assert.ok(mins > 14 && mins <= 20.1, `eğitim 15-20 dk (${mins.toFixed(1)})`);
assert.ok(m.types.find(x => x.id === 'zorba').price > 2000, 'sahip olunan adam fiyatı artırır');
await hire(C, 'zorba', 4);
assert.match((await hire(C, 'zorba')).msg, /en fazla 5/, 'Çaylak en fazla 5 adam');
await train(C);
m = await as(C, `select get_men()`);
assert.equal(m.attack, 15); assert.equal(m.power, 20);
assert.equal((await as(C, `select get_state()`)).player.men, 5);
ok('adam tutma, eğitim, bekleme, rütbe ve sayı sınırı');

// ─── Maaş: günlük kesilir; ödenemezse %2-4 (en az 1) dağılır
await q(`update players set men_paid_at = now() - interval '2 days 1 hour', cash = 1000000, bank = 0 where id = $1`, [C]);
const cash0 = Number((await q(`select cash from players where id = $1`, [C])).rows[0].cash);
await as(C, `select get_men()`);
const cash1 = Number((await q(`select cash from players where id = $1`, [C])).rows[0].cash);
assert.equal(cash0 - cash1, 2 * Math.floor(5 * 700 / 7), 'iki günlük maaş');
await q(`update players set men_paid_at = now() - interval '3 days', cash = 0, bank = 0 where id = $1`, [C]);
await as(C, `select get_men()`);
const left = Number((await q(`select count(*) n from player_men where player_id = $1`, [C])).rows[0].n);
assert.equal(left, 2, 'üç gün maaşsız: her gün en az 1 adam gider');
assert.ok((await as(C, `select get_state()`)).events.some(e => /bırakıp gitti/.test(e.text)));
ok('maaş kesintisi ve maaşsız dağılma');

// ─── Koruma (C) ve gözcü (E)
const need = async () => (await q(`select required_bullets(t, s) n from players t, players s where t.id = $1 and s.id = $2`, [B, A])).rows[0].n;
const n0 = await need();
await hire(B, 'fedai', 5); await train(B);
const n1 = await need();
assert.ok(n1 > n0 * 1.25, `fedailer vurmayı zorlaştırır: ${n0} → ${n1}`);
const chance = async () => (await as(A, `select get_state()`)).crimes.find(c => c.id === 'cep').chance;
const c0 = await chance();
await hire(A, 'gozcu', 3); await train(A);
assert.ok(Math.abs((await chance()) - c0 - 0.03) < 0.002, 'üç gözcü +%3 şans');
ok('fedai koruması ve gözcü şansı');

// ─── Baskın (A): adamlar güç katar, kayıp verir; nöbet (B) savunur
await as(A, `select create_family('Aslanlar')`);
await as(B, `select create_family('Boğalar')`);
const spotId = async (name) => (await q(`select id from spots where name = $1`, [name])).rows[0].id;
const pera = await spotId('Pera Gazinosu'), galata = await spotId('Galata Meyhanesi');
await hire(A, 'zorba', 12); await train(A);   // 12 zorba = 36 saldırı = 720 kurşun değerinde
const before = Number((await q(`select count(*) n from player_men where player_id = $1`, [A])).rows[0].n);
r = await as(A, `select raid_spot($1, 0)`, [pera]);
assert.equal(r.success, true, 'sadece adamlarla yerel savunma (600) aşılır');
assert.ok(r.lost >= 1, 'kazanan da az kayıp verir');
const after = Number((await q(`select count(*) n from player_men where player_id = $1`, [A])).rows[0].n);
assert.equal(before - after, r.lost);

// B mekânına nöbet bırakır, A'nın baskını püskürtülür
await q(`update spots set owner_family = (select id from families where name = 'Boğalar'), protected_until = now(), defense = 0 where id = $1`, [galata]);
await hire(B, 'fedai', 15); await train(B);
assert.equal((await as(B, `select station_men($1, 'fedai', 20)`, [galata])).ok, true);
assert.equal((await as(A, `select station_men($1, 'zorba', 1)`, [galata])).ok, false, 'başka ailenin mekânına nöbet yok');
await q(`update families set raid_ready_at = now()`);
r = await as(A, `select raid_spot($1, 100)`, [galata]);
assert.equal(r.success, false, 'nöbetçi fedailer (60 savunma = 1200) baskını durdurur');
assert.ok(r.lost >= 1 && r.enemy_lost >= 1, 'iki taraf da kayıp verir');
m = await as(B, `select get_men()`);
assert.ok(m.posts[0].count < 20, 'nöbetçiler azaldı');
assert.equal((await as(B, `select recall_men($1)`, [galata])).ok, true);
assert.equal((await as(B, `select get_men()`)).posts.length, 0);
ok('baskında adam gücü, kayıplar, mekân nöbeti');

// ─── Ölünce adam kaybı, güç sıralaması, aile gücü, kovma
await q(`update players set hospital_until = now(), jail_until = now()`);
const lostOnDeath = await q(`select lose_men($1, 0.15) n`, [B]);
assert.ok(lostOnDeath.rows[0].n >= 1);
m = await as(A, `select get_men()`);
assert.ok(m.top.length >= 2 && m.top[0].power >= m.top[1].power);
assert.ok(m.family_power > 0);
const fams = await as(C, `select get_families()`);
assert.ok(fams.find(f => f.name === 'Aslanlar').power > 0);
const owned = m.owned;
assert.equal((await as(A, `select dismiss_man('gozcu')`)).ok, true);
assert.equal((await as(A, `select get_men()`)).owned, owned - 1);
ok('ölüm kaybı, sıralama, aile gücü, kovma');
done('men');
