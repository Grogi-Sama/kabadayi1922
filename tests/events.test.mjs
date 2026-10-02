// Etkinlikler: planlı takvim (Türkiye saati) + sürprizler + oyuna etkileri.
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player, set, get } = await setup();
const kinds = async (isoTr) => {   // Türkiye saatiyle verilen anda süren etkinlikler
  const at = new Date(isoTr + '+03:00').toISOString();
  return (await db.query(`select kind, good_id from events_between($1::timestamptz, $1::timestamptz + interval '1 second')
                           where starts <= $1::timestamptz`, [at])).rows;
};
await db.exec(`update game_settings set value = 1 where key = 'ev_planned'`);

// ─── Planlı takvim: 2026-10-02 Cuma, 2026-10-03 Cumartesi
assert.deepEqual((await kinds('2026-10-02T17:30:00')).map(k => k.kind), ['kitlik']);
assert.ok(['kahve', 'tutun'].includes((await kinds('2026-10-02T17:30:00'))[0].good_id));
assert.notEqual((await kinds('2026-10-02T17:30:00'))[0].good_id, (await kinds('2026-10-01T17:30:00'))[0].good_id, 'kıtlık malı gün gün değişir');
assert.deepEqual((await kinds('2026-10-02T21:30:00')).map(k => k.kind).sort(), ['altin_saat', 'baskin_gecesi']);
assert.deepEqual((await kinds('2026-10-02T22:30:00')).map(k => k.kind), ['baskin_gecesi']);
assert.deepEqual((await kinds('2026-10-01T21:30:00')).map(k => k.kind), ['altin_saat'], 'baskın gecesi sadece Cuma');
assert.deepEqual((await kinds('2026-10-03T10:00:00')).map(k => k.kind), ['kelle_haftasi']);
assert.deepEqual((await kinds('2026-10-05T10:00:00')).map(k => k.kind), [], 'Pazartesi sabah boş');
ok('planlı takvim (Türkiye saati)');
await db.exec(`update game_settings set value = 0 where key = 'ev_planned'`);
const now = (city, kind, extra = '') => db.exec(`insert into world_events (kind, city_id, good_id, starts, ends)
  values ('${kind}', ${city ? `'${city}'` : 'null'}, ${extra ? `'${extra}'` : 'null'}, now() - interval '1 minute', now() + interval '1 hour')`);
const clear = () => db.exec(`delete from world_events`);

// ─── Kıtlık: alış yok, satışta +%8 (kişi başı 20 kasa)
const A = await player('Tuccar', { xp: 3000, cash: 100000 });
assert.equal((await as(A, `select trade('kahve', 30)`)).ok, true);
await now(null, 'kitlik', 'kahve');
assert.equal((await as(A, `select trade('kahve', 1)`)).ok, false, 'kıtlıkta alış yok');
const price = (await db.query(`select price_of('istanbul', 'kahve') p`)).rows[0].p;
let c0 = Number((await get(A)).cash);
const s1 = await as(A, `select trade('kahve', -25)`);
assert.match(s1.msg, /Kıtlık primi/);
assert.equal(Number((await get(A)).cash) - c0, price * 25 + Math.floor(price * 20 * 0.08), 'prim sadece 20 kasaya');
c0 = Number((await get(A)).cash);
await as(A, `select trade('kahve', -5)`);
assert.equal(Number((await get(A)).cash) - c0, price * 5, 'sınır dolunca prim yok');
assert.equal((await as(A, `select trade('tutun', 1)`)).ok, true, 'başka mal etkilenmez');
await clear();
ok('kıtlık: alış yok, sınırlı satış primi');

// ─── Fabrika kazası ve liman fırtınası (şehre özel)
await now('istanbul', 'fabrika_kazasi');
assert.match((await as(A, `select buy_bullets(10)`)).msg, /kaza/);
await now('izmir', 'liman_firtinasi');
await db.exec(`update players set travel_ready_at = now()`);
assert.match((await as(A, `select travel('izmir')`)).msg, /fırtına/);
assert.equal((await as(A, `select travel('selanik')`)).ok, true, 'başka limana sefer var');
await clear();
assert.notEqual((await as(A, `select buy_bullets(10)`)).msg?.includes('kaza'), true, 'kaza bitince fabrika açık');
ok('fabrika kazası ve liman fırtınası');

// ─── Altın saat: +%25 itibar
const B = await player('Cebci');
await now(null, 'altin_saat');
let gained = null;
for (let i = 0; i < 40 && gained === null; i++) {
  await db.exec(`update players set crime_ready_at = now(), jail_until = now(); delete from player_cooldowns where kind like 'crime:%'`);
  const xp0 = (await get(B)).xp;
  const r = await as(B, `select do_crime('cep')`);
  if (r.success) gained = (await get(B)).xp - xp0;
}
const base = (await db.query(`select xp from crimes where id = 'cep'`)).rows[0].xp;
assert.equal(gained, Math.round(base * 1.25));
await clear();
ok('altın saat: +%25 itibar');

// ─── Kelle haftası: aracı payı yarıya
const D = await player('Odulcu', { xp: 3000, cash: 1000000 });
await player('Hedef', { xp: 3000 });
await now(null, 'kelle_haftasi');
c0 = Number((await get(D)).cash);
assert.equal((await as(D, `select place_bounty('Hedef', 10000)`)).ok, true);
assert.equal(c0 - Number((await get(D)).cash), 10000 + 500, 'aracı payı %10 yerine %5');
await clear();
ok('kelle haftası: aracı payı yarı');

// ─── Sürpriz zar: 15 dk önce duyurulur, 30 dakikada en fazla bir zar
await db.exec(`update game_settings set value = 1 where key = 'ev_roll_chance'`);
let ev = await as(A, `select get_events()`);
assert.equal(ev.length, 1);
assert.ok(['fabrika_kazasi', 'polis_baskini', 'liman_firtinasi'].includes(ev[0].kind));
assert.ok(new Date(ev[0].starts) > Date.now() + 14 * 60e3, 'önceden duyurulur');
assert.ok(ev[0].city);
assert.equal((await as(A, `select get_events()`)).length, 1, 'yarım saat dolmadan yeni zar yok');
ok('sürpriz etkinlik zarı');
done('events');
