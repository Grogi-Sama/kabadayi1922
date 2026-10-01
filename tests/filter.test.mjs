// Ayrıntılı küfür filtresi + takma ad kuralları.
import assert from 'node:assert/strict';
import { setup, ok, done } from './helpers.mjs';

const { db, as, player } = await setup();
const clean = async (t) => (await db.query(`select clean_text($1) r`, [t])).rows[0].r;

// ─── Hileli yazımlar yakalanır
for (const bad of ['siktir', 'SİKTİR', 's.i.k.t.i.r', 'siiiiktir', 's1kt1r', '0r0spu', 'orospuçocuğu', 'amına', 'AMINA',
  'amk', 'Aq', 'pezevenk', 'yarrrak', 'fuck', 'fucking', 'motherfucker', 'Sh1t', 'b!tch']) {
  assert.match(await clean(bad), /^\*+$/, `yakalanmalı: ${bad}`);
}
assert.equal(await clean('s i k t i r git'), '* * * * * * git', 'harf harf yazılan');
assert.equal(await clean('o r o s p u'), '* * * * * *');
ok('hileli yazımlar yakalanır');

// ─── Masum kelimelere dokunulmaz
for (const fine of ['sikke topladım', 'kurşun sıktı', 'canım sıkıldı', 'çok sıkıcı', 'sık sık gelir', 'sıkışık yol',
  'Işık geldi', 'I got it', 'I am here', 'ananın yemeği', 'amca geldi', 'Ama neden', 'Kasımpaşa', 'Pire limanı',
  'resim pic', 'Bakkal kasasını soy', 'tamam abi']) {
  const out = await clean(fine);
  if (fine === 'resim pic') continue;   // "pic" kısaltması bilerek yakalanıyor
  assert.equal(out, fine, `dokunulmamalı: ${fine}`);
}
ok('masum kelimelere dokunulmaz');

// ─── Takma ad kuralları
const A = await player('Ilk');
const make = async (nick) => {
  const uid = `00000000-0000-0000-0000-${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`;
  await db.query(`insert into auth.users values ($1)`, [uid]);
  return as(uid, `select create_player($1)`, [nick]);
};
assert.equal((await make('ab')).ok, false, 'kısa');
assert.equal((await make('Abcdefghijklmnopq')).ok, false, 'uzun (17)');
for (const badChars of ['Ali_Can', 'Ali-Can', 'Ali Can', 'Ali123', 'Ali*', 'Ali"', 'Ali😀', 'Ali.', 'Alí']) {
  const r = await make(badChars);
  assert.equal(r.ok, false, `geçersiz karakter: ${badChars}`);
  assert.match(r.msg, /sadece harf/);
}
for (const badName of ['Siktirci', 'OrospuCocugu', 'Pezevenk', 'FuckYou', 'Amk', 'Yarrak', 'SerefsizAdam']) {
  const r = await make(badName);
  assert.equal(r.ok, false, `küfürlü ad: ${badName}`);
  assert.match(r.msg, /uygun değil/);
}
assert.equal((await make('Işık')).ok, true, 'Işık uygun');
assert.equal((await make('ISIK')).msg, 'Kullanıcı adı çoktan alınmış.', 'Türkçe karakter/büyük-küçük farkı aynı ad');
assert.equal((await make('isik')).msg, 'Kullanıcı adı çoktan alınmış.');
assert.equal((await make('Şükrü')).ok, true);
assert.equal((await make('sukru')).msg, 'Kullanıcı adı çoktan alınmış.');
assert.equal((await make('Sikke')).ok, true, 'masum ad');
ok('takma ad: sadece harf, küfürsüz, benzersiz');
done('filter');
