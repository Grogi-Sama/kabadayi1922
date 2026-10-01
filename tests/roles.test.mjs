// Yetki kademeleri: sahip / moderatör. Yanlış ele geçen bir yetkinin verebileceği zararı sınırlamak.
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player } = await setup();
const OWNER = await player('Sahip');
await db.query(`insert into admins (user_id, role) values ($1, 'owner')`, [OWNER]);
const MOD = await player('Moderator');
const MOD2 = await player('ModeratorIki');
const A = await player('Oyuncu');
const B = await player('OyuncuIki');

// ─── İstemci sadece listedeki fonksiyonları çağırabilir; kuralları atlayan iç fonksiyonlar kapalı
const can = async (sig) => (await db.query(`select has_function_privilege('authenticated', $1, 'execute') ok`, [sig])).rows[0].ok;
assert.equal(await can('admin_act(text, text, integer, text, bigint)'), true);
for (const sig of ['admin_act_core(text, text, integer, text, bigint)', 'admin_delete_message_core(text, bigint, bigint)',
  'admin_end_season_core()', 'admin_set_season_end_core(timestamp with time zone)', 'reset_world()', 'require_owner()']) {
  assert.equal(await can(sig), false, sig + ' istemciye kapalı olmalı');
}
await assert.rejects(db.query(`insert into admins (user_id, role) values ($1, 'owner')`, [MOD]), /one_owner|duplicate/, 'tek sahip');
ok('iç fonksiyonlar kapalı, tek sahip');

// ─── Moderatörü sadece sahip atar / alır
await assert.rejects(as(A, `select admin_grant('OyuncuIki')`), /NOT_OWNER/);
assert.equal((await as(OWNER, `select admin_grant('Moderator')`)).ok, true);
assert.equal((await as(OWNER, `select admin_grant('ModeratorIki')`)).ok, true);
assert.equal((await as(MOD, `select admin_me()`)).role, 'moderator');
await assert.rejects(as(MOD, `select admin_grant('Oyuncu')`), /NOT_OWNER/, 'moderatör yetki dağıtamaz');
await assert.rejects(as(MOD, `select admin_team()`), /NOT_OWNER/);
assert.equal((await as(OWNER, `select admin_team()`)).length, 3);
assert.equal((await as(OWNER, `select admin_revoke('Sahip')`)).ok, false, 'sahip yetkisi alınamaz');
assert.equal((await as(A, `select get_state()`)).player.is_admin, false);
assert.equal((await as(MOD, `select get_state()`)).player.is_admin, true);
ok('moderatörü sadece sahip atar');

// ─── Moderatörün sınırları
const act = (who, nick, action, hours, reason = 'kural ihlali') =>
  as(who, `select admin_act($1, $2, $3, $4, null)`, [nick, action, hours, reason]);
assert.equal((await act(MOD, 'Oyuncu', 'ban', null)).ok, false, 'kalıcı ban yok');
assert.equal((await act(MOD, 'Oyuncu', 'ban', 24 * 30)).ok, false, '7 günden uzun ban yok');
assert.equal((await act(MOD, 'Oyuncu', 'mute', 100)).ok, false, '72 saatten uzun susturma yok');
assert.equal((await act(MOD, 'Sahip', 'mute', 1)).ok, false, 'sahibe dokunulmaz');
assert.equal((await act(MOD, 'ModeratorIki', 'ban', 24)).ok, false, 'moderatör başka yetkiliye işlem yapamaz');
assert.equal((await act(OWNER, 'Sahip', 'ban', 24)).ok, false, 'kendine işlem yok');
assert.equal((await act(MOD, 'Oyuncu', 'ban', 48)).ok, true);
assert.equal((await act(MOD, 'Oyuncu', 'unban', null)).ok, true);
ok('moderatör: ban ≤ 7 gün, susturma ≤ 72 sa, yetkililere dokunamaz');

// ─── Sahibin kalıcı banını moderatör kaldıramaz; sezon sadece sahibin
assert.equal((await act(OWNER, 'OyuncuIki', 'ban', null)).ok, true);
assert.equal((await act(MOD, 'OyuncuIki', 'unban', null)).ok, false);
assert.equal((await act(OWNER, 'OyuncuIki', 'unban', null)).ok, true);
await assert.rejects(as(MOD, `select admin_end_season()`), /NOT_OWNER/);
await assert.rejects(as(MOD, `select admin_set_season_end(now() + interval '3 days')`), /NOT_OWNER/);
assert.equal((await as(OWNER, `select admin_set_season_end(now() + interval '3 days')`)).ok, true);
ok('kalıcı ban ve sezon sadece sahipte');

// ─── Saatlik ban sınırı: hesabı çalınan bir moderatör toplu ban atamaz
const victims = [];
for (let i = 0; i < 11; i++) victims.push(await player('Kurban' + 'abcdefghijk'[i]));
let banned = 0;
for (let i = 0; i < 11; i++) if ((await act(MOD, 'Kurban' + 'abcdefghijk'[i], 'ban', 24)).ok) banned++;
assert.equal(banned, 9, 'saatte en fazla 10 ban (1 tanesi yukarıda kullanıldı)');
ok('moderatörün saatlik ban sınırı');

// ─── Yetkisi alınan moderatör hiçbir şey yapamaz; her işlem kimin yaptığıyla kayıtlı
assert.equal((await as(OWNER, `select admin_revoke('Moderator')`)).ok, true);
await assert.rejects(act(MOD, 'Oyuncu', 'warn', null), /NOT_ADMIN/);
await assert.rejects(as(MOD, `select admin_reports('open')`), /NOT_ADMIN/);
const log = await as(OWNER, `select admin_log()`);
assert.ok(log.some(l => l.action === 'ban' && l.admin === 'Moderator'));
assert.ok(log.some(l => l.action === 'revoke' && l.target === 'Moderator'));
ok('yetki alınınca erişim biter; işlem kaydı');
done('roles');
