// Faz 2A: kurşun, silah, dedektif, vurma, hastane, hapisten kurtarma, banka, transfer.
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player, set, get, ready } = await setup();
const RANK3 = 700, RANK5 = 3000;
const state = (uid) => as(uid, `select get_state()`);

// ─── Kurşun fabrikası
const A = await player('Ahmet', { xp: RANK3, cash: 100000 });
let s = await state(A);
assert.ok(s.factory.stock > 0 && s.factory.price >= 4);
const limit = s.player.bullets_left_hour;
assert.equal(limit, 200 + 50 * 3);
assert.equal((await as(A, `select buy_bullets($1)`, [limit + 1])).ok, false, 'saatlik limit');
assert.equal((await as(A, `select buy_bullets(300)`)).ok, true);
assert.equal((await as(A, `select buy_bullets(51)`)).ok, false, 'limit birikimli sayılmalı');
assert.equal((await get(A)).bullets, 300);
// bir saat sonra limit yenilenir
await db.query(`update players set bullets_hour_start = now() - interval '61 minutes' where id = $1`, [A]);
assert.equal((await state(A)).player.bullets_left_hour, limit);
// fabrika tembel dolum
await db.exec(`update city_bullets set stock = 0, restocked_at = now() - interval '11 minutes' where city_id = 'istanbul'`);
assert.equal((await state(A)).factory.stock, 600);
ok('kurşun: saatlik limit, stok dolumu');

// ─── Silah & koruma
assert.equal((await as(A, `select buy_weapon('thompson')`)).ok, false, 'rütbe yetmez');
assert.equal((await as(A, `select buy_weapon('tabanca')`)).ok, true);
assert.equal((await as(A, `select hire_bodyguard()`)).ok, true);
assert.equal((await get(A)).bodyguards, 1);
ok('silah + koruma');

// ─── Çaylak koruması
const Y = await player('Yeni');                 // rütbe 0
assert.equal((await as(A, `select hire_detectives('Yeni', 5)`)).ok, true, 'aramak serbest');
const C = await player('Cemil', { xp: 100 });
assert.equal((await as(C, `select hire_detectives('Ahmet', 5)`)).ok, false, 'çaylak kimseyi aratamaz');
ok('çaylak koruması');

// ─── Dedektif + vurma
const B = await player('Bora', { xp: RANK5, cash: 40000, bullets: 1000 });
assert.equal((await as(A, `select shoot('Bora', 100)`)).ok, false, 'dedektif olmadan vurulamaz');
// başarılı arama ayarla: süresi dolmuş, başarılı
await as(A, `select hire_detectives('Bora', 10)`);
await db.query(`update detective_searches set success = true, ready_at = now() where player_id = $1`, [A]);
s = await state(A);
const found = s.searches.find(x => x.target === 'Bora');
assert.equal(found.resolved, true);
assert.equal(found.city, 'istanbul');

// kurşun yetmezse yaralar
await set(A, { bullets: 5000 });
const r1 = await as(A, `select shoot('Bora', 100)`);
assert.equal(r1.ok, true); assert.equal(r1.killed, undefined);
let b = await get(B);
assert.ok(b.health < 100 && b.health > 0, `yaralı: ${b.health}`);
assert.equal((await as(A, `select shoot('Bora', 100)`)).ok, false, 'vurma bekleme süresi');
ok(`yaralama: Bora'nın canı ${b.health}`);

// yeterli kurşunla öldürür → para/kurşun kaybı, hastane
await ready(A);
const cashBefore = b.cash, bulletsBefore = b.bullets, killerCash = Number((await get(A)).cash);
const r2 = await as(A, `select shoot('Bora', 2000)`);
assert.equal(r2.killed, true, JSON.stringify(r2));
b = await get(B);
assert.equal(b.cash, cashBefore - Math.floor(cashBefore * 0.25));
assert.equal(Number((await get(A)).cash), killerCash + Math.floor(cashBefore * 0.10), 'öldüren cebin %10 kadarını alır');
assert.match(r2.msg, /Cebinden \$4000 aldın/);
assert.equal(b.bullets, bulletsBefore - Math.floor(bulletsBefore * 0.5));
assert.equal(b.deaths, 1);
assert.equal(b.health, 100);
assert.equal((await as(B, `select do_crime('cep')`)).ok, false, 'hastanedeyken aksiyon yok');
assert.equal((await get(A)).kills, 1);
// hastanedeki vurulamaz
await ready(A);
assert.equal((await as(A, `select shoot('Bora', 100)`)).success, false);
ok('öldürme: %25 para, %50 kurşun kaybı, hastane, hastanede dokunulmazlık');

// ─── Öldürme ödülü: aynı hedeften 24 saatte bir kez; üst sınır rütbe × 20.000
await db.exec(`update players set hospital_until = now() where nick = 'Bora'`);
await set(B, { cash: 40000 }); await set(A, { bullets: 10000 }); await ready(A);
await db.query(`update detective_searches set ready_at = now() where player_id = $1`, [A]);
const before2 = Number((await get(A)).cash);
const r4 = await as(A, `select shoot('Bora', 5000)`);
assert.equal(r4.killed, true, JSON.stringify(r4));
assert.equal(Number((await get(A)).cash), before2, '24 saat dolmadan aynı hedeften para alınmaz');
assert.equal((await get(B)).cash, 30000, 'hedef yine %25 kaybeder');
await db.exec(`update kill_loot set at = now() - interval '25 hours'`);
const cap = (await db.query(`select least(floor(1000000 * 0.10), rank_of(xp) * 20000)::bigint c from players where nick = 'Bora'`)).rows[0].c;
assert.equal(Number(cap), 5 * 20000, 'Külhanbeyi için üst sınır 100.000');
await db.exec(`update players set kills = 1 where nick = 'Ahmet'; update players set deaths = 1, hospital_until = now() where nick = 'Bora'`);
ok('öldürme ödülü: %10, rütbe × 20.000 sınırı, aynı hedeften 24 saatte bir');

// hedef şehir değiştirdiyse iz soğur, kurşun gitmez
await ready(A); await ready(B);
await set(B, { city_id: 'izmir' });
const bulletsA = (await get(A)).bullets;
const r3 = await as(A, `select shoot('Bora', 100)`);
assert.equal(r3.success, false);
assert.equal((await get(A)).bullets, bulletsA);
ok('hedef kaçtıysa kurşun harcanmaz');

// koruma ve silah gereken kurşunu değiştirir
const need = async (t, sh) => (await db.query(
  `select required_bullets((select p from players p where id=$1), (select p from players p where id=$2)) n`, [t, sh])).rows[0].n;
await set(B, { health: 100, bodyguards: 0 });
const n0 = await need(B, A);
await set(B, { bodyguards: 2 });
const n2 = await need(B, A);
assert.ok(n2 > n0, `korumalı daha zor: ${n0} → ${n2}`);
await set(A, { weapon_id: 'thompson' });
assert.ok((await need(B, A)) < n2, 'iyi silah daha az kurşun');
ok(`gereken kurşun: korumasız ${n0}, 2 korumalı ${n2}`);

// ─── Hastane iyileşme
await set(B, { health: 40, cash: 10000, hospital_until: new Date().toISOString() });
assert.equal((await as(B, `select heal()`)).ok, true);
b = await get(B);
assert.equal(b.health, 100); assert.equal(b.cash, 10000 - 60 * 40);
ok('iyileşme ücreti');

// ─── Hapishane: kurtarma & firar
const J = await player('Mahkum', { jail_until: new Date(Date.now() + 3600e3).toISOString() });
let jail = await as(A, `select get_jail()`);
assert.ok(jail.some(j => j.nick === 'Mahkum'));
let freed = false;
for (let i = 0; i < 60 && !freed; i++) {
  await ready(A);
  const r = await as(A, `select bust('Mahkum')`);
  freed = r.success;
}
assert.ok(freed, 'birkaç denemede kurtarılmalı');
assert.ok((await get(A)).busts >= 1);
await ready(A);
assert.equal((await as(A, `select bust('Mahkum')`)).ok, false, 'artık içeride değil');

await set(J, { jail_until: new Date(Date.now() + 3600e3).toISOString() });
let tries = 0, out = false;
while (!out) {
  const r = await as(J, `select self_bust()`);
  if (!r.ok) break;
  tries++; out = r.success;
}
assert.ok(tries <= 3, 'en fazla 3 firar denemesi');
ok(`kurtarma çalışıyor, firar ${tries} denemede ${out ? 'başardı' : 'hakkı bitti'}`);

// ─── 028: başarılı firar +5 itibar
let fr = null;
for (let i = 0; i < 300 && !fr?.success; i++) {
  await set(J, { jail_until: new Date(Date.now() + 3600e3).toISOString(), self_bust_left: 3, self_bust_for: null });
  fr = await as(J, `select self_bust()`);
}
const xpBefore = (await get(J)).xp;
assert.ok(fr.success && fr.xp === 5 && /\+5 itibar/.test(fr.msg), fr.msg);
ok(`başarılı firar itibar verir (+${fr.xp}, şu an ${xpBefore})`);

// ─── Banka & transfer
await ready(C);
await set(C, { cash: 1000, bank: 0 });
assert.equal((await as(C, `select bank_move(1000)`)).ok, true);
let c = await get(C);
assert.equal(c.cash, 0); assert.equal(c.bank, 950);
assert.equal((await as(C, `select bank_move(-951)`)).ok, false);
await as(C, `select bank_move(-950)`);
assert.equal((await get(C)).cash, 950);
assert.equal((await as(Y, `select send_money('Cemil', 10)`)).ok, false, 'çaylak para gönderemez');
assert.equal((await as(C, `select send_money('Ahmet', 100)`)).ok, true);
assert.equal((await get(C)).cash, 850);
ok('banka komisyonu + transfer');

// ─── Profil / liste
const pr = await as(C, `select get_profile('bora')`);
assert.equal(pr.nick, 'Bora'); assert.equal(pr.deaths, 1);
assert.equal(pr.city, undefined, 'profil şehri sızdırmamalı');
const pl = await as(C, `select get_players()`);
assert.ok(pl.top.length >= 5);
ok('profil şehir sızdırmıyor, sıralama çalışıyor');

// ─── Güvenlik: yeni fonksiyonlar istemciye açık, yardımcılar kapalı
await db.exec(`grant usage on schema public to authenticated; grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated; set role authenticated`);
await db.query(`select set_config('test.uid', $1, false)`, [C]);
await assert.rejects(db.query(`select restock_bullets('istanbul')`));
await assert.rejects(db.query(`select state_core()`));
await assert.rejects(db.query(`update players set bullets = 99999`));
assert.ok((await db.query(`select get_players() r`)).rows[0].r);
await db.exec(`reset role`);
ok('yetkiler');

done('combat');
