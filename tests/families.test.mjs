// Faz 2B: aileler, fabrika sahipliği, kelle listesi.
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player, set, get, ready } = await setup();
const RANK3 = 700, RANK5 = 3000;

// ─── Kurma
const D = await player('DonVito', { xp: RANK5, cash: 1000000 });
const L = await player('Lale', { xp: RANK3, cash: 1000 });
assert.equal((await as(L, `select create_family('Lale Ailesi')`)).ok, false, 'rütbe yetmez');
assert.equal((await as(D, `select create_family('X')`)).ok, false, 'isim kısa');
assert.equal((await as(D, `select create_family('Corleone')`)).ok, true);
assert.equal((await get(D)).family_role, 'don');
const D2 = await player('Rakip', { xp: RANK5, cash: 1000000 });
assert.equal((await as(D2, `select create_family('corleone')`)).ok, false, 'aynı isim');
assert.equal((await as(D2, `select create_family('Tattaglia')`)).ok, true);
ok('aile kurma: rütbe, ücret, benzersiz isim');

// ─── Başvuru & kabul
assert.equal((await as(L, `select apply_family('Corleone')`)).ok, true);
let fam = await as(L, `select get_family()`);
assert.equal(fam.family, null); assert.equal(fam.application.family, 'Corleone');
assert.equal((await as(D2, `select answer_application('Lale', true)`)).ok, false, 'başka ailenin donu kabul edemez');
assert.equal((await as(D, `select answer_application('Lale', true)`)).ok, true);
let l = await get(L);
assert.equal(l.family_role, 'asker');
assert.equal((await as(L, `select answer_application('Lale', true)`)).ok, false, 'asker yönetici değil');
fam = await as(D, `select get_family()`);
assert.equal(fam.members.length, 2);
assert.equal(fam.members[0].role, 'don');
assert.ok(fam.messages.some(m => m.text.includes('katıldı')));
ok('başvuru, kabul, üye listesi, sistem mesajı');

// ─── Roller
assert.equal((await as(L, `select set_role('Lale', 'don')`)).ok, false);
assert.equal((await as(D, `select set_role('Lale', 'sottocapo')`)).ok, true);
const M = await player('Mario', { xp: RANK3 });
await as(M, `select apply_family('Corleone')`);
await as(L, `select answer_application('Mario', true)`);
assert.equal((await as(D, `select set_role('Mario', 'sottocapo')`)).ok, false, 'tek sottocapo');
assert.equal((await as(L, `select kick_member('DonVito')`)).ok, false, 'don atılamaz');
assert.equal((await as(L, `select kick_member('Mario')`)).ok, true);
assert.equal((await get(M)).family_id, null);
ok('roller: tek sottocapo, atma yetkileri');

// ─── Kasa
assert.equal((await as(L, `select family_deposit(500)`)).ok, true);
assert.equal((await get(L)).cash, 500);
await as(D, `select family_deposit(600000)`);
assert.equal((await as(L, `select family_pay('Lale', 100)`)).ok, true, 'sottocapo kasayı kullanır');
assert.equal((await get(L)).cash, 600);
ok('aile kasası');

// ─── Sohbet
assert.equal((await as(L, `select post_family_message('Selam aile')`)).ok, true);
assert.equal((await as(M, `select post_family_message('sızma')`)).ok, false, 'aile dışı yazamaz');
assert.equal((await as(L, `select post_family_message($1)`, ['x'.repeat(301)])).ok, false);
await as(L, `select post_family_message('2')`); await as(L, `select post_family_message('3')`);
assert.equal((await as(L, `select post_family_message('4')`)).ok, false, 'sel koruması');
fam = await as(L, `select get_family()`);
assert.ok(fam.messages.some(m => m.nick === 'Lale' && m.text === 'Selam aile'));
ok('aile sohbeti + sel koruması');

// ─── Fabrika
assert.equal((await as(L, `select buy_factory()`)).ok, true);
assert.equal((await as(D2, `select buy_factory()`)).ok, false, 'sahipli fabrika alınamaz');
assert.equal((await as(D, `select set_factory_price(9)`)).ok, true);
const bankBefore = (await db.query(`select bank from families where name = 'Corleone'`)).rows[0].bank;
const buyer = await player('Musteri', { xp: RANK3, cash: 100000 });
assert.equal((await as(buyer, `select buy_bullets(100)`)).ok, true);
assert.equal((await get(buyer)).cash, 100000 - 900);
const bankAfter = (await db.query(`select bank from families where name = 'Corleone'`)).rows[0].bank;
assert.equal(Number(bankAfter) - Number(bankBefore), 900);
// dolumda sahipli fiyat değişmez
await db.exec(`update city_bullets set restocked_at = now() - interval '30 minutes' where city_id = 'istanbul'`);
assert.equal((await as(buyer, `select get_state()`)).factory.price, 9);
ok('fabrika: satın alma, fiyat belirleme, gelir aile kasasına');

// ─── Aile içi ateş yasağı & kelle ödülü
await set(D, { weapon_id: 'tabanca', bullets: 10000 });
await db.query(`insert into detective_searches (player_id, target_id, success, city_found, ready_at, resolved)
  values ($1, $2, true, 'istanbul', now(), true)`, [D, L]);
assert.equal((await as(D, `select shoot('Lale', 100)`)).msg, 'Aileden birine silah çekilmez.');

const K = await player('Katil', { xp: RANK5, cash: 0, weapon_id: 'thompson', bullets: 10000 });
assert.equal((await as(D2, `select place_bounty('Lale', 1000)`)).ok, false, 'minimum ödül');
assert.equal((await as(D2, `select place_bounty('Lale', 20000)`)).ok, true);
assert.equal((await get(D2)).cash, 1000000 - 50000 - 250000 * 0 - 22000);
const hl = await as(K, `select get_hitlist()`);
assert.equal(hl[0].nick, 'Lale'); assert.equal(Number(hl[0].amount), 20000);
await db.query(`insert into detective_searches (player_id, target_id, success, city_found, ready_at, resolved)
  values ($1, $2, true, 'istanbul', now(), true)`, [K, L]);
const laleCash = Number((await get(L)).cash);
const r = await as(K, `select shoot('Lale', 5000)`);
assert.equal(r.killed, true, JSON.stringify(r));
assert.ok(r.msg.includes('Kelle ödülü'));
assert.equal(Number((await get(K)).cash), 20000 + Math.floor(laleCash * 0.10), 'kelle ödülü + cebinden %10 pay');
assert.equal((await as(K, `select get_hitlist()`)).length, 0);
ok('aile içi ateş yasak, kelle ödülü öldürene gider');

// ─── Kelle ödülü 7 günde dolar: koyanın bankasına döner, artık alınamaz
const d2Bank = Number((await get(D2)).bank);
assert.equal((await as(D2, `select place_bounty('Katil', 10000)`)).ok, true);
assert.ok((await as(K, `select get_hitlist()`))[0].expires_at);
await db.query(`update bounties set created_at = now() - interval '8 days' where claimed_by is null`);
assert.equal((await as(K, `select get_hitlist()`)).length, 0, 'süresi dolan listeden düşer');
assert.equal(Number((await get(D2)).bank), d2Bank + 10000, 'ödül bankaya iade (aracı payı hariç)');
assert.equal((await as(D2, `select get_profile('Katil')`)).bounty, 0);
assert.equal((await db.query(`select count(*)::int n from bounties where refunded_at is not null and claimed_by is null`)).rows[0].n, 1);
ok('kelle ödülünün süresi dolunca iade');

// ─── Aile arması: sadece Don seçer; listede ve aile ekranında görünür
assert.equal((await as(D, `select get_family()`)).family.crest, 0);
assert.equal((await as(D, `select set_family_crest(5)`)).ok, true);
assert.equal((await as(D, `select get_family()`)).family.crest, 5);
assert.equal((await as(D, `select get_families()`)).find(f => f.name === 'Corleone').crest, 5);
assert.match((await as(D, `select set_family_crest(9)`)).msg, /mağazada/, '025: özel arma satın alınmadan seçilemez');
await assert.rejects(as(D, `select set_family_crest(17)`), /BAD_CREST/);
assert.equal((await as(L, `select set_family_crest(2)`)).ok, false, 'Don olmayan seçemez');
ok('aile arması');

// ─── Profil aile + ayrılma/dağılma
const pr = await as(K, `select get_profile('lale')`);
assert.equal(pr.family, 'Corleone'); assert.equal(pr.family_role, 'sottocapo');
assert.equal((await as(D, `select leave_family()`)).ok, false, 'don üyeler varken ayrılamaz');
assert.equal((await as(D, `select set_role('Lale', 'don')`)).ok, true);
assert.equal((await get(L)).family_role, 'don');
assert.equal((await get(D)).family_role, 'sottocapo');
assert.equal((await as(D, `select leave_family()`)).ok, true);
assert.equal((await as(L, `select leave_family()`)).ok, true);
assert.equal((await db.query(`select count(*)::int n from families where name = 'Corleone'`)).rows[0].n, 0, 'son üye çıkınca aile dağılır');
assert.equal((await db.query(`select owner_family from city_bullets where city_id = 'istanbul'`)).rows[0].owner_family, null);
const list = await as(K, `select get_families()`);
assert.deepEqual(list.map(f => f.name), ['Tattaglia']);
ok('donluk devri, ayrılma, dağılınca fabrika sahipsiz kalır');

done('families');
