// Sohbet sekmesi: genel + şehir sohbeti.
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player, set } = await setup();
const ADMIN = await player('Yonetici');
await db.query(`insert into admins values ($1)`, [ADMIN]);
const A = await player('Ayla');
const B = await player('Baran');
const C = await player('Cemil');
await set(C, { city_id: 'izmir' });

// ─── Genel sohbet herkese, şehir sohbeti sadece o şehirdekilere
assert.equal((await as(A, `select send_chat('global', 'Selam millet')`)).ok, true);
assert.equal((await as(A, `select send_chat('city', 'İstanbul burada')`)).ok, true);
let g = await as(C, `select get_chat('global')`);
assert.equal(g.at(-1).text, 'Selam millet');
assert.equal(g.at(-1).nick, 'Ayla');
assert.equal(g.at(-1).mine, false);
assert.ok('avatar' in g.at(-1));
assert.equal((await as(C, `select get_chat('city')`)).length, 0, 'İzmir sohbetinde İstanbul mesajı görünmez');
assert.equal((await as(B, `select get_chat('city')`)).at(-1).text, 'İstanbul burada');
assert.equal((await as(A, `select get_chat('global')`)).at(-1).mine, true);
await assert.rejects(as(A, `select send_chat('city:izmir', 'sızma')`), /BAD_CHANNEL/);
ok('genel ve şehir kanalları');

// ─── Küfür filtresi, uzunluk, hız sınırı
await as(B, `select send_chat('global', 'siktir git')`);
assert.equal((await as(A, `select get_chat('global')`)).at(-1).text, '****** git');
assert.equal((await as(B, `select send_chat('global', '   ')`)).ok, false);
assert.equal((await as(B, `select send_chat('global', $1)`, ['x'.repeat(301)])).ok, false);
await as(B, `select send_chat('global', 'iki')`);
await as(B, `select send_chat('global', 'üç')`);
assert.equal((await as(B, `select send_chat('global', 'dört')`)).ok, false, '30 saniyede en fazla 3 mesaj');
ok('küfür filtresi ve hız sınırı');

// ─── Engellenen oyuncunun mesajı görünmez
await as(A, `select block_player('Baran')`);
assert.ok(!(await as(A, `select get_chat('global')`)).some(m => m.nick === 'Baran'));
assert.ok((await as(C, `select get_chat('global')`)).some(m => m.nick === 'Baran'));
ok('engelleme');

// ─── Susturulan yazamaz; şikâyet + admin silme
const msg = (await as(C, `select get_chat('global')`)).find(m => m.nick === 'Baran');
assert.equal((await as(C, `select report_content('chat_message', $1, null, 'küfür')`, [msg.id])).ok, true);
const rep = (await as(ADMIN, `select admin_reports('open')`)).find(r => r.kind === 'chat_message');
assert.equal(rep.snapshot, '****** git');
assert.equal(rep.still_exists, true);
assert.equal((await as(ADMIN, `select admin_act('Baran', 'mute', 1, 'Küfür', $1)`, [rep.id])).ok, true);
assert.equal((await as(B, `select send_chat('global', 'beni duyan var mı')`)).ok, false);
assert.equal((await as(ADMIN, `select admin_delete_message('chat_message', $1, $2)`, [msg.id, rep.id])).ok, true);
assert.ok(!(await as(C, `select get_chat('global')`)).some(m => m.id === msg.id));
ok('susturma, şikâyet ve silme');
done('chat');
