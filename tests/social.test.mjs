// Faz 3A: mesajlar, engelleme, şikâyet, küfür filtresi, saygı puanı.
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player, set, get } = await setup();
const A = await player('Ayse', { xp: 3000, cash: 1e6 });
const B = await player('Bekir', { xp: 800 });
const C = await player('Cengiz');

// ─── Mesajlaşma
assert.equal((await as(A, `select send_message('Bekir', 'Selam Bekir')`)).ok, true);
assert.equal((await as(A, `select send_message('Ayse', 'kendime')`)).ok, false);
assert.equal((await as(A, `select send_message('Bekir', '   ')`)).ok, false);
assert.equal((await as(B, `select get_state()`)).player.unread, 1);
let inbox = await as(B, `select get_inbox()`);
assert.equal(inbox[0].nick, 'Ayse'); assert.equal(Number(inbox[0].unread), 1);
let conv = await as(B, `select get_conversation('Ayse')`);
assert.equal(conv[0].text, 'Selam Bekir'); assert.equal(conv[0].mine, false);
assert.equal((await as(B, `select get_state()`)).player.unread, 0, 'okununca sayaç sıfırlanır');
await as(B, `select send_message('Ayse', 'Aleykümselam')`);
conv = await as(A, `select get_conversation('bekir')`);
assert.deepEqual(conv.map(m => m.mine), [true, false]);
ok('mesaj gönder, gelen kutusu, okundu işareti');

// ─── Hız sınırı
for (let i = 0; i < 6; i++) await as(C, `select send_message('Ayse', $1)`, ['m' + i]);
assert.equal((await as(C, `select send_message('Ayse', 'fazla')`)).ok, false);
ok('mesaj hız sınırı');

// ─── Küfür filtresi (kelime sınırı)
await db.exec(`delete from messages where from_id = '${C}'`);
await as(C, `select send_message('Bekir', 'amk ne biçim iş, sikke topladım, AMK')`);
conv = await as(B, `select get_conversation('Cengiz')`);
assert.equal(conv[0].text, '*** ne biçim iş, sikke topladım, ***');
ok(`filtre: "${conv[0].text}"`);

// ─── Engelleme
assert.equal((await as(B, `select block_player('Cengiz')`)).ok, true);
assert.equal((await as(C, `select send_message('Bekir', 'hey')`)).ok, false, 'engelli gönderemez');
inbox = await as(B, `select get_inbox()`);
assert.ok(!inbox.some(x => x.nick === 'Cengiz'), 'engellinin konuşması gizli');
assert.equal((await as(B, `select get_profile('Cengiz')`)).blocked, true);
await as(B, `select unblock_player('Cengiz')`);
assert.equal((await as(C, `select send_message('Bekir', 'barışalım')`)).ok, true);
ok('engelle / engeli kaldır');

// ─── Aile sohbetinde engel + filtre
await as(A, `select create_family('Test Ailesi')`);
await as(B, `select apply_family('Test Ailesi')`);
await as(A, `select answer_application('Bekir', true)`);
await as(B, `select post_family_message('siktir git')`);
let fam = await as(A, `select get_family()`);
const bad = fam.messages.find(m => m.nick === 'Bekir');
assert.equal(bad.text, '****** git');
await as(A, `select block_player('Bekir')`);
fam = await as(A, `select get_family()`);
assert.ok(!fam.messages.some(m => m.nick === 'Bekir'), 'engellinin aile mesajı gizli');
ok('aile sohbeti: filtre + engel');

// ─── Şikâyet
const msgId = (await as(B, `select get_conversation('Cengiz')`)).at(-1).id;
assert.equal((await as(B, `select report_content('message', $1, null, 'hakaret')`, [msgId])).ok, true);
assert.equal((await as(A, `select report_content('message', $1, null, 'x')`, [msgId])).ok, false, 'başkasının mesajı şikâyet edilemez');
assert.equal((await as(A, `select report_content('family_message', $1, null, 'küfür')`, [bad.id])).ok, true);
assert.equal((await as(A, `select report_content('player', null, 'Cengiz', 'dolandırıcı')`)).ok, true);
const reps = (await db.query(`select kind, snapshot from reports order by id`)).rows;
assert.equal(reps.length, 3);
assert.equal(reps[0].snapshot, 'barışalım', 'kanıt saklanır');
ok('şikâyet: kanıt kaydı, sadece kendi gördüğün içerik');

// ─── Saygı puanı
let s = await as(A, `select get_state()`);
assert.equal(s.player.respect_left, 5 + 2 * 5);
assert.equal((await as(A, `select give_respect('Ayse', 1)`)).ok, false);
assert.equal((await as(A, `select give_respect('Bekir', 16)`)).ok, false);
assert.equal((await as(A, `select give_respect('Bekir', 10)`)).ok, true);
assert.equal((await get(B)).respect, 10);
assert.equal((await as(A, `select get_state()`)).player.respect_left, 5);
await db.exec(`update players set respect_week = respect_week - 7`);
assert.equal((await as(A, `select get_state()`)).player.respect_left, 15, 'haftalık yenilenir');
ok('saygı puanı: haftalık hak, kendine yok');

// ─── Yetki listesi eksiksiz: her RPC istemciden çağrılabilir, yardımcılar çağrılamaz
await db.exec(`grant usage on schema public to authenticated; grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated; set role authenticated`);
await db.query(`select set_config('test.uid', $1, false)`, [A]);
assert.ok((await db.query(`select get_inbox() r`)).rows[0].r);
await assert.rejects(db.query(`select clean_text('x')`));
await assert.rejects(db.query(`select apply_grants()`));
await assert.rejects(db.query(`select * from reports`));
await db.exec(`reset role`);
ok('yetkiler');

done('social');
