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
- [ ] Uygulama kimliği `com.omnipopgames.kabadayi` (capacitor.config.json'da şu an `app.kabadayi.oyun`; ilk yüklemeden önce)
- [x] **Hesap silme** uygulama içi (Ayarlar → Hesap → Hesabımı sil, takma adla onay; 037). [ ] Web sayfası omnipopgames.com'da (Google'ın istediği adres)
- [ ] E-postayla giriş: bağlantı yerine 6 haneli kod (uygulamada bağlantılar tarayıcıya açılıyor; e-posta tarayıcıları bağlantıyı harcıyor)
- [ ] Capacitor + Android projesi, simge/açılış, geri tuşu, güvenli alan, çevrimdışı ekranı; **AAB'de Capacitor JS çekirdeğinin olduğunu doğrula** (Snack Stack 1.0 dersi)
- [ ] Uygulama içi bildirim: FCM (Android) / APNs (iOS); sunucudaki push_queue aynı kalır, Edge Function gönderimi değişir
- [ ] Mağaza sürümünde satın alma düğmeleri: ödeme bağlanana kadar gizli (Apple "çalışmayan satın alma"yı reddeder)
- [ ] Yazı tipleri zaten pakette (www/vendor/fonts) ✓ · Supabase JS paketten ✓
- [ ] Mağaza görselleri: 1080×1920 (Play), 1206×2622 (iOS), 1024×500 tanıtım görseli; TR + EN metinler
- [ ] Play App Signing + yükleme anahtarı `D:/Omniyazilim/Anahtarlar/kabadayi-upload.jks`
- [ ] Codemagic iş akışı (WitchBrew `codemagic.yaml` şablonu), profil `kabadayi_appstore`

## Kararlar (17.11.2026)
- Mağaza adı: **Kabadayı 1922: Mafya Oyunu** (EN: "Kabadayi 1922: Mafia Game"); uygulama kimliği `com.omnipopgames.kabadayi`
- İlk sürümde gelir: **yalnız ödüllü reklam** (oyundaki "reklam izle, hızlandır", günde 8 hak); geçiş reklamı yok (bölüm yapısı yok);
  satın alma (dükkân, RevenueCat) ilk güncellemede
- Yasal metinler: **omnipopgames.com/privacy ve /terms'e Kabadayı eklenir** (sunucu, hesap, sohbet/mesaj, e-posta, bildirim, simüle kumar);
  hesap silme sayfası da sitede. Siteyi Claude yayımlar (wrangler, XDG_CONFIG_HOME=D:/Omniyazilim/Anahtarlar/wrangler-omnipop)
- Supabase: **şimdilik ücretsiz plan** (uyku riski kabul; oyuncu artınca Pro yeniden değerlendirilecek)
  - [x] Uyku önlemi: `.github/workflows/keepalive.yml` her gün `ping()` çağırır (038; anahtar gerekmez). Push sonrası Actions'ta çalışır
  - [ ] Gece yedeği (pg_dump → GitHub artifact): kullanıcı onayı bekliyor (veritabanı kopyası GitHub'a gider)

## Kullanıcının yapacakları
- [ ] Firebase: omnipop-play GCP projesine Firebase (RotaMio planıyla ortak) → Android FCM; iOS için APNs anahtarı
- [ ] AdMob: Kabadayı (Android + iOS) uygulaması ve ödüllü birim (Claude adımları verir)
- [ ] Play Console'da yeni uygulama "Kabadayı" (`com.omnipopgames.kabadayi`), App Store Connect'te uygulama kaydı

## Play Console formları (Kabadayı'ya özel cevaplar)
- Oturum açma: misafir hesapla açılır (inceleme ekibine giriş bilgisi gerekmez); e-posta isteğe bağlı
- Hesap silme adresi: (yapılacak sayfa)
- İçerik derecelendirmesi: şiddet (silahlı çatışma, metin tabanlı), simüle kumar = evet, kullanıcı etkileşimi/sohbet = evet
- Hedef kitle: 18+
- Veri güvenliği: e-posta (isteğe bağlı), takma ad, oyun içi mesajlar, oyun ilerlemesi, bildirim belirteci; hesap silinebilir
- Reklam: ilk sürüm kararına göre
