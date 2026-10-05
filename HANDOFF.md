# Devir Notu — Kabadayı (2026-09-29)

## Proje
Mobil metin tabanlı mafya MMO, Barafranca Omerta'dan esinlenme (isim/metin/görsel kopyalanmaz). 1920'ler İstanbul/Doğu Akdeniz, Men-i Müskirat (içki yasağı) teması. Kararlar ve Omerta özellik tablosu: `PLAN.md`.

- **Kalıcı ölüm yok** (öldürülen: cebindeki paranın %25'i + kurşunların %50'si gider, 45 dk hastane).
- **Gelir sadece ödüllü reklam, pay-to-win yok.** Lackeys (ücretli otomasyon) bilerek yok.
- **Teknoloji:** HTML/JS (`www/`) → ileride Capacitor. Sunucu: Supabase (henüz hesap yok). Bütün kurallar sunucu tarafı SQL RPC'lerinde.

## Durum
- `supabase/migrations/001–019`: çekirdek, savaş, aile, ekip işleri, kumarhane/ulaşım, sosyal (mesaj/engel/şikâyet/küfür filtresi/saygı), mekânlar/baskın, 8 kişilik vurgun + yarış, piyango/blackjack/pazar/evlilik/sığınak, admin + sezonlar, portre, sohbet (genel + şehir; 012), yetki kademeleri sahip/moderatör (013), ayrıntılı küfür filtresi + takma ad kuralları (014), aile armaları (015), tablo kilidi: RLS + istemciye tablo yetkisi yok (016), ceza itirazı (017), etkinlikler: planlı takvim + sürpriz zar (018), topluluk: arkadaşlık + sadece arkadaşlara özel mesaj, öneri kutusu, şikâyet/itirazda sohbet bağlamı (019). Para birimi şimdilik $ (dil/para tek yerde: www/js/locale.js; sikke simgesi art/kullanilmayan/). Adminin (role='owner') araçları panelde sadece localhost'ta görünür.
- Omerta'daki bütün özellikler var (tablo PLAN.md'de).
- Arayüz: art-deco tema, şehir haritası (binaya dokun → alt panel), sekmeler Şehir · İşler · Aile · Sohbet · Defter. Admin paneli `www/admin.html` (sadece `admins` tablosundakiler).
- Testler: `npm test` → 17 dosya, 104 test grubu, hepsi geçiyor (PGlite, Supabase gerekmez).
- Git: `origin` = https://github.com/Grogi-Sama/kabadayi1922 (private), dal `main`. **Kullanıcı açıkça "al"/"push edelim" demeden push yok.**

## Nasıl çalıştırılır
- Geliştirme sunucusu: `.claude/launch.json` → `mafia-dev` (port 5180), adres `http://localhost:5180/www/`.
- Yerel mod: `www/js/config.js` boşken aynı SQL tarayıcıda (PGlite) çalışır; `supabase/local-seed.sql` sahte oyuncular + örnek şikâyet ekler; yerel oyuncu sadece localhost'ta sahiptir (GitHub Pages'te kimse yetkili değil). Konsolda `devApi.sql(...)` + `devRefresh()` ile test.
- SQL değişince yerel veritabanı kendini sıfırlar.

## Kurallar / alışkanlıklar
- Yeni RPC: migration'da `insert into api_rpcs values ('fn(tipler)'); select apply_grants();`
- `get_state` her migration'da yeniden adlandırılıp sarılıyor (`state_xxx`).
- Hiçbir şey canlıya çıkmadığı için eski migration dosyaları düzenlenebilir.
- Türkçe mesajlarda takma ada/şehre ek getirme (`'e`, `'de` → yanlış ünlü uyumu); cümleyi eksiz kur.
- Kullanıcı oyun geliştirmeyi yeni öğreniyor: belirsiz işlerde önce seçenek + öneri sun.
- Görseller: tüm promptları tek seferde ver; saydamlık gerekiyorsa kullanıcıdan hazır saydam PNG iste (kendi arka plan silme hattı kurma); 3D perspektif yok.

## Durum (2026-10-05) — proje rafa kalkıyor
**Canlı:** Supabase https://egabjhoezsnrwoemgrhn.supabase.co (Frankfurt, ücretsiz). 001–029 yüklü. İstemci GitHub Pages: https://grogi-sama.github.io/kabadayi1922/ (son push 029 ile uyumlu).

**Bekleyen (yerelde commit'li, canlıda DEĞİL):** 030–033 (033: Duyurular — Yönetim paneli → Duyurular sekmesinden yazılır, oyuncular Defter → Duyurular'da görür); 030 (hapiste para/mal hareketi yok, baskın önizlemesi, bildirim yoklaması) ve 031 (infaz önizlemesi, en zenginler) + bunlara bağlı istemci + hesap koruma (e-posta bağlama).
Sıra: `python tools/build_deploy_sql.py 030` → `supabase/deploy_030.sql` SQL Editor'de bir kez → sonra `git push`. İstemciyi SQL'den önce push etme (yeni RPC'leri çağırıyor).
Hesap koruma için Supabase'de: Authentication → URL Configuration → Site URL `https://grogi-sama.github.io/kabadayi1922/www/` (+ Redirect URLs'e aynısı ve http://localhost:5180/www/). E-posta sağlayıcı açık olmalı (varsayılan). Varsayılan Supabase SMTP saatte birkaç e-posta gönderir; oyuncu artınca özel SMTP gerekir.

**Bildirimler (032):** SQL'den sonra: (1) Edge Functions → yeni fonksiyon `push`, kodu `supabase/functions/push/index.ts`, "Verify JWT" kapalı; (2) fonksiyon sırları: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET` (değerler `supabase/.secrets/push.json`, repoda yok), `VAPID_SUBJECT=mailto:…`; (3) `supabase/push_setup.sql` içindeki `<CRON_SECRET>` doldurulup SQL Editor'de çalıştırılır (pg_cron + pg_net). iPhone'da web bildirimi için oyun Ana Ekrana eklenmeli.
**Yasal metinler:** `www/gizlilik.html`, `kvkk.html`, `kullanim.html` — [VERİ SORUMLUSU ADI], [ADRES], [İLETİŞİM E-POSTASI] doldurulmalı, hukukçuya kontrol ettirilmeli.
**Mağaza:** `MAGAZA.md` (Capacitor, Steam/Electron, ödeme, AdMob adımları), `capacitor.config.json` hazır.

**Kurallar:** Canlıdaki migration dosyaları değiştirilmez; her değişiklik yeni dosya (032, …) ve mümkünse tekrar çalıştırılabilir (`do $$ … if not exists (pg_proc) then rename …`). Yerelde sunucuya dokunmadan deneme: http://localhost:5180/www/?yerel . Test: `npm test` (22 dosya).

**Yapılmayanlar (gelecek iş):**
1. Telefon uygulaması: Capacitor paketleme, Google Play / App Store hesapları, mağaza görselleri, yaş derecelendirmesi (simüle kumar → Apple 16+/18+, IARC'ta "simulated gambling" işaretlenir).
2. Ödeme: mağaza ödemesi (Play Billing / StoreKit) + makbuzu sunucuda doğrulayıp `grant_product()` çağıran Edge Function. Şimdilik fiyat düğmeleri "yakında".
3. Reklam: AdMob ödüllü reklam + sunucu taraflı doğrulama (SSV) → `ads_enabled = 1`. AdMob'da kumar reklam kategorisi kapatılmalı.
4. Push bildirimleri (bekleme bitti, baskın, mesaj).
5. Gizlilik politikası / KVKK aydınlatma metni ve kullanım şartları (mağazalar ister).
6. Denge ayarları gerçek oyuncu verisiyle (`game_settings` tablosu; kod değiştirmeden).
7. Kumar: oyun parası gerçek parayla satılmaz, gerçek paraya çevrilmez — bu kural korunmalı (yasal risk). Oyuncular arası gerçek para ticareti yasaklanmalı (kullanım şartlarına yaz).
