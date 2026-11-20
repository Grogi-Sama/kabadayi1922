// 042: üst rütbelerde itibar daha yavaş gelir; rütbe eşikleri ve mevcut rütbeler değişmez
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player, get, ready } = await setup();
await db.exec(`update crimes set base_rate = 5 where id = 'cep'`);   // iş hep başarılı olsun

const A = await player('Caylakk', { xp: 0 });
const r0 = await as(A, `select do_crime('cep')`);
assert.equal(r0.success, true); assert.equal(r0.xp, 5, 'çaylakta tam itibar');
assert.equal((await get(A)).xp, 5);

const B = await player('Efendii', { xp: 12000 });   // Efendi: katsayı 0,2
await ready(B);
const r1 = await as(B, `select do_crime('cep')`);
assert.equal(r1.xp, 1); assert.match(r1.msg, /\+1 itibar/);
assert.equal((await get(B)).xp, 12001, 'mesajdaki ile aynı; iki kez ölçeklenmez');
ok('iş itibarı rütbeye göre ölçeklenir, mesaj doğru');

// Ekrandaki iş listesi ölçekli
const st = await as(B, `select get_state()`);
assert.equal(st.crimes.find(c => c.id === 'banka').xp, Math.round(120 * 0.2));
assert.equal(st.player.xp_rate, 0.2);
ok('ekranda gösterilen itibar ve katsayı');

// Diğer kaynaklar (oyuncunun kendi güncellemesi) tetikleyiciyle ölçeklenir; başkasının yaptığı düzeltme ölçeklenmez
await as(B, `select 1`);
await db.query(`update players set xp = xp + 100 where id = $1`, [B]);   // test.uid = B → oyuncunun kendi işlemi
assert.equal((await get(B)).xp, 12001 + 20);
await db.query(`select set_config('test.uid', '', false)`);
await db.query(`update players set xp = xp + 100 where id = $1`, [B]);
assert.equal((await get(B)).xp, 12121, 'yönetim düzeltmesi ölçeklenmez');
ok('bütün itibar kaynakları ölçeklenir, yönetim düzeltmesi hariç');

// Rütbe eşikleri aynı: mevcut oyuncunun rütbesi düşmez
assert.deepEqual((await db.query(`select min_xp from ranks order by id`)).rows.map(r => r.min_xp),
  [0, 100, 300, 700, 1500, 3000, 6000, 12000, 25000, 50000]);
ok('rütbe eşikleri değişmedi');

done('levels042');
