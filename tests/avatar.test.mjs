// Faz 4B: portre seçimi.
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { as, player, set } = await setup();
const A = await player('Portreci');
assert.equal((await as(A, `select get_state()`)).player.avatar, 1);
assert.equal((await as(A, `select set_avatar(5)`)).ok, true);
assert.equal((await as(A, `select get_state()`)).player.avatar, 5);
assert.equal((await as(A, `select get_profile('portreci')`)).avatar, 5);
await assert.rejects(as(A, `select set_avatar(9)`));
ok('portre seçimi');

// Aile ekranlarında portreler: listede Don'unki, aile ekranında üyelerinki
await set(A, { xp: 3000, cash: 1000000 });
assert.equal((await as(A, `select create_family('Portre Ailesi')`)).ok, true);
const fams = await as(A, `select get_families()`);
assert.equal(fams.find(f => f.name === 'Portre Ailesi').don_avatar, 5);
assert.equal((await as(A, `select get_family()`)).members[0].avatar, 5);
const B = await player('Ailesiz');
assert.equal((await as(B, `select get_family()`)).family, null);
ok('aile ekranında portreler');
done('avatar');
