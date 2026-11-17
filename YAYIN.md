# Kabadayı: mağaza yayını (Google Play + App Store)

Ortak hesaplar ve yol Omnipop Games'in diğer oyunlarıyla aynıdır; yeniden açılmaz.
Kaynak rehber: `C:/Projects/WitchBrew/.claude/worktrees/priceless-sanderson-130175/YAYIN.md` (adım adım) ve
`C:/Projects/SnackStack/YAYIN.md` (Capacitor web oyunu, en benzer örnek).
Sıra: önce Android, sonra iOS (Codemagic, Mac yok).

## Hazır olanlar (diğer oyunlardan, tekrar yapılmaz)
- [x] D-U-N-S 349440056 · OMNİ MDC TEKNOLOJİ SANAYİ VE TİCARET A.Ş. · Omnipop Games
- [x] Google Play Console kurum hesabı (12 testçi / 14 gün kuralı yok), ödeme profili, vergi, satıcı beyanı
- [x] Apple Developer kurum hesabı (Team ID 8MH26H6TZL), Paid Apps Agreement, ASC API anahtarı (Codemagic)
- [x] Codemagic (iOS bulut derleme), AdMob (`pub-1839828127080159`), RevenueCat, Zoho e-posta (support@ / destek@)
- [x] omnipopgames.com (gizlilik /privacy, koşullar /terms, app-ads.txt), Cloudflare
- [x] Android araçları `D:/Omniyazilim/Dev`, anahtarlar `D:/Omniyazilim/Anahtarlar`

## Kabadayı'yı diğer oyunlardan ayıranlar (mağaza açısından)
- Sunucu var (Supabase), hesap var (misafir + e-posta), oyuncular arası sohbet ve mesaj (UGC), çok oyunculu.
- Simüle kumar (zar, rulet, slot, blackjack, piyango): Google IARC'ta "simulated gambling" = evet, Apple'da 18+.
- Oyun içinde 18+ uyarısı ve "oyun parası gerçek değere çevrilmez" metni var.

## Claude'un yapacakları (kod)
- [x] Uygulama kimliği `com.omnipopgames.kabadayi`
- [x] **Hesap silme** uygulama içi (Ayarlar → Hesap → Hesabımı sil, takma adla onay; 037). [x] Web sayfası: omnipopgames.com/kabadayi/delete-account
- [x] E-postayla giriş: bağlantı yerine 6 haneli kod (Resend SMTP, noreply@omnipopgames.com; şablonlarda {{ .Token }}) (uygulamada bağlantılar tarayıcıya açılıyor; e-posta tarayıcıları bağlantıyı harcıyor)
- [x] Capacitor 8 + Android projesi (`android/`), simge/açılış (`resources/` → `npx capacitor-assets generate --android --assetPath resources`), geri tuşu (js/native.js), güvenli alan, dikey ekran. Emülatörde (Pixel_8) denendi: canlı sunucu, yeni karakter, geri tuşu, yasal bağlantı → Chrome, hesap silme. AAB'de `vendor/capacitor.js` var ✓
  - Paket: `npm run app:sync` (www → app-www, admin paneli hariç) → `cd android && gradlew bundleRelease` (JAVA_HOME=jdk21, GRADLE_USER_HOME=D:/Omniyazilim/Dev/gradle) → `release/kabadayi-<sürüm>-code<N>.aab`. Her yüklemede versionCode artır (android/app/build.gradle)
  - İlk paket: release/kabadayi-1.0.0-code1.aab (17.11.2026, reklamsız, bildirimsiz)
- [ ] Uygulama içi bildirim: FCM (Android) / APNs (iOS); sunucudaki push_queue aynı kalır, Edge Function gönderimi değişir
- [x] Mağaza sürümünde satın alma düğmeleri gizli ("Yakında"), Web Push kapalı ("çok yakında")
- [ ] Yazı tipleri zaten pakette (www/vendor/fonts) ✓ · Supabase JS paketten ✓
- [ ] Mağaza görselleri: 1080×1920 (Play), 1206×2622 (iOS), 1024×500 tanıtım görseli; TR + EN metinler
- [x] Yükleme anahtarı `D:/Omniyazilim/Anahtarlar/kabadayi-upload.jks` + `.properties` (gradle.properties'te `kabadayi.signing`); **yedeğini al**. Play App Signing açık kalır
- [ ] Codemagic iş akışı (WitchBrew `codemagic.yaml` şablonu), profil `kabadayi_appstore`

## Kararlar (17.11.2026)
- Mağaza adı: **Kabadayı 1922: Mafya Oyunu** (EN: "Kabadayi 1922: Mafia Game"); uygulama kimliği `com.omnipopgames.kabadayi`
- İlk sürümde gelir: **yalnız ödüllü reklam** (oyundaki "reklam izle, hızlandır", günde 8 hak); geçiş reklamı yok (bölüm yapısı yok);
  satın alma (dükkân, RevenueCat) ilk güncellemede
- Yasal metinler: **omnipopgames.com/kabadayi/ (privacy, terms, kvkk, delete-account) — yayında**; genel /privacy ve /terms buraya bağlanır; oyundaki bağlantılar da buraya (sunucu, hesap, sohbet/mesaj, e-posta, bildirim, simüle kumar);
  hesap silme sayfası da sitede. Siteyi Claude yayımlar (wrangler, XDG_CONFIG_HOME=D:/Omniyazilim/Anahtarlar/wrangler-omnipop)
- Supabase: **şimdilik ücretsiz plan** (uyku riski kabul; oyuncu artınca Pro yeniden değerlendirilecek)
  - [x] Uyku önlemi: `.github/workflows/keepalive.yml` her gün `ping()` çağırır (038; anahtar gerekmez). Push sonrası Actions'ta çalışır
  - [ ] Gece yedeği (pg_dump → GitHub artifact): şimdilik yapılmıyor (kullanıcı kararı; veritabanı kopyası GitHub'a giderdi)
- Web sürümü (GitHub Pages) **Google Play'de yayına girene kadar açık**, sonra kapatılır. Kapatmadan önce oyunculara
  "Ayarlar → Hesap'tan e-postanı bağla" duyurusu (tarayıcıdaki misafir karakter uygulamaya kendiliğinden geçmez)
- Mağaza sürümünden sonra: ekran (www) değişiklikleri yeni uygulama sürümü ister; sunucu (SQL) değişiklikleri eski
  uygulama sürümlerini bozmamalı (RPC adı/argümanı silinmez, yenisi eklenir)

## Kullanıcının yapacakları
- [ ] Firebase: omnipop-play GCP projesine Firebase (RotaMio planıyla ortak) → Android FCM; iOS için APNs anahtarı
- [ ] AdMob: Kabadayı (Android + iOS) uygulaması ve ödüllü birim (Claude adımları verir)
- [ ] Play Console'da yeni uygulama "Kabadayı" (`com.omnipopgames.kabadayi`), App Store Connect'te uygulama kaydı

## Play Console formları (Kabadayı'ya özel cevaplar)
- Oturum açma: misafir hesapla açılır (inceleme ekibine giriş bilgisi gerekmez); e-posta isteğe bağlı
- Hesap silme adresi: https://omnipopgames.com/kabadayi/delete-account
- Gizlilik: https://omnipopgames.com/kabadayi/privacy · Koşullar: https://omnipopgames.com/kabadayi/terms · KVKK: /kabadayi/kvkk
- İçerik derecelendirmesi: şiddet (silahlı çatışma, metin tabanlı), simüle kumar = evet, kullanıcı etkileşimi/sohbet = evet
- Hedef kitle: 18+
- Veri güvenliği: e-posta (isteğe bağlı), takma ad, oyun içi mesajlar, oyun ilerlemesi, bildirim belirteci; hesap silinebilir
- Reklam: ilk sürüm kararına göre
