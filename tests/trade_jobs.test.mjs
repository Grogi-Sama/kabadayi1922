// 020: işe özel bekleme, tecrübeyle artan şans, alış/satış farkı, pahalı mallar, gümrükte yarı el koyma, gelen kutusu portresi
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player, set, ready, befriend } = await setup();
const A = await player('Ayla');
const B = await player('Burak');

// ─── İşlerin bekleme süresi ayrı: biri beklerken diğeri yapılabilir
await set(A, { xp: 150 });   // Ayak İşçisi: cep + dükkan açık
assert.equal((await as(A, `select do_crime('cep')`)).ok, true);
await db.query(`update players set jail_until = now() where id = $1`, [A]);   // hapis şansı testi bozmasın
assert.match((await as(A, `select do_crime('cep')`)).msg, /bekle/, 'aynı iş beklemede');
await db.query(`update players set jail_until = now() where id = $1`, [A]);
assert.equal((await as(A, `select do_crime('dukkan')`)).ok, true, 'başka iş beklemeden yapılabilir');
let s = await as(A, `select get_state()`);
const cep = s.crimes.find(c => c.id === 'cep'), banka = s.crimes.find(c => c.id === 'banka');
assert.ok(new Date(cep.ready_at) > new Date(s.now), 'iş kendi hazır olma zamanını taşır');
assert.ok(cep.cooldown_s < banka.cooldown_s, 'büyük işin beklemesi uzun');
assert.equal(cep.xp, 5);
ok('işe özel bekleme süresi');

// ─── Başarı şansı tecrübeyle sürekli artar (rütbe içinde bile)
const ch = async (xp) => { await set(A, { xp }); return (await as(A, `select get_state()`)).crimes.find(c => c.id === 'cep').chance; };
const c0 = await ch(0), c50 = await ch(50), c100 = await ch(100), cTop = await ch(60000);
assert.ok(c0 < c50 && c50 < c100, `şans artmalı: ${c0} < ${c50} < ${c100}`);
assert.ok(cTop <= 0.95);
ok(`tecrübeyle şans: ${c0} → ${c50} → ${c100} (tavan ${cTop})`);

// ─── Başarılı işte para ve itibar birlikte yazar
await set(A, { xp: 60000 });
let r;
for (let i = 0; i < 20 && !r?.success; i++) { await ready(A); r = await as(A, `select do_crime('cep')`); }
assert.ok(r.success && r.xp > 0 && r.reward > 0);
assert.match(r.msg, /itibar/);
ok('iş sonucu para + itibar');

// ─── Liman: satış alışın %15 altı; alış fiyatı ve şehri tutulur; ortalama maliyet
await ready(A); await set(A, { cash: 5000000, xp: 0 });
s = await as(A, `select get_state()`);
const k = s.market.find(g => g.id === 'kahve');
assert.equal(k.sell, Math.floor(k.price * 0.85));
await as(A, `select trade('kahve', 2)`);
s = await as(A, `select get_state()`);
assert.equal(s.market.find(g => g.id === 'kahve').avg_cost, k.price);
assert.equal(s.market.find(g => g.id === 'kahve').bought_city, 'istanbul');
const cash0 = s.player.cash;
await as(A, `select trade('kahve', -1)`);
assert.equal((await as(A, `select get_state()`)).player.cash, cash0 + k.sell);
ok('alış/satış farkı + alış kaydı');

// ─── 027: pahalı mallar ticaret puanıyla açılır; puan başka şehirde satınca gelir
assert.equal(s.market.length, 9);
assert.match((await as(A, `select trade('mucevher', 1)`)).msg, /ticaret puanı gerekir/);
assert.match((await as(A, `select trade('konyak', 1)`)).msg, /50 ticaret puanı/);
// aynı şehirde al-sat puan vermez
await db.query(`delete from player_goods where player_id = $1`, [A]);
await as(A, `select trade('raki', 10)`);
await as(A, `select trade('raki', -5)`);
assert.equal((await as(A, `select get_state()`)).player.trade_xp, 0, 'aynı limanda puan yok');
// başka şehirde satış: rakı kasa başı 1 puan
await db.exec(`update game_settings set value = 0 where key = 'customs_chance'`);   // gümrük testi bozmasın
await ready(A); await as(A, `select travel('izmir')`);
let sold = await as(A, `select trade('raki', -5)`);
s = await as(A, `select get_state()`);
assert.equal(s.player.trade_xp, 5); assert.match(sold.msg, /\+5 ticaret puanı/);
assert.equal(s.market.find(g => g.id === 'konyak').min_trade, 50);
// kilit açılınca haber
await set(A, { trade_xp: 49 });
await as(A, `select trade('raki', 1)`); await ready(A); await as(A, `select travel('istanbul')`);
sold = await as(A, `select trade('raki', -1)`);
assert.match(sold.msg, /Yeni mal açıldı: Konyak/);
await set(A, { trade_xp: 1000 });
assert.equal((await as(A, `select trade('mucevher', 1)`)).ok, true);
await db.exec(`update game_settings set value = 0.08 where key = 'customs_chance'`);
const top = await db.query(`select max(price_of(c.id, 'silah_parca')) m from cities c`);
assert.ok(top.rows[0].m > 5000, 'en pahalı mal 10 bine yaklaşır');
ok('ticaret puanı: kilit, başka şehirde satışta puan, açılış haberi');

// ─── Gümrük: yarısına el koyar, liste döner
await db.exec(`update game_settings set value = 1 where key = 'customs_chance'`);
await db.query(`update player_goods set qty = 0 where player_id = $1`, [A]);
await as(A, `select trade('kahve', 5)`);
await as(A, `select trade('tutun', 4)`);
await ready(A);
r = await as(A, `select travel('izmir')`);
assert.equal(r.ok, true);
assert.deepEqual(r.seized.map(x => [x.good, x.qty]), [['kahve', 3], ['tutun', 2]]);
s = await as(A, `select get_state()`);
assert.equal(s.market.find(g => g.id === 'kahve').qty, 2);
assert.equal(s.market.find(g => g.id === 'tutun').qty, 2);
await db.exec(`update game_settings set value = 0.08 where key = 'customs_chance'`);
ok('gümrük yarısına el koyar');

// ─── Araba şansı ekranda, gelen kutusunda portre
assert.ok(s.car_chance >= 0.5 && s.car_chance <= 0.85);
await befriend(A, B);
await as(A, `select send_message('Burak', 'selam')`);
const inbox = await as(B, `select get_inbox()`);
assert.ok(inbox[0].avatar >= 1);
ok('araba şansı + gelen kutusu portresi');
done('trade_jobs');
