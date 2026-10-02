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

## Sıradaki adımlar
1. **Görseller** (`ASSET_PROMPTS.md`, 60 görsel / 26 üretim): küçükler (bina, eşya, portre) 4 toplu ızgara sayfası olarak `art/sheets/` altına gelir → `python tools/slice_all.py` keser, `www/assets/` altına koyar (bina sayfası kullanıcıdan saydam gelir; betik saydamlık üretmez). Stil çapası: `bg/istanbul` + binalar sayfası + portreler sayfası → tutarlılığı kontrol et, sonra kalanı. Görsel klasöre konunca kod otomatik kullanır (`www/js/assets.js`). Harita artık ızgara: sokak sıraları `STREETS` (app.js), binalar üst üste binmez; arka plan görseli istenirse `bg/<şehir>.png` (opsiyonel). Yatay kaydırmalı panorama denendi, kullanıcı beğenmedi (panorama `art/panorama/`).
2. **Supabase:** kurulum dosyası `python tools/build_deploy_sql.py` → `supabase/deploy.sql` (SQL Editor'e bir kez yapıştırılır). kullanıcı hesap açıp Project URL + anon key verecek → `config.js`, migration'ları çalıştır, Anonymous sign-in aç, admin UID'sini `admins`'e ekle (PLAN.md'de adımlar). `local-shim.sql` ve `local-seed.sql` canlıda ÇALIŞTIRILMAZ.
3. Sonra: Capacitor paketleme, push bildirimleri, AdMob ödüllü reklam + sunucu doğrulaması, denge ayarları.

## Canlı sunucu (2026-10-01'den beri)
- Supabase: https://egabjhoezsnrwoemgrhn.supabase.co — 001–019 yüklü. **Eski migration dosyaları artık değiştirilmez**; her değişiklik yeni dosya (020, 021, …).
- Güncelleme: `python tools/build_deploy_sql.py 020` → `supabase/deploy_020.sql` (020 ve sonrası) → SQL Editor'de yeni sorguya yapıştır → Run. Sonra istemci push edilir (istemci yeni SQL'e bağlı).
- Yerelde sunucuya dokunmadan deneme: http://localhost:5180/www/?yerel
- 020: işe özel bekleme, tecrübeyle artan şans, liman alış/satış farkı, pahalı mallar, gümrük yarısı. 021: adamlar (Kahvehane; zorba/fedai/gözcü/nişancı, eğitim, haftalık maaş, nöbet, baskın gücü/kayıpları, güç sıralaması).
