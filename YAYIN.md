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
- [ ] **Hesap silme**: uygulama içi (Ayarlar → Hesap) + web sayfası (Google'ın istediği adres). İki mağaza da zorunlu tutuyor
- [ ] E-postayla giriş: bağlantı yerine 6 haneli kod (uygulamada bağlantılar tarayıcıya açılıyor; e-posta tarayıcıları bağlantıyı harcıyor)
- [ ] Capacitor + Android projesi, simge/açılış, geri tuşu, güvenli alan, çevrimdışı ekranı; **AAB'de Capacitor JS çekirdeğinin olduğunu doğrula** (Snack Stack 1.0 dersi)
- [ ] Uygulama içi bildirim: FCM (Android) / APNs (iOS); sunucudaki push_queue aynı kalır, Edge Function gönderimi değişir
- [ ] Mağaza sürümünde satın alma düğmeleri: ödeme bağlanana kadar gizli (Apple "çalışmayan satın alma"yı reddeder)
- [ ] Yazı tipleri zaten pakette (www/vendor/fonts) ✓ · Supabase JS paketten ✓
- [ ] Mağaza görselleri: 1080×1920 (Play), 1206×2622 (iOS), 1024×500 tanıtım görseli; TR + EN metinler
- [ ] Play App Signing + yükleme anahtarı `D:/Omniyazilim/Anahtarlar/kabadayi-upload.jks`
- [ ] Codemagic iş akışı (WitchBrew `codemagic.yaml` şablonu), profil `kabadayi_appstore`

## Kullanıcının yapacakları / kararları
- [ ] Mağaza adı (TR/EN) — ad müsait mi bakılacak
- [ ] İlk sürümde gelir: reklamsız/ödemesiz mi, ödüllü reklamla mı
- [ ] Supabase Pro (ücretsiz plan hareketsiz projeyi uyutur, yedek yok)
- [ ] Yasal metinler: oyundaki gizlilik/koşullar mı, omnipopgames.com/privacy + /terms'e mi eklensin
- [ ] Firebase projesi (bildirim için FCM)
- [ ] Play Console'da yeni uygulama "Kabadayı" (`com.omnipopgames.kabadayi`), App Store Connect'te uygulama kaydı

## Play Console formları (Kabadayı'ya özel cevaplar)
- Oturum açma: misafir hesapla açılır (inceleme ekibine giriş bilgisi gerekmez); e-posta isteğe bağlı
- Hesap silme adresi: (yapılacak sayfa)
- İçerik derecelendirmesi: şiddet (silahlı çatışma, metin tabanlı), simüle kumar = evet, kullanıcı etkileşimi/sohbet = evet
- Hedef kitle: 18+
- Veri güvenliği: e-posta (isteğe bağlı), takma ad, oyun içi mesajlar, oyun ilerlemesi, bildirim belirteci; hesap silinebilir
- Reklam: ilk sürüm kararına göre
