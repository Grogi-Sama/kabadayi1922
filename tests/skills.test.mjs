// 041: karakter seviyesi ve yetenek ağacı
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player, set, get, ready } = await setup();
const learn = (u, id) => as(u, `select learn_skill($1)`, [id]);
const sk = async (u) => as(u, `select get_skills()`);

// Seviye ve puan: seviye = floor(sqrt(xp/20)) + 1
const A = await player('Usta', { xp: 0, cash: 1000000 });
assert.equal((await sk(A)).points.level, 1);
assert.equal((await sk(A)).points.free, 0);
assert.match((await learn(A, 'y_usta')).msg, /puanın yok/);
await set(A, { xp: 2000 });          // seviye 11 → 10 puan
let S = await sk(A);
assert.equal(S.points.level, 11); assert.equal(S.points.free, 10);
assert.equal(S.skills.length, 20);
const st = await as(A, `select get_state()`);
assert.equal(st.player.skill.level, 11); assert.equal(st.player.skill.free, 10);
ok('seviye itibardan hesaplanır, her seviye 1 puan');

// Satır kilidi ve kademe sınırı
assert.match((await learn(A, 'y_ganimet')).msg, /en az 2 puan/);
for (let i = 0; i < 3; i++) assert.equal((await learn(A, 'y_usta')).ok, true);
assert.match((await learn(A, 'y_usta')).msg, /en üst kademede/);
assert.equal((await learn(A, 'y_ganimet')).ok, true);       // dalda 3 puan → 2. satır açık
assert.match((await learn(A, 'y_oto')).msg, /en az 7 puan/);
S = await sk(A);
assert.equal(S.points.free, 6); assert.equal(S.branches.yeralti, 4);
ok('satırlar dalda harcanan puanla açılır; kademe tavanı var');

// Yeraltı: iş şansı (ekran = işlem) +6 puan
const B = await player('Acemi', { xp: 2000, cash: 1000000 });
const chance = async (u) => (await as(u, `select get_state()`)).crimes.find(c => c.id === 'cep').chance;
assert.ok(Math.abs((await chance(A)) - Math.min(0.95, (await chance(B)) + 0.06)) < 0.0011, 'iş şansı +6 puan');
ok('Usta Eller iş şansını artırır');

// Ticaret: alış ucuz, satış pahalı, kapasite
const C = await player('Tuccar', { xp: 2000, cash: 1000000 });
for (let i = 0; i < 3; i++) await learn(C, 't_pazarlik');
await learn(C, 't_satis');
const mk = async (u) => (await as(u, `select get_state()`)).market.find(m => m.id === 'kahve');
const mC = await mk(C), mB = await mk(B);
assert.equal(mC.price, Math.max(1, Math.round(mB.price * 0.91)));
assert.equal(mC.sell, Math.floor(mB.sell * 1.03));
assert.equal((await as(C, `select get_state()`)).player.carry, (await as(B, `select get_state()`)).player.carry);
await learn(C, 't_ambar');   // dalda 4 puan → 3. satır
assert.equal((await as(C, `select get_state()`)).player.carry, (await as(B, `select get_state()`)).player.carry + 3);
const cash0 = Number((await get(C)).cash);
assert.equal((await as(C, `select trade('kahve', 1)`)).ok, true);
assert.equal(cash0 - Number((await get(C)).cash), mC.price, 'işlemde de indirimli fiyat');
ok('Ticaret: indirimli alış, pahalı satış, fazla kasa');

// Savaş: gereken kurşun (nişancı azaltır, kalın deri artırır)
const need = (t, s) => db.query(`select required_bullets(t, s) n from players t, players s where t.id = $1 and s.id = $2`, [t, s]).then(r => r.rows[0].n);
const D = await player('Nisanci', { xp: 2000 }), E = await player('Kalin', { xp: 2000 });
await db.query(`update players set weapon_id = (select id from weapons order by id limit 1) where id in ($1, $2)`, [D, E]);
const base = await need(E, D);
for (let i = 0; i < 3; i++) await learn(D, 's_nisan');
assert.ok((await need(E, D)) < base, 'nişancı daha az kurşunla indirir');
for (let i = 0; i < 3; i++) await learn(E, 's_nisan');
for (let i = 0; i < 2; i++) await learn(E, 's_deri');
const withDeri = await need(E, D);
await db.query(`delete from player_skills where player_id = $1 and skill_id = 's_deri'`, [E]);
assert.ok(withDeri > await need(E, D), 'kalın deri gereken kurşunu artırır');
ok('Savaş: nişancı ve kalın deri gereken kurşunu değiştirir');

// Liderlik: adam kapasitesi
const F = await player('Lider', { xp: 2000, cash: 1000000 });
const cap = async (u) => (await as(u, `select get_men()`)).cap;
const c0 = await cap(F);
await learn(F, 'l_kalabalik'); await learn(F, 'l_kalabalik');
assert.equal(await cap(F), c0 + 2);
ok('Liderlik: Kalabalık Çete adam kapasitesini artırır');

// Yeraltı: kaygan → hapis kısalır (işi zorla başarısız yap)
await db.exec(`update crimes set base_rate = -5 where id = 'cep'`);
const G = await player('Kaygan', { xp: 2000 });
for (const id of ['y_usta', 'y_usta', 'y_usta', 'y_ganimet']) await learn(G, id);
assert.equal((await learn(G, 'y_kaygan')).ok, true);
let jailed = null;
for (let i = 0; i < 40 && !jailed; i++) {
  await ready(G);
  const r = await as(G, `select do_crime('cep')`);
  if (r.jailed) jailed = r;
}
const jailS = (await db.query(`select jail_s from crimes where id = 'cep'`)).rows[0].jail_s;
assert.match(jailed.msg, new RegExp(Math.max(1, Math.ceil(jailS * 0.85)) + ' sn hapis'));
await db.exec(`update crimes set base_rate = 0.5 where id = 'cep'`);
ok('Kaygan hapis süresini kısaltır');

// Sıfırlama: ücretli, puanlar geri gelir
const lvl = (await sk(A)).points.level;
const cashA = Number((await get(A)).cash);
assert.equal((await as(A, `select reset_skills()`)).ok, true);
assert.equal(cashA - Number((await get(A)).cash), lvl * 2000);
assert.equal((await sk(A)).points.free, lvl - 1);
assert.match((await as(A, `select reset_skills()`)).msg, /Sıfırlanacak yeteneğin yok/);
ok('sıfırlama ücretli, puanlar geri gelir');

// Sezon sonu: ağaç sıfırlanır
await db.exec(`select reset_world()`);
assert.equal((await db.query(`select count(*)::int n from player_skills`)).rows[0].n, 0);
ok('sezon sonunda yetenekler sıfırlanır');

done('skills');
