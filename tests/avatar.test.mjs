// Faz 4B: portre seçimi.
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { as, player } = await setup();
const A = await player('Portreci');
assert.equal((await as(A, `select get_state()`)).player.avatar, 1);
assert.equal((await as(A, `select set_avatar(5)`)).ok, true);
assert.equal((await as(A, `select get_state()`)).player.avatar, 5);
assert.equal((await as(A, `select get_profile('portreci')`)).avatar, 5);
await assert.rejects(as(A, `select set_avatar(9)`));
ok('portre seçimi');
done('avatar');
