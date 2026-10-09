// 035: mekân ailenin değilse nöbetteki adamlar eve döner (sahip değişti, aileden ayrıldı, takılı kalanlar)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player } = await setup();
const q = (sql, args) => db.query(sql, args);
const B = await player('Burak', { xp: 3000, cash: 1e7, bullets: 20000 });
await as(B, `select create_family('Boğalar')`);
const fam = (await q(`select id from families where name = 'Boğalar'`)).rows[0].id;
const galata = (await q(`select id from spots where name = 'Galata Meyhanesi'`)).rows[0].id;
const posted = async () => Number((await q(`select count(*) n from player_men where player_id = $1 and spot_id is not null`, [B])).rows[0].n);
const post = async () => {
  await q(`update spots set owner_family = $1 where id = $2`, [fam, galata]);
  await q(`update players set family_id = $1 where id = $2`, [fam, B]);
  assert.equal((await as(B, `select station_men($1, 'fedai', 5)`, [galata])).ok, true);
  assert.equal(await posted(), 5);
};
await q(`insert into player_men (player_id, type_id, ready_at) select $1, 'fedai', now() - interval '1 minute' from generate_series(1, 5)`, [B]);

// Mekân el değiştirince (aile dağıldı, sezon sıfırlandı…) nöbetçiler eve döner
await post();
await q(`update spots set owner_family = null where id = $1`, [galata]);
assert.equal(await posted(), 0, 'sahip değişince eve döndüler');

// Oyuncu aileden ayrılınca nöbetçileri eve döner
await post();
await q(`update players set family_id = null where id = $1`, [B]);
assert.equal(await posted(), 0, 'aileden ayrılınca eve döndüler');

// Daha önce takılı kalanlar: migration bir kez temizler
await post();
await q(`alter table spots disable trigger release_men_spot`);
await q(`update spots set owner_family = null where id = $1`, [galata]);
await q(`alter table spots enable trigger release_men_spot`);
assert.equal(await posted(), 5, 'eski hata: takılı kaldılar');
await db.exec(readFileSync('supabase/migrations/035_release_posted_men.sql', 'utf8'));
assert.equal(await posted(), 0, 'migration takılı kalanları eve gönderdi');
assert.equal((await as(B, `select get_men()`)).posts.length, 0);
ok('nöbetçiler: sahip değişince, aileden ayrılınca ve takılı kalanlar eve döner');
done('release_men');
