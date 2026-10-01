// Dil ve para birimi tek yerde: oyun ileride başka dillere açılınca burası genişletilir.
// Şimdilik sadece Türkçe dünya var. Yeni metinler mümkün olduğunca t('anahtar') ile buradan okunmalı;
// mevcut metinler zamanla buraya taşınacak (her dil = ayrı dünya/sunucu, sohbet çevirisi yok).

export const LANG = 'tr';
export const LOCALE = 'tr-TR';

// Oyun parası: şimdilik $ (oyuna özel sikke simgesi ileride buraya gelecek: CURRENCY.icon).
export const CURRENCY = { name: 'Dolar', symbol: '$', icon: null };

const fmtNum = (n) => Number(n).toLocaleString(LOCALE);

// HTML içinde ve düz metinde aynı: "$25.000"
export const money = (n) => `${CURRENCY.symbol}${fmtNum(n)}`;
export const moneyText = money;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
// Sunucu mesajları tutarları "$1234" diye yazar; ekranda binlik ayraçla gösterilir ("$1.234").
export const richText = (s) => escHtml(s).replace(/\$(\d+)(?![\d.])/g, (_, d) => money(d));

const STRINGS = {
  tr: {},
};
export const t = (key) => STRINGS[LANG]?.[key] ?? key;
