// Görseller: açılışta hangileri gerçekten var bir kez kontrol edilir.
// Olmayan görselin yerine geçici çizim/emoji gösterilir; dosya klasöre konunca kendiliğinden kullanılır.

const CITIES = ['istanbul', 'izmir', 'selanik', 'pire', 'iskenderiye', 'beyrut'];
const BUILDINGS = ['gazino', 'meyhane', 'kahvehane', 'antrepo', 'karakol', 'hastane', 'banka', 'fabrika',
  'silahci', 'dedektif', 'garaj', 'carsi'];
const ITEMS = ['w_tabanca', 'w_pompali', 'w_thompson', 'c_kamyonet', 'c_taksi', 'c_aile', 'c_spor', 'c_sedan', 'c_limuzin',
  'g_kahve', 'g_tutun', 'g_sarap', 'g_raki', 'g_konyak', 'g_viski', 't_vapur', 't_motorbot', 't_deniz_ucagi'];
const JOBS = ['cep', 'dukkan', 'kumarhane', 'liman', 'kuyumcu', 'banka', 'soygun', 'organize', 'buyuk'];
const RESULTS = ['basari', 'hapis', 'kacti', 'vuruldu', 'yaris'];

export const ALL = [
  ...CITIES.map(c => `bg/${c}`), ...BUILDINGS.map(b => `buildings/${b}`),
  ...Array.from({ length: 8 }, (_, i) => `portraits/p${i + 1}`),
  ...ITEMS.map(i => `items/${i}`), ...JOBS.map(j => `jobs/${j}`), ...RESULTS.map(r => `results/${r}`),
  'ui/splash', 'ui/emblem',
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
