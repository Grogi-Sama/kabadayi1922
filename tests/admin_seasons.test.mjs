// Faz 4A: admin/moderasyon + sezonlar.
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player, set, get } = await setup();
const ADMIN = await player('Yonetici');
await db.query(`insert into admins values ($1)`, [ADMIN]);
const A = await player('Ayhan', { xp: 3000, cash: 50000 });
const B = await player('Bulut', { xp: 800 });

// ─── Admin yetkisi: admin olmayan hiçbir şey göremez
await assert.rejects(as(A, `select admin_overview()`), /NOT_ADMIN/);
await assert.rejects(as(A, `select admin_reports('open')`), /NOT_ADMIN/);
await assert.rejects(as(A, `select admin_act('Bulut', 'ban', null, 'x', null)`), /NOT_ADMIN/);
assert.equal((await as(A, `select get_state()`)).player.is_admin, false);
assert.equal((await as(ADMIN, `select get_state()`)).player.is_admin, true);
const ov = await as(ADMIN, `select admin_overview()`);
assert.equal(ov.players, 3); assert.equal(ov.season.name, '1. Sezon');
ok('admin yetkisi sadece admins tablosundakinde');

// ─── Şikâyet akışı
await as(B, `select send_message('Ayhan', 'aptal herif')`);
const mid = (await as(A, `select get_conversation('Bulut')`))[0].id;
await as(A, `select report_content('message', $1, null, 'hakaret')`, [mid]);
let reps = await as(ADMIN, `select admin_reports('open')`);
assert.equal(reps.length, 1);
assert.equal(reps[0].target, 'Bulut'); assert.equal(reps[0].reporter, 'Ayhan');
assert.equal(reps[0].snapshot, 'aptal herif'); assert.equal(reps[0].still_exists, true);
const pl = await as(ADMIN, `select admin_player('bulut')`);
assert.equal(pl.messages[0].text, 'aptal herif'); assert.equal(pl.reports_against, 1);
ok('şikâyetler kanıtla listelenir, oyuncu dosyası mesajları gösterir');

// ─── Mesaj silme + susturma
assert.equal((await as(ADMIN, `select admin_delete_message('message', $1, $2)`, [mid, reps[0].id])).ok, true);
assert.equal((await as(A, `select get_conversation('Bulut')`)).length, 0);
assert.equal((await as(ADMIN, `select admin_act('Bulut', 'mute', 2, '', $1)`, [reps[0].id])).ok, false, 'gerekçe zorunlu');
assert.equal((await as(ADMIN, `select admin_act('Bulut', 'mute', 2, 'Hakaret', $1)`, [reps[0].id])).ok, true);
assert.match((await as(B, `select send_message('Ayhan', 'tekrar')`)).msg, /sustur/);
assert.equal((await as(ADMIN, `select admin_reports('open')`)).length, 0, 'şikâyet kapandı');
assert.equal((await as(ADMIN, `select admin_reports('actioned')`)).length, 1);
assert.ok((await as(B, `select get_state()`)).events.some(e => /susturuldun.*Hakaret/.test(e.text)), 'oyuncu gerekçeyi görür');
assert.equal((await as(B, `select do_crime('cep')`)).ok, true, 'susturma oyunu engellemez');
await as(ADMIN, `select admin_act('Bulut', 'unmute', null, null, null)`);
assert.equal((await as(B, `select send_message('Ayhan', 'özür dilerim')`)).ok, true);
ok('mesaj silme, susturma (gerekçeli), susturma kaldırma');

// ─── Ban
assert.equal((await as(ADMIN, `select admin_act('Bulut', 'ban', null, 'Hile yazılımı', null)`)).ok, true);
const st = await as(B, `select get_state()`);
assert.equal(st.player, null); assert.equal(st.banned.reason, 'Hile yazılımı'); assert.equal(st.banned.until, null, 'kalıcı');
await assert.rejects(as(B, `select do_crime('cep')`), /BANNED/);
await assert.rejects(as(B, `select send_message('Ayhan', 'x')`), /BANNED/);
await as(ADMIN, `select admin_act('Bulut', 'unban', null, null, null)`);
assert.ok((await as(B, `select get_state()`)).player);
const log = await as(ADMIN, `select admin_log()`);
assert.deepEqual(log.map(l => l.action).slice(0, 5), ['unban', 'ban', 'unmute', 'mute', 'delete_message']);
ok('ban: oyuncu gerekçeyi görür, hiçbir aksiyon yapamaz; işlem geçmişi tutulur');

// ─── Sezon
let s = await as(A, `select get_season()`);
assert.equal(s.name, '1. Sezon');
const days = (new Date(s.ends_at) - new Date(s.starts_at)) / 86400e3;
assert.ok(Math.abs(days - 56) < 0.01, '8 hafta');
assert.equal(s.last, null);

// dünyayı doldur
await as(A, `select create_family('Ayhanlar')`);
await set(A, { kills: 7, bank: 900000 });
await set(B, { xp: 5000, cash: 1000 });
await db.query(`insert into player_cars (player_id, car_id, city_id) values ($1, 'spor', 'istanbul')`, [A]);
await db.exec(`update spots set owner_family = (select id from families limit 1) where id = 1`);
await as(A, `select send_message('Bulut', 'mesajlar sezonlar arası kalır')`);

// süresi dolsun → bir sonraki çağrı sezonu bitirir
await db.exec(`update seasons set ends_at = now() - interval '1 second'`);
s = await as(B, `select get_season()`);
assert.equal(s.name, '2. Sezon');
assert.equal(s.last.name, '1. Sezon');
assert.equal(s.last.results.itibar[0].name, 'Bulut');
assert.equal(s.last.results.infaz[0].name, 'Ayhan');
assert.equal(s.last.results.servet[0].name, 'Ayhan');
assert.equal(s.last.results.aile[0].name, 'Ayhanlar');
const a = await get(A);
assert.equal(a.xp, 0); assert.equal(Number(a.cash), 500); assert.equal(Number(a.bank), 0); assert.equal(a.family_id, null);
assert.equal((await db.query(`select count(*)::int n from families`)).rows[0].n, 0);
assert.equal((await db.query(`select count(*)::int n from player_cars`)).rows[0].n, 0);
assert.equal((await db.query(`select count(*)::int n from spots where owner_family is not null`)).rows[0].n, 0);
assert.equal((await as(B, `select get_conversation('Ayhan')`)).length, 2, 'mesajlar kalır');
ok('sezon sonu: şeref listesi 4 kategori, dünya sıfırlandı, mesajlar kaldı');

// rozetler
const pb = await as(A, `select get_profile('Bulut')`);
assert.deepEqual(pb.badges[0], { season: '1. Sezon', category: 'itibar', place: 1 });
assert.ok((await as(A, `select get_season()`)).badges.some(b => b.category === 'infaz' && b.place === 1));
ok('rozetler profilde');

// admin sezonu elle bitirebilir, bitişi değiştirebilir
assert.equal((await as(ADMIN, `select admin_set_season_end(now() + interval '3 days')`)).ok, true);
assert.equal((await as(ADMIN, `select admin_end_season()`)).ok, true);
assert.equal((await as(A, `select get_season()`)).name, '3. Sezon');
await assert.rejects(as(A, `select admin_end_season()`), /NOT_ADMIN/);
ok('admin sezonu bitirebilir / uzatabilir');

done('admin_seasons');
