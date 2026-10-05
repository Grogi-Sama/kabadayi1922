// 033: duyurular — herkes okur, sadece Admin yazar/siler/sabitler; bildirim ve Defter noktası
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player } = await setup();
const OWNER = await player('Patron');
await db.query(`insert into admins (user_id, role) values ($1, 'owner')`, [OWNER]);
const A = await player('Ayla');

let list = await as(A, `select get_announcements()`);
assert.equal(list.length, 1, 'ilk güncelleme notu hazır'); assert.equal(list[0].pinned, true);
await assert.rejects(as(A, `select admin_announce('duyuru', 'Merhaba', 'Selam ahali', false, false)`), /NOT_OWNER/);
assert.match((await as(OWNER, `select admin_announce('yanlis', 'Merhaba', 'Selam ahali', false, false)`)).msg, /Tür/);
await as(A, `select save_push_sub('https://push.example/a', 'p', 'a')`);
await db.query(`update players set last_seen = now() - interval '1 hour' where id = $1`, [A]);
const r = await as(OWNER, `select admin_announce('bakim', 'Cumartesi bakım', 'Cumartesi 03:00-04:00 arası kısa bakım yapılacak.', false, true)`);
assert.equal(r.ok, true); assert.match(r.msg, /1 oyuncu/);
assert.equal((await db.query(`select count(*)::int n from push_queue where player_id = $1 and tag = 'duyuru'`, [A])).rows[0].n, 1);
list = await as(A, `select get_announcements()`);
assert.equal(list.length, 2); assert.equal(list[1].kind, 'bakim', 'sabitlenen önce, sonra yeniler');
const n = await as(A, `select notify_poll(now() - interval '1 minute')`);
assert.equal(n.heads.ann, list.find(x => x.kind === 'bakim').id, 'Defter noktası için son duyuru');
assert.equal((await as(OWNER, `select admin_announcement_pin($1)`, [list[1].id])).ok, true);
assert.equal((await as(OWNER, `select admin_announcement_delete($1)`, [list[0].id])).ok, true);
assert.equal((await as(A, `select get_announcements()`)).length, 1);
ok('duyurular: okuma, yazma yetkisi, bildirim, sabitleme, silme');
done('announce');
