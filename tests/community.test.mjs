// Topluluk: arkadaşlık + sadece arkadaşlara özel mesaj, öneri kutusu, şikâyette sohbet bağlamı.
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player } = await setup();
const OWNER = await player('Patron');
await db.query(`insert into admins (user_id, role) values ($1, 'owner')`, [OWNER]);
const A = await player('Ayla');
const B = await player('Burak');
const C = await player('Cansu');

// ─── Arkadaşlık: istek → kabul → özel mesaj
assert.match((await as(A, `select send_message('Burak', 'selam')`)).msg, /Sadece arkadaşlarına/);
assert.equal((await as(A, `select friend_request('Burak')`)).ok, true);
assert.equal((await as(A, `select friend_request('Burak')`)).ok, false, 'tekrar istek yok');
assert.equal((await as(A, `select get_profile('Burak')`)).friend, 'sent');
assert.equal((await as(B, `select get_profile('Ayla')`)).friend, 'received');
const fb = await as(B, `select get_friends()`);
assert.equal(fb.incoming[0].nick, 'Ayla'); assert.equal(fb.friends.length, 0);
assert.ok((await as(B, `select get_state()`)).events.some(e => e.text.includes('arkadaşlık isteği')));
assert.equal((await as(A, `select send_message('Burak', 'kabul et')`)).ok, false, 'kabul edilmeden yazılamaz');
assert.equal((await as(B, `select friend_respond('Ayla', true)`)).ok, true);
assert.equal((await as(A, `select get_friends()`)).friends[0].nick, 'Burak');
assert.equal((await as(A, `select send_message('Burak', 'Selam dostum')`)).ok, true);
assert.equal((await as(B, `select send_message('Ayla', 'Selam')`)).ok, true);
assert.equal((await as(A, `select get_profile('Burak')`)).friend, 'friends');
ok('arkadaşlık isteği, kabul, sadece arkadaşlara özel mesaj');

// ─── Karşılıklı istek kendiliğinden kabul; ret; çıkarma; engel
await as(C, `select friend_request('Ayla')`);
assert.match((await as(A, `select friend_request('Cansu')`)).msg, /artık arkadaşsınız/);
assert.equal((await as(A, `select friend_remove('Cansu')`)).ok, true);
assert.equal((await as(A, `select send_message('Cansu', 'x')`)).ok, false, 'çıkarılınca yazılamaz');
await as(C, `select friend_request('Burak')`);
assert.equal((await as(B, `select friend_respond('Cansu', false)`)).ok, true);
assert.equal((await as(B, `select get_friends()`)).incoming.length, 0);
await as(B, `select block_player('Cansu')`);
assert.equal((await as(C, `select friend_request('Burak')`)).ok, false, 'engelleyene istek gitmez');
assert.equal((await as(OWNER, `select send_message('Cansu', 'Yönetimden bilgilendirme')`)).ok, true, 'yetkili herkese yazabilir');
ok('karşılıklı istek, ret, çıkarma, engel, yetkili istisnası');

// ─── Öneri kutusu: sadece admin görür
assert.equal((await as(A, `select submit_suggestion('etkinlik', 'kısa')`)).ok, false);
assert.equal((await as(A, `select submit_suggestion('etkinlik', 'Her ay bir İstanbul derbisi yarışı olsun, büyük ödüllü.')`)).ok, true);
await as(A, `select submit_suggestion('hata', 'Haritada bazen bina adı kayıyor, telefonda.')`);
await as(A, `select submit_suggestion('diger', 'Üçüncü öneri, bugün son hakkım bu.')`);
assert.equal((await as(A, `select submit_suggestion('diger', 'Dördüncü öneri olmamalı aslında.')`)).ok, false, 'günde 3');
await assert.rejects(as(A, `select admin_suggestions('hepsi')`), /NOT_OWNER/);
const sl = await as(OWNER, `select admin_suggestions('yeni')`);
assert.equal(sl.length, 3); assert.equal(sl.at(-1).nick, 'Ayla'); assert.equal(sl.at(-1).category, 'etkinlik');
assert.equal((await as(OWNER, `select admin_suggestion_set($1, 'planlandi', 'Güzel fikir!')`, [sl.at(-1).id])).ok, true);
const mine = await as(A, `select my_suggestions()`);
assert.equal(mine.find(x => x.category === 'etkinlik').status, 'planlandi');
assert.equal(mine.find(x => x.category === 'etkinlik').note, 'Güzel fikir!');
ok('öneri kutusu');

// ─── Şikâyette sohbet bağlamı: öncesi ve sonrası, mesaj silinse bile
for (let i = 1; i <= 12; i++) {
  await db.query(`insert into chat_messages (channel, player_id, text, created_at)
    values ('global', $1, $2, now() - make_interval(secs => 100 - $3::int))`, [i % 2 ? A : B, 'mesaj ' + i, i]);
}
const target = (await db.query(`select id from chat_messages where text = 'mesaj 6'`)).rows[0].id;
await db.query(`update chat_messages set text = 'aptal herif' where id = $1`, [target]);
assert.equal((await as(C, `select report_content('chat_message', $1, null, 'Küfür / hakaret')`, [target])).ok, true);
const rep = (await as(OWNER, `select admin_reports('open')`)).find(r => r.kind === 'chat_message');
assert.equal(rep.context.length, 12, '5 önce + hedef + 6 sonra (hepsi 12)');
assert.equal(rep.context.find(m => m.target).text, 'aptal herif');
assert.equal(rep.context[0].text, 'mesaj 1');
const ban = await as(OWNER, `select admin_act('Burak', 'mute', 2, 'Hakaret', $1)`, [rep.id]);
assert.equal(ban.ok, true);
await as(OWNER, `select admin_delete_message('chat_message', $1, $2)`, [target, rep.id]);
const pen = await as(B, `select my_penalties()`);
assert.equal(pen[0].evidence, 'aptal herif', 'oyuncu cezasına sebep olan mesajı görür');
await as(B, `select submit_appeal($1, 'Şaka yapıyorduk, kırıcı olmak istemedim.')`, [pen[0].id]);
const ap = (await as(OWNER, `select admin_appeals('open')`))[0];
assert.ok(ap.penalty.context.length >= 11, 'mesaj silinse bile çevresi görünür');
assert.ok(ap.penalty.context.every(m => m.text !== 'aptal herif'), 'silinen mesaj bağlamda yok, kanıt ayrıca var');
assert.equal(ap.penalty.evidence, 'aptal herif');
ok('şikâyet/itirazda sohbet bağlamı, oyuncu kendi mesajını görür');
done('community');
