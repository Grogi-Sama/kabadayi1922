// Görseller: açılışta hangileri gerçekten var bir kez kontrol edilir.
// Olmayan görselin yerine geçici çizim/emoji gösterilir; dosya klasöre konunca kendiliğinden kullanılır.

const CITIES = ['istanbul', 'izmir', 'selanik', 'pire', 'iskenderiye', 'beyrut'];
const BUILDINGS = ['gazino', 'meyhane', 'kahvehane', 'antrepo', 'karakol', 'hastane', 'banka', 'fabrika',
  'silahci', 'dedektif', 'garaj', 'carsi', 'siginak'];
const ITEMS = ['w_tabanca', 'w_pompali', 'w_thompson', 'c_kamyonet', 'c_taksi', 'c_aile', 'c_spor', 'c_sedan', 'c_limuzin',
  'g_kahve', 'g_tutun', 'g_sarap', 'g_raki', 'g_konyak', 'g_viski', 'g_hali', 'g_mucevher', 'g_silah_parca', 't_vapur', 't_motorbot', 't_deniz_ucagi'];
const JOBS = ['cep', 'dukkan', 'kumarhane', 'liman', 'kuyumcu', 'banka', 'soygun', 'organize', 'buyuk'];
const DECOR = ['sarmasik', 'afis', 'kasa', 'fici', 'boyaci', 'incir', 'kedi'];
const ICONS = ['lider', 'sofor', 'silahci', 'patlayici', 'sehir', 'isler', 'aile', 'defter', 'can', 'kursun', 'banka',
  'kilit', 'kum', 'uye', 'fabrika', 'mekan', 'sohbet', 'kalkan', 'tabut', 'yuzuk', 'engel', 'bayrak'];
const RESULTS = ['basari', 'hapis', 'kacti', 'vuruldu', 'yaris', 'gumruk'];

export const ALL = [
  ...CITIES.map(c => `bg/${c}`), ...CITIES.map(c => `harbor/${c}`), 'tex/kaldirim', 'tex/duvar', ...DECOR.map(d => `decor/${d}`), ...ICONS.map(i => `ico/${i}`), ...Array.from({ length: 8 }, (_, i) => `crests/c${i + 1}`),
  ...['rulet', 'zar1', 'zar6', 'kart', 'fis_bordo', 'fis_teal', 'fis_siyah', 'slot', 's_fes', 's_raki', 's_sikke', 's_tespih'].map(c => `casino/${c}`),
  ...['kitlik', 'altin_saat', 'baskin_gecesi', 'kelle_haftasi', 'fabrika_kazasi', 'polis_baskini', 'liman_firtinasi'].map(e => `events/${e}`), ...BUILDINGS.map(b => `buildings/${b}`),
  ...Array.from({ length: 8 }, (_, i) => `portraits/p${i + 1}`),
  ...ITEMS.map(i => `items/${i}`), ...JOBS.map(j => `jobs/${j}`), ...RESULTS.map(r => `results/${r}`),
  'ui/splash', 'ui/emblem', 'ui/isler_bant', 'ui/aile_bant', 'ui/defter_bant', 'ui/logo', 'ui/kumar_bant', 'ui/rehber_bant',
  ...'basla rutbe suc araba liman silah olum kelle banka aile mekan ekip kumar sohbet etkinlik sezon'.split(' ').map(n => `rehber/${n}`),
];

const have = new Set();

export function probeAssets() {
  return Promise.all(ALL.map(name => new Promise(res => {
    const im = new Image();
    im.onload = () => { have.add(name); res(); };
    im.onerror = () => res();
    im.src = `assets/${name}.png`;
  })));
}

export const hasAsset = (name) => have.has(name);
export const assetUrl = (name) => `assets/${name}.png`;

// Görsel varsa <img>, yoksa verilen yedek HTML
export function img(name, cls = '', fallback = '') {
  return have.has(name) ? `<img class="${cls}" src="assets/${name}.png" alt="" draggable="false">` : fallback;
}

// Küçük simge: görsel varsa <img class="ico">, yoksa emoji
export const ico = (name, emoji) => have.has('ico/' + name)
  ? `<img class="ico" src="assets/ico/${name}.png" alt="${emoji}" draggable="false">` : emoji;
