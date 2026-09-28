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

## Klasör yapısı
- `supabase/migrations/` — veritabanı şeması ve oyun kuralları (SQL fonksiyonları)
- `www/` — oyun arayüzü
- `tests/` — PGlite ile yerel SQL testleri (Supabase hesabı olmadan)
