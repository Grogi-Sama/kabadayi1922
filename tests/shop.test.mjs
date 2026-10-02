// 025: mağaza (özel portre/arma), kulüp, hızlandırma (jeton/kulüp/reklam), satın alma sadece sunucudan
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player, set } = await setup();
const OWNER = await player('Patron', { gender: 'e' });
await db.query(`insert into admins (user_id, role) values ($1, 'owner')`, [OWNER]);
const A = await player('Ahmet', { gender: 'e', xp: 3000, cash: 1e6 });
const K = await player('Kerime', { gender: 'k' });

// ─── Satın alma istemciye kapalı; özel portre sahip olmadan seçilmez
assert.equal((await db.query(`select count(*)::int n from api_rpcs where sig like 'grant_product%'`)).rows[0].n, 0, 'grant_product istemciye açık değil');
assert.match((await as(A, `select set_avatar(9)`)).msg, /mağazada/);
assert.match((await as(A, `select set_avatar(13)`)).msg, /cinsiyet/);
const uid = '00000000-0000-0000-0000-000000000777';
await db.query(`insert into auth.users values ($1)`, [uid]);
assert.equal((await as(uid, `select create_character('Yeni', 'e', 9)`)).ok, false, 'girişte özel portre yok');
let shop = await as(A, `select get_shop()`);
assert.equal(shop.products.filter(p => p.kind === 'portrait').length, 8);
assert.equal(shop.products.find(p => p.id === 'portrait_9').owned, false);
ok('satın alma sunucuda; kilitli portre seçilemez');

// ─── Admin hediye: portre, arma, jeton, kulüp
await assert.rejects(as(A, `select admin_grant('Ahmet', 'club')`), /NOT_OWNER/);
assert.equal((await as(OWNER, `select admin_grant('Ahmet', 'portrait_9')`)).ok, true);
assert.equal((await as(A, `select set_avatar(9)`)).ok, true);
assert.equal((await as(A, `select get_state()`)).player.avatar, 9);
await as(A, `select create_family('Aslanlar')`);
assert.match((await as(A, `select set_family_crest(12)`)).msg, /mağazada/);
await as(OWNER, `select admin_grant('Ahmet', 'crest_12')`);
assert.equal((await as(A, `select set_family_crest(12)`)).ok, true);
assert.equal((await as(A, `select set_family_crest(3)`)).ok, true, 'ücretsiz armalar çalışmaya devam eder');
ok('özel portre ve arma kullanımı');

// ─── Hızlandırma: jeton, kulüp, reklam kapalı, hapis hızlanmaz
assert.equal((await as(A, `select do_crime('cep')`)).ok, true);
await db.query(`update players set jail_until = now() where id = $1`, [A]);
const cdBefore = (await db.query(`select ready_at - now() d from player_cooldowns where player_id = $1 and kind = 'crime:cep'`, [A])).rows[0].d;
assert.match((await as(A, `select use_boost('crime:cep', 'token')`)).msg, /jetonun yok/);
assert.match((await as(A, `select use_boost('crime:cep', 'ad')`)).msg, /yakında/);
await as(OWNER, `select admin_grant('Ahmet', 'boosts_10')`);
assert.equal((await as(A, `select use_boost('crime:cep', 'token')`)).ok, true);
const left = await db.query(`select extract(epoch from ready_at - now()) s from player_cooldowns where player_id = $1 and kind = 'crime:cep'`, [A]);
assert.ok(left.rows[0].s < 22 && left.rows[0].s > 15, `40 sn → ~20 sn (${left.rows[0].s})`);
assert.equal((await as(A, `select get_shop()`)).tokens, 9);
assert.match((await as(A, `select use_boost('car', 'token')`)).msg, /zaten hazır/);
assert.match((await as(A, `select use_boost('crime:cep', 'club')`)).msg, /üyelere/);
await as(OWNER, `select admin_grant('Ahmet', 'club')`);
assert.equal((await as(A, `select use_boost('crime:cep', 'club')`)).ok, true);
shop = await as(A, `select get_shop()`);
assert.ok(shop.club_until && shop.club_left === 4 && shop.club_gift_ready);
ok('hızlandırma: jeton, kulüp hakkı, reklam kapalı');

// ─── Kulüp hediyesi ayda bir; sohbette ve profilde kulüp görünür
assert.equal((await as(A, `select club_claim('crest_15')`)).ok, true);
assert.match((await as(A, `select club_claim('crest_16')`)).msg, /aldın/);
await as(A, `select send_chat('global', 'Merhaba millet')`);
const chat = await as(K, `select get_chat('global')`);
assert.equal(chat.at(-1).club, true);
assert.equal((await as(K, `select get_profile('Ahmet')`)).club, true);
assert.equal((await as(A, `select get_state()`)).player.club, true);
// günlük tavan
await db.query(`insert into boost_log values ($1, (now() at time zone 'Europe/Istanbul')::date, 'token', 20)
  on conflict (player_id, day, via) do update set n = 20`, [A]);
assert.match((await as(A, `select use_boost('crime:cep', 'token')`)).msg, /Bugünlük/);
ok('kulüp hediyesi, sohbet/profil rozeti, günlük tavan');

// ─── 026: hapis sadece reklamla hızlanır
await db.query(`delete from boost_log where player_id = $1`, [A]);
await db.query(`update players set jail_until = now() + interval '100 seconds' where id = $1`, [A]);
assert.match((await as(A, `select use_boost('jail', 'token')`)).msg, /sadece reklam/);
assert.match((await as(A, `select use_boost('jail', 'club')`)).msg, /sadece reklam/);
await db.exec(`update game_settings set value = 1 where key = 'ads_enabled'`);
assert.equal((await as(A, `select use_boost('jail', 'ad')`)).ok, true);
const jl = await db.query(`select extract(epoch from jail_until - now()) s from players where id = $1`, [A]);
assert.ok(jl.rows[0].s < 52 && jl.rows[0].s > 45, `100 sn → ~50 sn (${jl.rows[0].s})`);
await db.exec(`update game_settings set value = 0 where key = 'ads_enabled'`);
ok('hapis: sadece reklamla yarıya iner');
done('shop');
