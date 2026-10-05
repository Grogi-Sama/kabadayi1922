// 030: hapisteyken para/mal hareketi yok, baskın önizlemesi, bildirim yoklaması
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player, set, ready } = await setup();
const A = await player('Arif', { xp: 3000, cash: 1e6, bullets: 5000, city_id: 'iskenderiye' });
const B = await player('Burak', { xp: 3000, cash: 1e6, city_id: 'iskenderiye' });
await as(A, `select create_family('Aslanlar')`);

// ─── Hapisteyken kasaya para, pazar, araba satışı, koruma yok
await set(A, { jail_until: new Date(Date.now() + 3600e3).toISOString() });
for (const sql of [`select family_deposit(100)`, `select hire_bodyguard()`, `select buy_listing(1)`, `select list_item('bullets', 10, null, 100)`,
                   `select buy_transport('motorbot')`, `select sell_car(1)`, `select fortify_spot(1, 10)`]) {
  assert.match((await as(A, sql)).msg, /Hapistesin/, sql);
}
await ready(A);
assert.equal((await as(A, `select family_deposit(100)`)).ok, true, 'dışarıda çalışır');
ok('hapisteyken para ve mal hareketi engelli');

// ─── Baskın önizlemesi: sahipsiz mekân, kurşunla kazanma ihtimali artar
const spot = (await db.query(`select id from spots where name = 'Corniche Gazinosu'`)).rows[0].id;
const p0 = await as(A, `select raid_preview($1, 0)`, [spot]);
const p4 = await as(A, `select raid_preview($1, 400)`, [spot]);
const p10 = await as(A, `select raid_preview($1, 1000)`, [spot]);
assert.equal(p0.enemy.npc, 6); assert.equal(p0.enemy.hp, 72);   // 5500/1000 = 5,5 → 6 (baskınla aynı)
assert.equal(p0.chance, 0, 'kurşunsuz ve adamsız kazanılmaz');
assert.ok(p4.chance < 30, `400 kurşun yetmez (%${p4.chance})`);
assert.equal(p10.chance, 100, '1000 kurşun kesin alır');
assert.equal(p10.me.bullet_dmg, 10);
for (let i = 0; i < 3; i++) { await db.query(`delete from player_cooldowns where kind='hire_man'`); await as(A, `select hire_man('gozcu')`); }
await db.query(`update player_men set ready_at = now() - interval '1 second'`);
const pg = await as(A, `select raid_preview($1, 0)`, [spot]);
assert.equal(pg.me.men, 0, 'gözcüler baskına girmez'); assert.equal(pg.me.scouts, 3);
ok(`baskın önizlemesi: 0 kurşun %${p0.chance}, 400 kurşun %${p4.chance}, 1000 kurşun %${p10.chance}`);

// ─── Bildirim yoklaması: sohbet başlıkları, olaylar, aile duyuruları
const since = new Date(Date.now() - 1000).toISOString();
await as(B, `select send_chat('global', 'selam')`);
await as(B, `select send_chat('city', 'şehirden selam')`);
await db.query(`insert into events (player_id, text) values ($1, 'Ekip işi başarıyla bitti!')`, [A]);
await db.query(`insert into family_messages (family_id, player_id, text) select family_id, null, 'Mekân elimizden çıktı!' from players where id = $1`, [A]);
const n = await as(A, `select notify_poll($1)`, [since]);
assert.ok(n.heads.global > 0 && n.heads.city > 0 && n.heads.family > 0);
assert.ok(n.events.some(e => /Ekip işi/.test(e.text)));
assert.ok(n.family_news.some(e => /elimizden/.test(e.text)));
const n2 = await as(A, `select notify_poll($1)`, [n.now]);
assert.equal(n2.events.length, 0, 'yeni olay yoksa boş');
ok('bildirim yoklaması');
done('fixes030');
