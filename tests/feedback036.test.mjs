// 036: oyuncu önerileri turu — atış korumaları, banka faizi, fabrika baskını, serseri baskınları, öneri cevapları.
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player, set, get } = await setup();
const RANK5 = 3000;
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const found = (shooter, target) => db.query(`insert into detective_searches (player_id, target_id, success, city_found, ready_at, resolved)
  values ($1, $2, true, 'istanbul', now(), true)`, [shooter, target]);
const ready = (uid) => db.query(`update players set kill_ready_at = now(), jail_until = now() where id = $1`, [uid]);

// ═══ A) Atış korumaları
const A = await player('Avci', { xp: RANK5, weapon_id: 'thompson', bullets: 50000 });
const C = await player('Cakal', { xp: RANK5, weapon_id: 'thompson', bullets: 50000 });
const T = await player('Hedef', { xp: RANK5, cash: 10000 });
await found(A, T); await found(C, T);

await set(T, { jail_until: new Date(Date.now() + 3600e3).toISOString() });
let r = await as(A, `select shoot('Hedef', 100)`);
assert.equal(r.ok, false); assert.match(r.msg, /hapiste/);
assert.equal((await get(A)).bullets, 50000, 'kurşun harcanmaz');
assert.match((await as(A, `select shoot_preview('Hedef')`)).msg, /hapiste/, 'önizleme de söyler');
await set(T, { jail_until: ago(1) });
ok('hapisteki oyuncu vurulamaz');

const k = await as(A, `select shoot('Hedef', 20000)`);
assert.equal(k.killed, true, JSON.stringify(k));
// hastaneden yeni çıktı: 30 dk dokunulmaz (herkes için)
await set(T, { hospital_until: ago(600) }); await ready(A); await ready(C);
assert.match((await as(C, `select shoot('Hedef', 100)`)).msg, /hastaneden yeni çıktı/);
// 40 dk sonra: başkası vurabilir, katil 12 saat vuramaz
await set(T, { hospital_until: ago(2400) });
assert.match((await as(A, `select shoot('Hedef', 100)`)).msg, /kısa süre önce sen öldürdün/);
assert.equal((await as(C, `select shoot('Hedef', 100)`)).ok, true, 'başka biri vurabilir');
await db.exec(`update kill_log set at = now() - interval '13 hours'`); await ready(A);
assert.equal((await as(A, `select shoot('Hedef', 100)`)).ok, true, '12 saat sonra katil de vurabilir');
ok('taburcu sonrası 30 dk + aynı katil 12 saat');

// ═══ B) Banka faizi
const B = await player('Banker', { xp: RANK5 });
await as(B, `select get_state()`);                                  // faiz saati başlar
await set(B, { bank: 1000000, interest_at: ago(3 * 86400 + 3600) });
let s = await as(B, `select get_state()`);
assert.equal(Number(s.player.bank), 1030301, 'günde %1 bileşik, 3 gün');
assert.ok(s.events.some(e => /Banka faizi: \$30301/.test(e.text)));
const left = (Date.now() - new Date((await get(B)).interest_at)) / 1000;
assert.ok(left > 3500 && left < 3700, 'artan saat bir sonraki güne devreder');

await set(B, { bank: 10000000, interest_at: ago(2 * 86400) });
await as(B, `select get_state()`);
assert.equal(Number((await get(B)).bank), 10100000, 'günlük tavan 50.000');

await set(B, { bank: 100000, interest_at: ago(30 * 86400) });
await as(B, `select get_state()`);
let exp7 = 100000;
for (let i = 0; i < 7; i++) exp7 += Math.floor(exp7 * 0.01);
assert.equal(Number((await get(B)).bank), exp7, '30 gün beklese de en fazla 7 günlük faiz');

// bakiye 0 iken bekleyip yatırınca hemen faiz yok
await set(B, { bank: 0, cash: 1000000, interest_at: ago(5 * 86400) });
await as(B, `select bank_move(1000000)`);
const b0 = Number((await get(B)).bank);
await as(B, `select get_state()`);
assert.equal(Number((await get(B)).bank), b0, 'yatırır yatırmaz faiz gelmez');
ok('banka faizi: günde %1, tavan, 7 gün, yatır-al hilesi yok');

// ═══ C) Fabrika = mekân
assert.equal((await db.query(`select count(*)::int n from spots where kind = 'fabrika'`)).rows[0].n, 6);
const D1 = await player('Donbir', { xp: RANK5, cash: 2000000, bullets: 5000 });
const D2 = await player('Doniki', { xp: RANK5, cash: 2000000, bullets: 5000 });
await as(D1, `select create_family('Birinciler')`); await as(D2, `select create_family('Ikinciler')`);
await as(D1, `select family_deposit(500000)`);
assert.equal((await as(D1, `select buy_factory()`)).ok, true);
const fab = (await db.query(`select s.id, s.owner_family, f.name from spots s left join families f on f.id = s.owner_family
  where s.kind = 'fabrika' and s.city_id = 'istanbul'`)).rows[0];
assert.equal(fab.name, 'Birinciler', 'satın alınca fabrika mekânı da ailenin');
const izmirFab = (await db.query(`select id from spots where kind = 'fabrika' and city_id = 'izmir'`)).rows[0].id;
await set(D2, { city_id: 'izmir' });
assert.match((await as(D2, `select raid_spot($1, 100)`, [izmirFab])).msg, /satın alınarak|satın alabilir/, 'sahipsiz fabrikaya baskın yok');
await set(D2, { city_id: 'istanbul' });
const raid = await as(D2, `select raid_spot($1, 500)`, [fab.id]);
assert.equal(raid.success, true, JSON.stringify(raid));
const cb = (await db.query(`select f.name from city_bullets cb join families f on f.id = cb.owner_family where cb.city_id = 'istanbul'`)).rows[0];
assert.equal(cb?.name, 'Ikinciler', 'baskınla fabrika da el değiştirir');
const fams = await as(D1, `select get_families()`);
assert.equal(fams.find(f => f.name === 'Ikinciler').spots, 0, 'aile listesinde fabrika mekân sayılmaz');
assert.equal(fams.find(f => f.name === 'Ikinciler').factories, 1);
ok('fabrika baskınla el değiştirir; sahipsiz fabrika baskınla alınmaz');

// ═══ D) Serseri baskınları (saldırı gücü sabitlensin)
await db.exec(`update game_settings set value = 5 where key in ('npc_raid_min', 'npc_raid_max')`);
const kordon = (await db.query(`select id, income from spots where name = 'Kordon Gazinosu'`)).rows[0];   // 5000/sa → güç 6×5 = 30
const fid2 = (await db.query(`select id from families where name = 'Ikinciler'`)).rows[0].id;
const bank2 = async () => Number((await db.query(`select bank from families where id = $1`, [fid2])).rows[0].bank);
await db.exec(`update families set bank = 100000 where id = ${fid2}`);

// savunma yeter (barikat 500 kurşun = 50 can): püskürtülür, barikat aşınır
await db.query(`update spots set owner_family = $1, defense = 500 where id = $2`, [fid2, kordon.id]);
await db.query(`update spots set npc_at = now() - interval '1 second' where id = $1`, [kordon.id]);
await as(D2, `select get_state()`);
let sp = (await db.query(`select * from spots where id = $1`, [kordon.id])).rows[0];
assert.equal(Number(sp.owner_family), Number(fid2)); assert.equal(sp.defense, 500 - 150, 'barikattan güç×10×0,5 gider');
assert.ok(new Date(sp.npc_at) > new Date(Date.now() + 3.9 * 3600e3), 'sıradaki baskın 4-8 saat sonra');

// savunma var ama yetmez (10 can < 30): barikat yıkılır, bir saatlik haraç yağmalanır
await db.query(`update spots set defense = 100, npc_at = now() - interval '1 second' where id = $1`, [kordon.id]);
await as(D2, `select get_state()`);
sp = (await db.query(`select * from spots where id = $1`, [kordon.id])).rows[0];
assert.equal(sp.defense, 0); assert.equal(Number(sp.owner_family), Number(fid2));
assert.equal(await bank2(), 100000 - 5000);

// hiç savunma yok: mekân elden çıkar
await db.query(`update spots set npc_at = now() - interval '1 second' where id = $1`, [kordon.id]);
await as(D2, `select get_state()`);
sp = (await db.query(`select * from spots where id = $1`, [kordon.id])).rows[0];
assert.equal(sp.owner_family, null); assert.equal(sp.npc_at, null);
const fam = await as(D2, `select get_family()`);
assert.ok(fam.messages.some(m => /püskürttü/.test(m.text)) && fam.messages.some(m => /yağmaladı/.test(m.text))
  && fam.messages.some(m => /elimizden çıktı/.test(m.text)), 'aile sohbetine haber düşer');

// korumasız fabrika da düşer → city_bullets sahipsiz
await db.query(`update spots set defense = 0, npc_at = now() - interval '1 second' where id = $1`, [fab.id]);
await as(D2, `select get_state()`);
assert.equal((await db.query(`select owner_family from city_bullets where city_id = 'istanbul'`)).rows[0].owner_family, null);
ok('serseri baskını: püskürtme, yağma, korumasız mekân/fabrika elden çıkar');

// ═══ E) Öneri cevapları
const O = await player('Sahip');
await db.query(`insert into admins (user_id, role) values ($1, 'owner')`, [O]);
const P = await player('Oneren');
await as(P, `select submit_suggestion('ozellik', 'Kurşun fabrikaları bir kez alınıyor, bir daha el değişmiyor')`);
const sid = (await db.query(`select id from suggestions order by id desc limit 1`)).rows[0].id;
await as(O, `select admin_suggestion_set($1, 'planlandi', 'Bir sonraki güncellemede')`, [sid]);
await as(O, `select admin_suggestion_set($1, 'planlandi', 'Bir sonraki güncellemede')`, [sid]);   // aynısı: tekrar bildirilmez
let ev = (await as(P, `select get_state()`)).events.filter(e => /Önerin/.test(e.text));
assert.equal(ev.length, 1, 'aynı durum + not iki kez gitmez');
assert.match(ev[0].text, /“Kurşun fabrikaları bir kez alınıyor/); assert.match(ev[0].text, /Yönetimin notu: Bir sonraki güncellemede/);
await as(O, `select admin_suggestion_set($1, 'reddedildi', null)`, [sid]);
ev = (await as(P, `select get_state()`)).events.filter(e => /Önerin/.test(e.text));
assert.match(ev[0].text, /şimdilik yapılmayacak/, 'reddetme de bildirilir');
ok('öneri cevabı: öneri + not ile, her durum, tekrarsız');

done('feedback036');
