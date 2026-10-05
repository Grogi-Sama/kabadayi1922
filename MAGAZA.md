# Mağazalara çıkış (App Store, Google Play, Steam)

Oyun tek bir web kod tabanıdır (`www/`). Mağaza sürümleri bu kodu paketler; oyunu ayrıca yazmak gerekmez.
Ekran ölçeklemesi hazır: telefon tam ekran, tablet/bilgisayar ortada uygulama çerçevesi (style.css "Cihaza göre ölçek").
PWA hazır: `manifest.webmanifest`, `sw.js`, `icon-192/512.png` → tarayıcıdan "Ana Ekrana Ekle" ile uygulama gibi çalışır.

## Bekleyen hesaplar
- D-U-N-S numarası (başvuru yapıldı) → Apple Developer Program (yıllık ücret) ve Google Play Console (tek seferlik ücret) kurumsal hesap.
- AdMob hesabı (ödüllü reklam), Steamworks (Steam Direct ücreti).

## 1) Android ve iOS (Capacitor)
Yapılandırma hazır: `capacitor.config.json` (appId `app.kabadayi.oyun` — mağazaya ilk yüklemeden önce kesinleştir, sonra değişmez).
```
npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios @capacitor/push-notifications @capacitor/splash-screen
npx cap add android      # Android Studio gerekir
npx cap add ios          # macOS + Xcode gerekir
npx cap sync
```
- Simgeler/açılış: `www/assets/ui/app_icon.png` (1024) ve `splash.png` → `npx @capacitor/assets generate`.
- Bildirim: uygulamada Web Push yerine yerel bildirim (FCM / APNs) kullanılır. Sunucu kuyruğu (`push_queue`) aynı kalır; Edge Function'a FCM gönderimi eklenir. iOS için APNs anahtarı (Apple hesabı) gerekir.
- Ödeme: `@revenuecat/purchases-capacitor` ya da mağazaların kendi eklentileri. Makbuz sunucuda doğrulanır (Edge Function) → `grant_product(oyuncu, ürün, 'store', makbuz)`. Ürün kimlikleri `products` tablosundakilerle aynı olmalı.
- Reklam: `@capacitor-community/admob` ödüllü reklam + sunucu taraflı doğrulama (SSV) → doğrulanınca `use_boost(..., 'ad')`, `game_settings.ads_enabled = 1`. AdMob'da kumar reklam kategorisini kapat.
- Yaş derecesi: simüle kumar var → App Store'da 16+/18+, Google Play IARC anketinde "simulated gambling" evet.
- Mağaza sayfası: Gizlilik Politikası adresi `.../www/gizlilik.html`; veri güvenliği formunda Gizlilik Politikası'ndaki veri listesini kullan.

## 2) Steam (masaüstü)
Web kodu Electron ya da Tauri ile Windows/macOS/Linux uygulaması olarak paketlenir:
```
npm i -D electron electron-builder
```
- Küçük bir `electron/main.js` `www/index.html`'i tam ekran pencerede açar; bilgisayar görünümü (720 px çerçeve) zaten var.
- Steam başarımları / bulut kaydı için `steamworks.js` (isteğe bağlı). Steam'de ödeme Steam üzerinden olmalı (mağaza kuralları).
- Masaüstünde bildirim: Electron'un kendi bildirimleri.

## 3) Her mağazada aynı kalan
- Sunucu (Supabase), oyun kuralları, hesaplar: tek dünya, tüm platformlar aynı sunucuya bağlanır.
- Hesap koruma (e-posta) platform değiştirmede karakteri taşır.
