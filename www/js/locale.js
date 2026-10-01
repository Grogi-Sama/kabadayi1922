// Dil ve para birimi tek yerde: oyun ileride başka dillere açılınca burası genişletilir.
// Şimdilik sadece Türkçe dünya var. Yeni metinler mümkün olduğunca t('anahtar') ile buradan okunmalı;
// mevcut metinler zamanla buraya taşınacak (her dil = ayrı dünya/sunucu, sohbet çevirisi yok).

export const LANG = 'tr';
export const LOCALE = 'tr-TR';

// Oyun parası: "Sikke". Sembol bir görsel (ui/sikke.png); düz metin gereken yerde "sikke" kelimesi.
export const CURRENCY = { name: 'Sikke', word: 'sikke', icon: 'assets/ui/sikke.png' };

const fmtNum = (n) => Number(n).toLocaleString(LOCALE);
const COIN = `<img class="coin-ic" src="${CURRENCY.icon}" alt="" draggable="false">`;

// HTML içinde: sikke simgesi + sayı
export const money = (n) => `<span class="money">${COIN}${fmtNum(n)}</span>`;
// Düz metin (onay pencereleri vb.): "25.000 sikke"
export const moneyText = (n) => `${fmtNum(n)} ${CURRENCY.word}`;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
// Sunucu mesajları tutarları "$1234" diye yazar; ekranda sikke simgesine çevrilir.
export const richText = (s) => escHtml(s).replace(/\$(\d[\d.]*)/g, (_, d) => money(d.replace(/\./g, '')));

const STRINGS = {
  tr: {
    currency_hint: 'sikke',
  },
};
export const t = (key) => STRINGS[LANG]?.[key] ?? key;
