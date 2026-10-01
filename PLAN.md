# Kabadayı (çalışma adı) — Mobil Metin Tabanlı Mafya MMO

Esin kaynağı: Barafranca Omerta (2003). İsim, metin ve görsel **kopyalanmaz**; sadece tür/sistem fikri.

## Kararlar (2026-09-28)
- **Tema:** 1920'ler İstanbul / Doğu Akdeniz. Tarihî kanca: 1920–1924 *Men-i Müskirat* (içki yasağı) → kaçak içki ekonomisi.
- **Şehirler:** İstanbul, İzmir, Selanik, Pire, İskenderiye, Beyrut.
- **Mallar:** Rakı, şarap, konyak, viski, kaçak tütün, kahve. *Uyuşturucu yok* (mağaza onayı için).
- **Ölüm:** Kalıcı ölüm yok. Öldürülen oyuncu nakitinin ve kurşunlarının bir kısmını kaybeder, kısa süre hastanede kalır, rütbesi durur.
- **Gelir:** Sadece reklam (ödüllü reklam). **Pay-to-win yok, satın alma yok.**
- **Teknoloji:** HTML/JS arayüz → Capacitor ile iOS/Android. Sunucu: Supabase (Postgres + Auth + RPC fonksiyonları).
- **Altın kural:** Tüm para, süre, zar atışları **sunucuda**. Telefon sadece gösterir. (Omerta'yı hile/bot öldürdü.)

## Omerta'dan dersler → çözümler
| Omerta sorunu | Bizim çözüm |
|---|---|
| Bot/script hilesi | Sunucu yetkili RPC, hız sınırı, şüpheli kalıp kaydı |
| Sürpriz reset | Planlı sezonlar (6–8 hafta) + şeref listesi |
| Yeniler hemen ölüyor | Belli rütbeye kadar dokunulmazlık |
| Admin kayırmacılığı | Kayıtlı admin paneli, ban gerekçesi oyuncuya gösterilir |
| Mobil yok, geliştirme durdu | Mobil-öncelikli, bildirimlerle geri çağırma |

## Reklam kuralları
- Ödüllü reklam ödülleri **sunucuda doğrulanır** (AdMob Server-Side Verification), yoksa botlar sahte ödül toplar.
- Ödüller günlük sınırlı ve kolaylık amaçlı (ör. hapisten avukatla erken çıkma, hastaneden erken çıkma). Güç satmak yok.

## Fazlar
- **Faz 1 – Çekirdek (şimdi):** anonim giriş + takma ad, suçlar, araba çalma/satma, hapis, rütbeler, şehirler arası yolculuk, kaçak mal al-sat (saatlik değişen fiyatlar).
- **Faz 2 – Çok oyunculu:** kurşun alma, oyuncu arama/öldürme, hastane, koruma; aileler (kurma, üyeler, kasa), aile sohbeti.
- **Faz 3 – Sağlamlık:** sezonlar + şeref listesi, yeni oyuncu koruması, anti-bot, admin paneli.
- **Faz 4 – Yayın:** Capacitor paketleme, AdMob + SSV, push bildirimleri, 17+ yaş sınıfı, kapalı beta, mağaza.

## Omerta özellik karşılaştırması (2026-09-28)
Kaynak: 2006 tarihli Omerta oyuncu rehberi (omertaholic.blogspot.com), Omerta Beyond eklentisinin sayfa listesi, Wikipedia. Resmî wiki Cloudflare korumalı.

| Omerta | Bizde | Durum |
|---|---|---|
| Suçlar, rütbeler | İşler (6 suç), 10 rütbe | ✅ 001 |
| Araba çalma, garaj | Araba çal/sat | ✅ 001 |
| Hurdacı (araba → kurşun) | Ez butonu | ✅ 005 |
| Hapis, self-bust (3 hak), başkasını kurtarma | Firar + Kurtar | ✅ 002 |
| Booze/narkotik ticareti | Kaçak mal (uyuşturucusuz) | ✅ 001 |
| Seyahat + uçak yükseltmeleri | Liman + motorbot/deniz uçağı | ✅ 001/005 |
| Yerel kurşun fabrikası (stok, saatlik limit) | Kurşun fabrikası | ✅ 002 |
| Silah (Tommy gun) | Tabanca / Pompalı / Thompson | ✅ 002 |
| Dedektifler (şehir bulma) | Dedektifler | ✅ 002 |
| Öldürme, gereken kurşun rütbeye göre | Vurma/yaralama/öldürme (kalıcı ölüm yok) | ✅ 002 |
| Şişe atışı / killing skill | Şişe atışı / nişancılık | ✅ 002 |
| Korumalar | 5 kademe koruma | ✅ 002 |
| Blood bank / sağlık | Hastane + iyileşme | ✅ 002 |
| Banka, para transferi | Banka (%5 komisyon), transfer | ✅ 002 |
| Profil, istatistik, çevrimiçi liste | Profil, En Büyükler, çevrimiçi | ✅ 002 |
| Aileler (Don, Sottocapo, Consigliere, Capo) | Aile + roller + kasa + başvuru | ✅ 003 |
| Aile forumu | Aile sohbeti | ✅ 003 |
| Aile objeleri: kurşun fabrikası | Fabrika sahipliği + fiyat + gelir | ✅ 003 |
| Hitlist | Kelle listesi | ✅ 003 |
| Heist (2 kişi, 3 sa) | Tren Soygunu | ✅ 004 |
| Organized Crime (4 kişi, 12 sa) | Banka Soygunu | ✅ 004 |
| Kumarhane: slot, rulet, blackjack | Zar, rulet, slot | ✅ 005 (blackjack yok) |
| Özel mesajlar (inbox) | Mesajlar + engelle + şikâyet + küfür filtresi | ✅ 006 |
| Honour points | Saygı puanı (haftalık) | ✅ 006 |
| Spots / baskınlar (şehir kontrolü) | Mekânlar: haraç, baskın, tahkim | ✅ 007 |
| Aile objeleri: kumarhane sahipliği | Gazino mekânı sahibine kayıp bahis payı | ✅ 007 |
| Mega OC (8 kişi, 3 gün) | Büyük Liman Vurgunu | ✅ 008 |
| Yarışlar (race form) | Yarışlar + yarış formu | ✅ 008 |
| Blackjack | Blackjack | ✅ 009 |
| Piyango / kazı kazan | Günlük piyango + kazı kazan | ✅ 009 |
| Oyuncu pazarı (OBay) | Pazar (kurşun, araba) | ✅ 009 |
| Evlilik | Evlilik (teklif/kabul/boşanma) | ✅ 009 |
| Safehouse | Sığınak | ✅ 009 |
| Lackeys (ücretli otomasyon) | — | ❌ bilerek yok: ücretli bot = pay-to-win, Omerta'yı bitiren şeylerden |
| Pillory (adminlerin teşhir sayfası) | — | ⏳ admin paneliyle birlikte |

### Omerta dışı eklenenler
- ✅ Admin paneli (`www/admin.html`, 010): şikâyetler + kanıt, oyuncu dosyası, uyar/sustur/ban (gerekçe zorunlu, oyuncu görür), mesaj silme, işlem geçmişi
- ✅ Sezonlar (010): 8 hafta, 4 kategoride şeref listesi (itibar, infaz, servet, aile), ilk 3'e kalıcı rozet, sonra dünya sıfırlanır (hesap, isim, evlilik, saygı, mesajlar kalır)

**Admin olmak (Supabase açılınca, bir kez):** oyunu telefonda/tarayıcıda aç → Supabase panel → Authentication → Users'ta kendi kullanıcının UID'sini kopyala → SQL Editor: `insert into admins (user_id, role) values ('<UID>', 'owner');` — admin tek kişidir; moderatörleri Yönetim → Yetkililer'den oyuncu adıyla atarsın (013_roles). Admin araçları (itirazlar, yetkililer, kalıcı ban, sezon) panelde sadece kendi bilgisayarından (localhost) görünür.
Not: anonim hesap uygulama silinince kaybolur; yayından önce admin hesabı e-postaya bağlanmalı.

### Yayın için kalanlar
- Supabase bağlantısı (hesap bekleniyor), Capacitor paketleme, push bildirimleri
- AdMob ödüllü reklam + sunucu doğrulaması

## Klasör yapısı
- `supabase/migrations/` — veritabanı şeması ve oyun kuralları (SQL fonksiyonları)
- `www/` — oyun arayüzü
- `tests/` — PGlite ile yerel SQL testleri (Supabase hesabı olmadan)
