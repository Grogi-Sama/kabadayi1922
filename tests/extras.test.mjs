// Faz 3D: piyango, kazı kazan, blackjack, pazar, evlilik, sığınak.
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player, set, get } = await setup();
const A = await player('Alev', { xp: 3000, cash: 1e7, bullets: 5000 });
const B = await player('Baran', { xp: 3000, cash: 1e6 });
const C = await player('Canan', { xp: 3000, cash: 1e6 });

// ─── Piyango
let L = await as(A, `select get_lottery()`);
const drawAt = new Date(L.draw_at);
assert.ok(drawAt > new Date() && drawAt - new Date() <= 86400e3, 'sıradaki çekiliş 24 saat içinde');
assert.equal(drawAt.getUTCHours(), 18);
assert.equal((await as(A, `select buy_lottery(51)`)).ok, false, 'bilet sınırı');
await as(A, `select buy_lottery(30)`); await as(B, `select buy_lottery(10)`);
assert.equal((await as(A, `select buy_lottery(21)`)).ok, false, 'birikimli sınır');
L = await as(A, `select get_lottery()`);
assert.equal(L.mine, 30); assert.equal(L.tickets, 40); assert.equal(Number(L.pot), 36000);
const before = (await get(A)).cash + (await get(B)).cash;
await db.exec(`update lottery_rounds set draw_at = now() - interval '1 second' where not drawn`);
L = await as(C, `select get_lottery()`);
assert.ok(['Alev', 'Baran'].includes(L.last_winner)); assert.equal(Number(L.last_prize), 36000);
assert.equal((await get(A)).cash + (await get(B)).cash, before + 36000);
assert.equal(L.tickets, 0, 'yeni tur açıldı');
ok(`piyango: kazanan ${L.last_winner}, yeni tur ${new Date(L.draw_at).toISOString()}`);

// ─── Kazı kazan: geri dönüş ~%87
let spent = 0, back = 0;
for (let i = 0; i < 2000; i++) {
  await db.exec(`update players set casino_ready_at = now()`);
  const r = await as(C, `select scratch_card()`);
  spent += 500; back += Number(r.win);
}
assert.ok(back / spent > 0.6 && back / spent < 1.1, `kazı kazan RTP ${(back / spent).toFixed(3)}`);
ok(`kazı kazan geri dönüş %${(100 * back / spent).toFixed(1)}`);

// ─── Blackjack
const val = await db.query(`select bj_value(array[0, 12]) bj, bj_value(array[0, 0, 9]) soft, bj_value(array[9, 10, 11]) bust`);
assert.deepEqual(val.rows[0], { bj: 21, soft: 12, bust: 30 });
let net = 0, hands = 0;
for (let i = 0; i < 300; i++) {
  let r = await as(B, `select bj_start(100)`);
  assert.equal(r.ok, true, r.msg);
  if (!r.done) assert.equal((await as(B, `select bj_start(100)`)).ok, false, 'tek masa');
  while (!r.done) r = await as(B, r.hand_value < 17 ? `select bj_hit()` : `select bj_stand()`);
  net += Number(r.win) - 100; hands++;
}
assert.equal(await as(B, `select bj_current()`), null, 'masa temizlendi');
const rtp = 1 + net / (hands * 100);
assert.ok(rtp > 0.8 && rtp < 1.15, `blackjack RTP ${rtp.toFixed(3)}`);
ok(`blackjack: ${hands} el, geri dönüş %${(rtp * 100).toFixed(1)}`);

// ─── Pazar
assert.equal((await as(A, `select list_item('bullets', 99999, null, 1000)`)).ok, false);
assert.equal((await as(A, `select list_item('bullets', 1000, null, 8000)`)).ok, true);
assert.equal((await get(A)).bullets, 4000, 'kurşun emanete alındı');
const carId = (await db.query(`insert into player_cars (player_id, car_id, city_id) values ($1, 'limuzin', 'izmir') returning id`, [A])).rows[0].id;
assert.equal((await as(A, `select list_item('car', null, $1, 12000)`, [carId])).ok, true);
assert.equal((await as(A, `select get_state()`)).cars.length, 0, 'ilandaki araba garajda görünmez');
let m = await as(C, `select get_market()`);
assert.equal(m.length, 2);
const bl = m.find(x => x.kind === 'bullets'), cl = m.find(x => x.kind === 'car');
assert.equal(Number(bl.unit), 8);
assert.equal((await as(A, `select buy_listing($1)`, [bl.id])).ok, false, 'kendi ilanı');
const aCash = (await get(A)).cash;
assert.equal((await as(C, `select buy_listing($1)`, [bl.id])).ok, true);
assert.equal((await get(A)).cash, aCash + 8000 - 400, '%5 komisyon');
assert.equal((await get(C)).bullets, 1000);
assert.equal((await as(C, `select buy_listing($1)`, [bl.id])).ok, false, 'ikinci kez alınamaz');
assert.match((await as(C, `select buy_listing($1)`, [cl.id])).msg, /İzmir garajında/);
// iptal: mal geri gelir
await as(A, `select list_item('bullets', 500, null, 100)`);
const id3 = (await as(A, `select get_market()`))[0].id;
await as(A, `select cancel_listing($1)`, [id3]);
assert.equal((await get(A)).bullets, 4000);
ok('pazar: emanet, komisyon, araba devri, iptal');

// ─── Evlilik
assert.equal((await as(A, `select accept_proposal('Baran')`)).ok, false, 'teklif yok');
await as(B, `select propose('Alev')`);
assert.deepEqual((await as(A, `select get_state()`)).player.proposals, ['Baran']);
const bCash = (await get(B)).cash;
assert.equal((await as(A, `select accept_proposal('Baran')`)).ok, true);
assert.equal((await get(B)).cash, bCash - 25000, 'düğün masrafı teklif edenden');
assert.equal((await as(C, `select get_profile('Alev')`)).spouse, 'Baran');
assert.equal((await as(C, `select propose('Alev')`)).ok, false, 'evliye teklif olmaz');
await as(A, `select divorce()`);
assert.equal((await get(B)).spouse_id, null);
ok('evlilik: teklif, kabul, masraf, boşanma');

// ─── Sığınak
await set(A, { cash: 1e6 });
assert.equal((await as(A, `select enter_hideout(13)`)).ok, false);
assert.equal((await as(A, `select enter_hideout(2)`)).ok, true);
assert.equal((await get(A)).cash, 1e6 - 2 * 1000 * 6);
assert.match((await as(A, `select do_crime('cep')`)).msg, /Sığınak/);
assert.equal((await as(C, `select get_profile('Alev')`)).status, 'kayıp');
// dedektif bulamaz, vurulamaz
await set(C, { weapon_id: 'thompson', bullets: 5000 });
await as(C, `select hire_detectives('Alev', 10)`);
await db.exec(`update detective_searches set success = true, ready_at = now()`);
const s = (await as(C, `select get_state()`)).searches[0];
assert.equal(s.success, false, 'sığınaktaki bulunamaz');
await db.query(`insert into detective_searches (player_id, target_id, success, city_found, ready_at, resolved)
  values ($1, $2, true, 'istanbul', now(), true)`, [C, A]);
assert.match((await as(C, `select shoot('Alev', 3000)`)).msg, /yer altına/);
assert.equal((await get(C)).bullets, 5000, 'kurşun harcanmaz');
assert.equal((await as(A, `select leave_hideout()`)).ok, true);
assert.equal((await as(A, `select do_crime('cep')`)).ok, true);
ok('sığınak: aksiyon yok, bulunamaz, vurulamaz, erken çıkış');

done('extras');
