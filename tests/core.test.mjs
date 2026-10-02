// Supabase olmadan, gerçek Postgres (PGlite) üzerinde oyun kurallarını test eder.
// Çalıştır: npm test
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, ready } = await setup();

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
await db.exec(`insert into auth.users values ('${A}'), ('${B}')`);

// --- oyuncu oluşturma
assert.equal((await as(A, `select get_state()`)).player, null);
assert.equal((await as(A, `select create_player('ab')`)).ok, false);
assert.equal((await as(A, `select create_player('KabadayiAli')`)).ok, true);
assert.equal((await as(B, `select create_player('kabadayiali')`)).ok, false, 'büyük/küçük harf farkı aynı isim sayılmalı');
assert.equal((await as(B, `select create_player('Şükrü')`)).ok, true);
let s = await as(A, `select get_state()`);
assert.equal(s.player.cash, 500);
assert.equal(s.player.rank, 0);
assert.equal(s.market.length, 9);
ok('oyuncu oluşturma + başlangıç durumu');

// --- suç: bekleme süresi ve rütbe kontrolü
const r1 = await as(A, `select do_crime('cep')`);
assert.equal(r1.ok, true);
const r2 = await as(A, `select do_crime('cep')`);
assert.equal(r2.ok, false, 'bekleme süresi dolmadan ikinci suç olmamalı');
await ready(A);
assert.equal((await as(A, `select do_crime('banka')`)).ok, false, 'Çaylak banka soyamaz');
ok('suç bekleme süresi + rütbe kilidi');

// --- çok sayıda suç: para asla negatif olmaz, xp artar
let successes = 0, jails = 0;
for (let i = 0; i < 300; i++) {
  await ready(A);
  const r = await as(A, `select do_crime('cep')`);
  if (r.success) successes++;
  if (r.jailed) jails++;
}
s = await as(A, `select get_state()`);
assert.ok(successes > 150 && successes < 285, `başarı oranı beklenen aralıkta (${successes}/300)`);
assert.ok(jails > 10, 'bazen hapse girilmeli');
assert.ok(s.player.rank >= 1, 'terfi etmeli');
ok(`300 suç: ${successes} başarı, ${jails} hapis, rütbe ${s.player.rank}`);

// --- hapisteyken hiçbir şey yapılamaz
await db.exec(`update players set jail_until = now() + interval '1 hour', crime_ready_at = now() where id = '${A}'`);
assert.equal((await as(A, `select do_crime('cep')`)).ok, false);
assert.equal((await as(A, `select steal_car()`)).ok, false);
assert.equal((await as(A, `select trade('kahve', 1)`)).ok, false);
ok('hapiste aksiyon engeli');

// --- araba çal / sat
let cars = 0;
for (let i = 0; i < 40; i++) { await ready(A); if ((await as(A, `select steal_car()`)).success) cars++; }
s = await as(A, `select get_state()`);
assert.equal(s.cars.length, cars);
const cashBefore = s.player.cash;
const { id: carId, value: carValue } = s.cars[0];
assert.equal((await as(B, `select sell_car($1)`, [carId])).ok, false, 'başkasının arabasını satamaz');
assert.equal((await as(A, `select sell_car($1)`, [carId])).ok, true);
s = await as(A, `select get_state()`);
assert.equal(s.player.cash, cashBefore + carValue);
assert.equal(s.cars.length, cars - 1);
ok(`araba: ${cars}/40 çalındı, satış çalışıyor`);

// --- ticaret: kapasite ve para
await ready(A);
await db.exec(`update players set cash = 1000000 where id = '${A}'`);
s = await as(A, `select get_state()`);
const cap = s.ranks[s.player.rank].carry;
assert.equal((await as(A, `select trade('kahve', $1)`, [cap + 1])).ok, false, 'kapasite aşılmamalı');
assert.equal((await as(A, `select trade('kahve', $1)`, [cap])).ok, true);
assert.equal((await as(A, `select trade('kahve', $1)`, [-(cap + 1)])).ok, false, 'elindekinden fazla satılamaz');
const price = s.market.find(g => g.id === 'kahve').sell;   // satış alışın %15 altı (020)
const before = (await as(A, `select get_state()`)).player.cash;
assert.equal((await as(A, `select trade('kahve', -2)`)).ok, true);
assert.equal((await as(A, `select get_state()`)).player.cash, before + 2 * price);
ok(`ticaret: kapasite ${cap}, alış/satış tutarlı`);

// --- fiyatlar: şehre göre farklı, makul aralıkta
const prices = await db.query(`select c.id, price_of(c.id, 'raki') p from cities c`);
const ps = prices.rows.map(r => r.p);
assert.ok(new Set(ps).size > 1, 'şehirler arası fiyat farkı olmalı');
assert.ok(ps.every(p => p >= 140 * 0.55 - 1 && p <= 140 * 1.45 + 1));
ok(`rakı fiyatları: ${ps.join(', ')}`);

// --- yolculuk
await ready(A);
assert.equal((await as(A, `select travel('istanbul')`)).ok, false, 'aynı şehre gidilemez');
assert.equal((await as(A, `select travel('izmir')`)).ok, true);
assert.equal((await as(A, `select get_state()`)).player.city, 'izmir');
assert.equal((await as(A, `select travel('beyrut')`)).ok, false, 'vapur bekleme süresi');
ok('yolculuk + bekleme süresi');

// --- güvenlik: istemci tablolara doğrudan yazamaz, iç fonksiyonları çağıramaz
await db.exec(`grant usage on schema public to authenticated; grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated;`);
await db.exec(`set role authenticated`);
await db.query(`select set_config('test.uid', $1, false)`, [B]);
await assert.rejects(db.query(`update players set cash = 999999999`), 'tabloya doğrudan yazılamamalı');
await assert.rejects(db.query(`select log_event('${B}', 'hile')`), 'iç fonksiyon çağrılamamalı');
const viaRpc = await db.query(`select get_state() s`);
assert.equal(viaRpc.rows[0].s.player.nick, 'Şükrü');
await db.exec(`reset role`);
ok('RLS: doğrudan yazma ve iç fonksiyon engelli, RPC çalışıyor');

done('core');
