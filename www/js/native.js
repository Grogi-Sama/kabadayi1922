// Telefon mağazası sürümü (Capacitor). Tarayıcıda hiçbir şey yapmaz.
// Capacitor çekirdeği vendor/capacitor.js'ten gelir (index.html); yoksa eklentiler çalışmaz (Snack Stack 1.0 dersi).
const Cap = window.Capacitor;
export const NATIVE = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
export const PLATFORM = NATIVE ? Cap.getPlatform() : 'web';

// Android geri tuşu: onBack() true dönerse oyun içinde bir adım geri gidildi; false ise uygulama arka plana alınır.
export function initNative({ onBack }) {
  if (!NATIVE) return;
  document.documentElement.classList.add('native', 'native-' + PLATFORM);
  const App = Cap.registerPlugin('App');
  App.addListener('backButton', () => { if (!onBack()) App.minimizeApp(); });
}
