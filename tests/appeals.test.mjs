// Ceza itirazı: oyuncu itiraz eder, admin inceler (oyuncu + ceza + cezayı veren), kabul/ret, yetkiliyi uyarma.
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player } = await setup();
const OWNER = await player('Patron');
await db.query(`insert into admins (user_id, role) values ($1, 'owner')`, [OWNER]);
const MOD = await player('Bekci');
await as(OWNER, `select admin_grant('Bekci')`);
const P = await player('Masum');
const Q = await player('Suclu');

// ─── Moderatör ceza verir; oyuncu banlıyken bile cezasını görür ve itiraz eder
assert.equal((await as(MOD, `select admin_act('Masum', 'ban', 48, 'Küfür etti', null)`)).ok, true);
assert.equal((await as(MOD, `select admin_act('Suclu', 'mute', 24, 'Spam', null)`)).ok, true);
assert.ok((await as(P, `select get_state()`)).banned, 'banlı');
const pen = await as(P, `select my_penalties()`);
assert.equal(pen.length, 1); assert.equal(pen[0].action, 'ban'); assert.equal(pen[0].appeal, null);
assert.equal((await as(P, `select submit_appeal($1, 'kısa')`, [pen[0].id])).ok, false, 'en az 10 karakter');
assert.equal((await as(P, `select submit_appeal($1, 'Küfür etmedim, mesajım yanlış anlaşıldı. Kayıtlara bakın lütfen.')`, [pen[0].id])).ok, true);
assert.equal((await as(P, `select submit_appeal($1, 'Bir daha deniyorum lütfen bakın')`, [pen[0].id])).ok, false, 'aynı cezaya bir itiraz');
const qpen = await as(Q, `select my_penalties()`);
assert.equal((await as(P, `select submit_appeal($1, 'Başkasının cezasına itiraz')`, [qpen[0].id])).ok, false, 'başkasının cezası');
ok('oyuncu (banlıyken de) cezasını görür ve bir kez itiraz eder');

// ─── Sadece admin görür; oyuncu bilgisi, ceza, tarih ve cezayı veren görünür
await assert.rejects(as(MOD, `select admin_appeals('open')`), /NOT_OWNER/);
await assert.rejects(as(P, `select admin_resolve_appeal(1, true, null)`), /NOT_OWNER/);
const list = await as(OWNER, `select admin_appeals('open')`);
assert.equal(list.length, 1);
const a = list[0];
assert.equal(a.player.nick, 'Masum'); assert.equal(a.player.banned, true);
assert.equal(a.penalty.action, 'ban'); assert.equal(a.penalty.reason, 'Küfür etti'); assert.ok(a.penalty.at);
assert.equal(a.staff.nick, 'Bekci'); assert.equal(a.staff.role, 'moderator'); assert.equal(a.staff.overturned, 0);
assert.equal((await as(OWNER, `select admin_overview()`)).open_appeals, 1);
ok('admin itirazda oyuncuyu, cezayı, tarihi ve cezayı vereni görür');

// ─── Kabul: ban kalkar, oyuncuya bildirim, moderatörün hanesine "haksız ceza"
assert.equal((await as(OWNER, `select admin_resolve_appeal($1, true, 'Haklısın, özür dileriz.')`, [a.id])).ok, true);
assert.equal((await as(P, `select get_state()`)).banned, undefined, 'ban kalktı');
assert.equal((await as(P, `select my_penalties()`))[0].appeal.status, 'accepted');
assert.ok((await as(P, `select get_state()`)).events.some(e => e.text.includes('İtirazın kabul edildi')));
assert.equal((await as(OWNER, `select admin_resolve_appeal($1, false, null)`, [a.id])).ok, false, 'iki kez sonuçlanmaz');
const team = await as(OWNER, `select admin_team()`);
assert.equal(team.find(t => t.nick === 'Bekci').overturned, 1);
ok('kabul edilen itiraz cezayı kaldırır ve cezayı verene yazılır');

// ─── Moderatörü uyar; ret durumunda ceza kalır
assert.equal((await as(OWNER, `select admin_warn_staff('Bekci', 'Kanıtsız ban verme.')`)).ok, true);
assert.equal((await as(OWNER, `select admin_warn_staff('Masum', 'x')`)).ok, false, 'sadece moderatör uyarılır');
assert.equal((await as(OWNER, `select admin_team()`)).find(t => t.nick === 'Bekci').staff_warns, 1);
assert.ok((await as(MOD, `select get_state()`)).events.some(e => e.text.includes('Yönetim uyarısı')));
await as(Q, `select submit_appeal($1, 'Spam yapmadım, sadece iki mesaj attım.')`, [qpen[0].id]);
const qa = (await as(OWNER, `select admin_appeals('open')`))[0];
assert.equal((await as(OWNER, `select admin_resolve_appeal($1, false, 'Kayıtlar spam gösteriyor.')`, [qa.id])).ok, true);
assert.ok((await as(Q, `select get_state()`)).player.muted_until, 'ret: susturma sürüyor');
ok('yetkili uyarısı; ret edilen itirazda ceza sürer');
done('appeals');
