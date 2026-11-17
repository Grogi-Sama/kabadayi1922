// Mağaza uygulaması için web dosyalarını app-www/ klasörüne hazırlar (Capacitor webDir).
// www/ olduğu gibi kopyalanır; yönetim paneli ve web'e özel dosyalar pakete girmez.
// Kullanım: npm run app:sync   (build + npx cap sync)
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'www'), out = path.join(root, 'app-www');
const SKIP = new Set(['admin.html', 'js/admin.js', 'sw.js', 'manifest.webmanifest']);

async function copy(rel) {
  if (SKIP.has(rel.split(path.sep).join('/'))) return;
  const from = path.join(src, rel), to = path.join(out, rel);
  if ((await fs.stat(from)).isDirectory()) {
    await fs.mkdir(to, { recursive: true });
    for (const n of await fs.readdir(from)) await copy(path.join(rel, n));
  } else await fs.copyFile(from, to);
}
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
for (const n of await fs.readdir(src)) await copy(n);

// Paket güvenliği: bunlar eksikse uygulama sessizce bozuk çıkar
const must = ['index.html', 'vendor/capacitor.js', 'vendor/supabase.js', 'js/native.js', 'js/config.js'];
const miss = [];
for (const f of must) await fs.access(path.join(out, f)).catch(() => miss.push(f));
const html = await fs.readFile(path.join(out, 'index.html'), 'utf8');
if (!html.includes('vendor/capacitor.js')) miss.push('index.html → vendor/capacitor.js etiketi');
const cfg = await fs.readFile(path.join(out, 'js/config.js'), 'utf8');
if (!/SUPABASE_URL = 'https:/.test(cfg)) miss.push('config.js → SUPABASE_URL');
const core = JSON.parse(await fs.readFile(path.join(root, 'node_modules/@capacitor/core/package.json'), 'utf8')).version;
const vend = await fs.readFile(path.join(out, 'vendor/capacitor.js'), 'utf8');
if (miss.length) { console.error('❌ Paket eksik:\n  ' + miss.join('\n  ')); process.exit(1); }
console.log(`app-www/ hazır (Capacitor çekirdeği ${core}; vendor/capacitor.js ${Math.round(vend.length / 1024)} KB — çekirdek güncellenince yeniden kopyala)`);
