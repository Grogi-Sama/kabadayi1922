// 037: hesap silme — bağlı veriler temizlenir, aile başsız kalmaz.
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player, set, get } = await setup();
const RANK5 = 3000;
const count = async (sql, p = []) => (await db.query(sql, p)).rows[0].n;

// Don + iki üyeli aile, mesajlar, araba, ilan, kelle, arkadaşlık, öneri…
const D = await player('Silinecek', { xp: RANK5, cash: 1000000, bullets: 500 });
const S2 = await player('Sottocapo', { xp: 800 });
const A = await player('Asker', { xp: 1600 });
const X = await player('Yabanci', { xp: RANK5, cash: 1000000 });
await as(D, `select create_family('Silinenler')`);
for (const u of [S2, A]) {
  await as(u, `select apply_family('Silinenler')`);
}
await as(D, `select answer_application('Sottocapo', true)`); await as(D, `select answer_application('Asker', true)`);
await as(D, `select set_role('Sottocapo', 'sottocapo')`);
await as(D, `select post_family_message('selam aile')`);
await db.query(`insert into player_cars (player_id, car_id, city_id) values ($1, 'spor', 'istanbul')`, [D]);
await db.query(`insert into messages (from_id, to_id, text) values ($1, $2, 'merhaba'), ($2, $1, 'selam')`, [D, X]);
await as(X, `select place_bounty('Silinecek', 10000)`);
await as(D, `select submit_suggestion('ozellik', 'Bu bir test önerisidir, silinmeli')`);
await as(D, `select report_content('player', null, 'Yabanci', 'test')`);
await as(D, `select list_item('bullets', 100, null, 500)`);

// yanlış onay
assert.match((await as(D, `select delete_my_account('baska')`)).msg, /takma adını aynen yaz/);
assert.ok(await get(D), 'yanlış onayda hiçbir şey silinmez');

const r = await as(D, `select delete_my_account('silinecek')`);   // büyük/küçük harf fark etmez
assert.equal(r.ok, true, r.msg);
assert.equal(await get(D), undefined, 'oyuncu silindi');
assert.equal(await count(`select count(*)::int n from auth.users where id = $1`, [D]), 0, 'giriş kaydı silindi');
assert.equal(await count(`select count(*)::int n from player_cars where player_id = $1`, [D]), 0);
assert.equal(await count(`select count(*)::int n from messages where from_id = $1 or to_id = $1`, [D]), 0);
assert.equal(await count(`select count(*)::int n from market_listings where seller_id = $1`, [D]), 0);
assert.equal(await count(`select count(*)::int n from bounties where target_id = $1`, [D]), 0);
assert.equal(await count(`select count(*)::int n from suggestions where player_id = $1`, [D]), 0);
ok('hesap ve bağlı veriler silinir; yanlış onayda dokunulmaz');

// aile başsız kalmaz: Sottocapo Don olur, haber düşer
assert.equal((await get(S2)).family_role, 'don');
assert.equal((await get(A)).family_role, 'asker');
const fam = await as(A, `select get_family()`);
assert.ok(fam.messages.some(m => /Silinecek oyundan ayrıldı\. Yeni Don: Sottocapo/.test(m.text)));
ok('Donluk en kıdemli üyeye geçer');

// tek kişilik aile dağılır; diğer oyuncular etkilenmez
const T = await player('Tekbasina', { xp: RANK5, cash: 1000000 });
await as(T, `select create_family('Tekliler')`);
assert.equal((await as(T, `select delete_my_account('Tekbasina')`)).ok, true);
assert.equal(await count(`select count(*)::int n from families where name = 'Tekliler'`), 0);
assert.ok(await get(X), 'diğer oyuncular yerinde');
ok('tek kişilik aile dağılır');

// banlı oyuncu da silebilir
const B = await player('Banli');
await set(B, { banned_until: new Date(Date.now() + 86400e3).toISOString(), ban_reason: 'test' });
assert.equal((await as(B, `select delete_my_account('Banli')`)).ok, true);
ok('banlı oyuncu da hesabını silebilir');

// 038: giriş yapmamış (anon) biri sadece ping'i çağırabilir
await db.exec(`grant usage on schema public to anon; set role anon`);
assert.match((await db.query(`select ping() r`)).rows[0].r, /^ok /);
await assert.rejects(db.query(`select get_state()`), 'anon oyun fonksiyonlarını çağıramaz');
await db.exec(`reset role`);
ok('ping: giriş gerektirmez, başka bir şeye kapı açmaz');

done('account_delete');
