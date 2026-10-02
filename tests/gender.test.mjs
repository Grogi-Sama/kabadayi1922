// 022: cinsiyet, cinsiyete göre portre, evlenme teklifi kuralları (karşı cins, arkadaş, tek teklif, ret sonrası 14 gün)
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player, set, befriend } = await setup();

// ─── Girişte cinsiyet + uygun portre
const uid = '00000000-0000-0000-0000-000000000999';
await db.query(`insert into auth.users values ($1)`, [uid]);
assert.match((await as(uid, `select create_character('Leyla', 'k', 2)`)).msg, /uygun değil/);
assert.match((await as(uid, `select create_character('Leyla', 'x', 6)`)).msg, /Cinsiyet/);
assert.equal((await as(uid, `select create_character('Leyla', 'k', 6)`)).ok, true);
let s = await as(uid, `select get_state()`);
assert.equal(s.player.gender, 'k'); assert.equal(s.player.avatar, 6);
assert.equal((await as(uid, `select set_avatar(3)`)).ok, false, 'kadın erkek portresi seçemez');
assert.equal((await as(uid, `select set_avatar(8)`)).ok, true);
ok('cinsiyet seçimi ve uygun portre');

// ─── Teklif kuralları
const A = await player('Ahmet', { cash: 1e6, gender: 'e' });
const B = await player('Burcu', { cash: 1e6, gender: 'k' });
const C = await player('Cem', { cash: 1e6, gender: 'e' });
assert.match((await as(A, `select propose('Burcu')`)).msg, /arkadaş/, 'arkadaş olmayana teklif yok');
await befriend(A, B); await befriend(A, C); await befriend(A, uid);
assert.match((await as(A, `select propose('Cem')`)).msg, /karşı cins/);
assert.equal((await as(A, `select propose('Burcu')`)).ok, true);
assert.match((await as(A, `select propose('Burcu')`)).msg, /cevap bekleniyor/, 'tekrar gönderilemez');
assert.match((await as(A, `select propose('Leyla')`)).msg, /Bekleyen bir teklifin/, 'aynı anda tek teklif');
assert.equal((await as(B, `select get_profile('Ahmet')`)).proposed_to_me, true);
assert.equal((await as(A, `select get_profile('Burcu')`)).i_proposed, true);

// ret → 14 gün bekleme
assert.equal((await as(B, `select reject_proposal('Ahmet')`)).ok, true);
assert.match((await as(A, `select propose('Burcu')`)).msg, /14 gün/);
await db.query(`update proposal_rejections set at = now() - interval '15 days'`);
assert.equal((await as(A, `select propose('Burcu')`)).ok, true, '14 gün sonra tekrar olur');

// geri çekme → başkasına teklif
assert.equal((await as(A, `select cancel_proposal()`)).ok, true);
assert.equal((await as(A, `select propose('Leyla')`)).ok, true);
assert.equal((await as(uid, `select accept_proposal('Ahmet')`)).ok, true);
assert.equal((await as(B, `select get_profile('Ahmet')`)).spouse, 'Leyla');
assert.equal((await as(B, `select get_profile('Ahmet')`)).spouse_rank, 0, 'profilde eşin rütbesi');
assert.equal((await as(A, `select get_state()`)).player.spouse_avatar, 8, 'Konak için eşin portresi');
ok('teklif: karşı cins, arkadaş, tek teklif, ret sonrası 14 gün, geri çekme');
done('gender');
