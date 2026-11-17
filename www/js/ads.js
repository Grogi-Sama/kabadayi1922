// Ödüllü reklam (yalnızca mağaza uygulamasında; Google AdMob). Web sürümünde reklam yok.
// Uygulama kimliği android/app/src/main/AndroidManifest.xml'de yazılı.
// İzin: AB/İngiltere/İsviçre'de Google'ın izin formu (UMP) sorulur; başka ülkelerde kişiselleştirilmemiş
// reklam (npa) istenir — gizlilik politikası "izin olmadan kişiselleştirme yok" diyor.
import { NATIVE, PLATFORM } from './native.js';

const USE_TEST_ADS = false;   // true: Google'ın test reklamları (para kazandırmaz)
const UNITS = {
  test: { android: 'ca-app-pub-3940256099942544/5224354917', ios: 'ca-app-pub-3940256099942544/1712485313' },
  prod: { android: 'ca-app-pub-1839828127080159/2391134588', ios: '' },
};

const Cap = window.Capacitor;
const AdMob = NATIVE ? Cap.registerPlugin('AdMob') : null;
const unit = NATIVE ? UNITS[USE_TEST_ADS ? 'test' : 'prod'][PLATFORM] : '';
let ready = false, loaded = false, loading = false, privacyRequired = false;

export const adsAvailable = () => !!AdMob && !!unit;
export const adsPrivacyRequired = () => privacyRequired;
export const showAdsPrivacy = () => AdMob?.showPrivacyOptionsForm().catch(() => {});

// Açılışta bir kez: SDK + izin formu, sonra ilk reklamı önceden yükle. Hata olsa da oyunu bekletmez.
export async function initAds() {
  if (!adsAvailable()) return;
  try {
    await AdMob.initialize({});
    const info = await AdMob.requestConsentInfo();
    privacyRequired = info?.privacyOptionsRequirementStatus === 'REQUIRED';
    if (info && !info.canRequestAds && info.isConsentFormAvailable) await AdMob.showConsentForm();
  } catch {}
  ready = true;
  preload();
}

function preload() {
  if (!ready || loaded || loading) return;
  loading = true;
  AdMob.prepareRewardVideoAd({ adId: unit, npa: !privacyRequired })
    .then(() => { loaded = true; })
    .catch(() => setTimeout(preload, 30000))   // ağ yoksa / reklam yoksa 30 sn sonra tekrar
    .finally(() => { loading = false; });
}

// Reklamı gösterir; true: sonuna kadar izlendi (ödül hak edildi), false: reklam yok ya da yarıda kapatıldı.
export function showRewarded() {
  return new Promise((resolve) => {
    if (!ready || !loaded) { preload(); return resolve(false); }
    loaded = false;
    let earned = false, done = false;
    const handles = [];
    const finish = () => {
      if (done) return; done = true;
      handles.forEach(h => h.remove());
      resolve(earned); preload();
    };
    const on = (ev, fn) => AdMob.addListener(ev, fn).then(h => (done ? h.remove() : handles.push(h)));
    on('onRewardedVideoAdReward', () => { earned = true; });
    on('onRewardedVideoAdDismissed', finish);
    on('onRewardedVideoAdFailedToShow', finish);
    AdMob.showRewardVideoAd().catch(finish);
  });
}
