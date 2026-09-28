// Faz 2D: kumarhane geri dönüş oranları, ulaşım, hurdacı.
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player, set, get } = await setup();
const P = await player('Kumarbaz', { xp: 3000, cash: 1e9 });

async function rtp(game, choice, rounds = 3000, bet = 100) {
  let back = 0;
  for (let i = 0; i < rounds; i++) {
    await db.exec(`update players set casino_ready_at = now()`);
    const r = await as(P, `select play_casino($1, $2, $3)`, [game, bet, choice]);
    assert.equal(r.ok, true, r.msg);
    back += Number(r.win);
  }
  return back / (rounds * bet);
}

// ─── Kurallar
assert.equal((await as(P, `select play_casino('zar', 5, 'yuksek')`)).ok, false, 'min bahis');
assert.equal((await as(P, `select play_casino('zar', 999999999, 'yuksek')`)).ok, false, 'rütbe tavanı');
await as(P, `select play_casino('zar', 100, 'yuksek')`);
assert.equal((await as(P, `select play_casino('zar', 100, 'yuksek')`)).ok, false, 'hız sınırı');
await db.exec(`update players set casino_ready_at = now()`);
await assert.rejects(as(P, `select play_casino('rulet', 100, '37')`), 'geçersiz sayı');
ok('bahis kuralları');

// ─── Geri dönüş oranları: kasa kazanmalı ama soygun gibi olmamalı
const z = await rtp('zar', 'yuksek');
const r = await rtp('rulet', 'kirmizi');
const s = await rtp('slot', null, 6000);
for (const [name, v, lo, hi] of [['zar', z, 0.85, 1.05], ['rulet', r, 0.88, 1.06], ['slot', s, 0.75, 1.1]]) {
  assert.ok(v > lo && v < hi, `${name} RTP ${v.toFixed(3)}`);
}
ok(`geri dönüş: zar %${(z * 100).toFixed(1)}, rulet %${(r * 100).toFixed(1)}, slot %${(s * 100).toFixed(1)}`);

// ─── Ulaşım
const T = await player('Gezgin', { xp: 800, cash: 100000 });
assert.equal((await as(T, `select buy_transport('deniz_ucagi')`)).ok, false, 'rütbe');
assert.equal((await as(T, `select buy_transport('motorbot')`)).ok, true);
assert.equal((await as(T, `select buy_transport('vapur')`)).ok, false, 'geri düşülmez');
await as(T, `select travel('izmir')`);
const wait = (new Date((await get(T)).travel_ready_at) - Date.now()) / 1000;
assert.ok(wait > 590 && wait <= 600, `motorbot 10 dk: ${wait}`);
ok('ulaşım yükseltmesi yolculuk süresini kısaltır');

// ─── Hurdacı
await db.query(`insert into player_cars (player_id, car_id, city_id) values ($1, 'sedan', 'izmir'), ($1, 'taksi', 'istanbul')`, [T]);
const cars = (await as(T, `select get_state()`)).cars;
const sedan = cars.find(c => c.name === 'Lüks Sedan'), taksi = cars.find(c => c.name === 'Şehir Taksisi');
assert.equal((await as(T, `select crush_car($1)`, [taksi.id])).ok, false, 'başka şehirdeki araba');
assert.equal((await as(T, `select crush_car($1)`, [sedan.id])).ok, true);
assert.equal((await get(T)).bullets, 3200 / 20);
ok('hurdacı: araba → kurşun');

done('casino');
