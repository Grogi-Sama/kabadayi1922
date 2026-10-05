// 032: bildirim aboneliği, kuyruk (olay, özel mesaj, aile duyurusu, süresi dolanlar), sadece oyunda olmayana
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player, set, befriend } = await setup();
const A = await player('Arif', { xp: 3000, cash: 1e6 });
const B = await player('Burak', { xp: 3000 });
const q = async (pid) => (await db.query(`select title, body, tag from push_queue where player_id = $1 order by id`, [pid])).rows;
const idle = (pid) => db.query(`update players set last_seen = now() - interval '10 minutes' where id = $1`, [pid]);

assert.match((await as(A, `select save_push_sub('http://kotu', 'k', 'a')`)).msg, /Geçersiz/);
assert.equal((await as(A, `select save_push_sub('https://push.example/abc', 'p256', 'auth')`)).ok, true);
await idle(A);
await db.query(`insert into events (player_id, text) values ($1, 'Burak seni vurdu!')`, [A]);
assert.equal((await q(A)).at(-1).body, 'Burak seni vurdu!');
await db.query(`insert into events (player_id, text) values ($1, 'abonesiz olay')`, [B]);
assert.equal((await q(B)).length, 0, 'aboneliği olmayana kuyruk yok');
// oyundayken bildirim yok
await db.query(`update players set last_seen = now() where id = $1`, [A]);
await db.query(`insert into events (player_id, text) values ($1, 'oynarken olan')`, [A]);
assert.ok(!(await q(A)).some(r => r.body === 'oynarken olan'), 'oyundaysa bildirim gitmez');
ok('abonelik ve olay bildirimi (sadece oyunda olmayana)');

await idle(A); await befriend(A, B);
await as(B, `select send_message('Arif', 'Akşam baskın var mı?')`);
const m = (await q(A)).at(-1);
assert.equal(m.title, 'Burak sana yazdı'); assert.equal(m.tag, 'mesaj');
await as(A, `select create_family('Aslanlar')`); await idle(A);
await db.query(`insert into family_messages (family_id, player_id, text) select family_id, null, 'Mekân elimizden çıktı!' from players where id = $1`, [A]);
assert.equal((await q(A)).at(-1).title, 'Ailenden haber');
ok('özel mesaj ve aile duyurusu bildirimi');

// süresi az önce dolanlar
await db.exec(`delete from push_ready_mark`);
await db.query(`update players set jail_until = now() - interval '5 seconds', last_seen = now() - interval '10 minutes' where id = $1`, [A]);
assert.ok((await db.query(`select queue_ready_pushes() n`)).rows[0].n >= 1);
assert.ok((await q(A)).some(r => /Hapisten çıktın/.test(r.body)));
assert.equal((await db.query(`select queue_ready_pushes() n`)).rows[0].n, 0, 'aynı olay ikinci kez gönderilmez');
// gönderim kuyruğu
const take = (await db.query(`select * from push_take(50)`)).rows;
assert.ok(take.length >= 4 && take.every(r => r.endpoint === 'https://push.example/abc'));
assert.equal((await db.query(`select * from push_take(50)`)).rows.length, 0, 'gönderilen tekrar alınmaz');
assert.equal((await as(A, `select delete_push_sub('https://push.example/abc')`)).ok, true);
ok('süresi dolanlar, gönderim kuyruğu, abonelik silme');
done('push');
