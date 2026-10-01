# Kabadayı — Görsel Üretim Listesi (art-deco afiş tarzı)

**Yapı:** Ana ekran her şehrin 2D panoraması; binalar ayrı saydam PNG olarak üstüne yerleştirilir (hepsi düz ön cephe, perspektif yok).
**Toplam:** 60 görsel ama **26 üretim**: küçük görseller (bina, eşya, portre = 38 adet) 4 toplu sayfada üretilir, betikle kesilir. Büyükler (arka plan, iş/sonuç sahneleri, splash, amblem) tek tek.

## Durum (2026-09-29)
- ✅ B araçlar/silahlar, C mallar, D portreler: onaylandı, kesildi, oyunda.
- ⏸ A binalar: harita artık tek görsel olduğu için gerek yok (panel simgeleri haritadan kesilecek).
- ⏳ Tek tek üretilenler: hepsi bekliyor.

## Nasıl üretelim
1. **Önce stil çapası:** `bg/istanbul.png` + **A sayfası (binalar)** + **D sayfası (portreler)** üret. Tutarlılığa bakıp onay vereyim.
2. Geri kalanları üretirken **onaylanan görseli referans olarak ekle** ("same style as the reference").
3. Toplu sayfaları **en yüksek çözünürlükte** al (2K/4K seçeneği varsa onu seç; en az 2048 px genişlik).
4. **Saydamlık sadece A sayfasında (binalar):** sayfanın arka planını bir kez sil (remove.bg, Canva vb.), saydam PNG olarak kaydet. Diğer sayfalar düz arka planlı kalır.
5. Toplu sayfaları `art/sheets/` klasörüne şu adlarla koy: `binalar.png`, `arac_silah.png`, `mallar.png`, `portreler.png`. Kesip `www/assets/` altına ben yerleştiririm (`python tools/slice_all.py`).
6. Kod hazır: görsel gelmeyen yerde geçici çizim/emoji görünür, dosya klasöre konunca otomatik yerine oturur.

## Ortak stil (her promptun SONUNA ekle)
```
1920s Art Deco travel poster illustration, flat colors with subtle paper grain, limited palette: antique gold #C9A14A, deep burgundy #7A2331, petrol teal #1F4E55, cream #E8D9BB, charcoal #15110D. Bold geometric shapes, clean silhouettes, thin gold outlines, warm dusk lighting. Strictly flat 2D vector illustration (not pixel art, not photorealistic), orthographic front view, no perspective, no 3D. No text, no signs with words, no letters, no numbers, no watermark, no signature.
```

## Toplu sayfalar için ortak ızgara kuralı (toplu sayfa promptlarında ortak stilden ÖNCE ekle)
```
Sprite sheet layout: the items are arranged in a neat, evenly spaced grid exactly as described, row by row, left to right. Each item sits fully inside its own cell, centered, similar size, with wide empty gaps between cells. Nothing touches or overlaps, nothing is cut off at the edges. No grid lines, no cell borders, no frames, no labels, no ground shadows.
```

---

## A) Binalar — `art/sheets/binalar.png` · 4 sütun × 3 satır · yatay 4:3 (ör. 2048×1536) · **arka planı silinip SAYDAM PNG**
```
A sprite sheet of 12 separate 1920s buildings on a plain flat solid light green background (#9FD8B8). Each building is a single flat front facade elevation (like an architectural drawing), full building visible, bottoms aligned on the same line within each row.
Row 1: (1) glamorous Art Deco casino with gold marquee lights, arched entrance, red carpet; (2) small Ottoman tavern with wooden bay window, hanging lanterns, grapevine over the door; (3) modest coffeehouse with striped awning, small tables and stools outside, hookah by the door; (4) stone bonded warehouse with big arched cargo doors and crates stacked in front.
Row 2: (5) stern Ottoman police station and jail, barred windows, heavy iron door, gas lamp; (6) white hospital building with a red crescent emblem on the pediment, ambulance carriage; (7) neoclassical bank with columns and a heavy bronze door; (8) brick munitions workshop with a tall chimney and ammunition crates.
Row 3: (9) narrow gunsmith shop, rifles in the window, hanging sign shaped like a pistol; (10) shadowy upstairs private detective office, frosted glass door, venetian blinds, one lit window; (11) automobile garage with open doors showing a 1920s car, tools on the wall; (12) covered bazaar entrance with domed roof, market stalls with rugs and brass goods.
```
Kesim sırası: gazino, meyhane, kahvehane, antrepo · karakol, hastane, banka, fabrika · silahci, dedektif, garaj, carsi
(Yeşil arka plan, beyaz hastane ve krem binalar silinirken karışmasın diye.)

## B) Silah ve araçlar — `art/sheets/arac_silah.png` · 4 sütun × 3 satır · yatay 4:3
```
A sprite sheet of 12 separate objects on a plain flat solid dark brown background (#211A13), each shown from the side, flat illustrated.
Row 1: (1) 1920s pistol; (2) pump-action shotgun; (3) Thompson submachine gun with drum magazine; (4) 1920s seaplane.
Row 2: (5) battered old 1920s pickup truck; (6) 1920s city taxi cab; (7) 1920s family sedan car; (8) 1920s open-top roadster sports car.
Row 3: (9) long luxury 1920s limousine sedan; (10) grand 1920s state limousine with chrome details; (11) steam ferry boat; (12) fast wooden motorboat.
```
Kesim sırası: w_tabanca, w_pompali, w_thompson, t_deniz_ucagi · c_kamyonet, c_taksi, c_aile, c_spor · c_sedan, c_limuzin, t_vapur, t_motorbot

## C) Kaçak mallar — `art/sheets/mallar.png` · 3 sütun × 2 satır · yatay 3:2 (ör. 2048×1365)
```
A sprite sheet of 6 separate objects on a plain flat solid dark brown background (#211A13), flat illustrated.
Row 1: (1) burlap sack of coffee beans; (2) bundle of tobacco leaves tied with string; (3) wooden crate of wine bottles.
Row 2: (4) crate of clear anise liquor bottles; (5) crate of cognac bottles with plain gold labels; (6) wooden whisky barrel.
```
Kesim sırası: g_kahve, g_tutun, g_sarap · g_raki, g_konyak, g_viski

## D) Portreler — `art/sheets/portreler.png` · 4 sütun × 2 satır · yatay 2:1 (ör. 2048×1024)
(Altın yuvarlak çerçeveyi oyun kendisi çiziyor, görselde çerçeve olmasın.)
```
A sprite sheet of 8 separate head-and-shoulders character portraits on a plain flat solid charcoal background (#15110D), each facing slightly left, confident expression, same scale, no frames, no circles.
Row 1 (men): (1) a young Istanbul kabadayı, thick black moustache, fez tilted, dark suit with a gold chain; (2) a scarred older mob boss, grey beard, fedora, fur-collar overcoat, cigar; (3) a slim sharp-eyed man, slicked-back hair, pinstripe suit, flower in lapel; (4) a heavy-set dock-worker bruiser, flat cap, rolled sleeves, suspenders.
Row 2 (women): (5) an elegant woman with a black bob haircut, pearl necklace, flapper dress, cigarette holder; (6) a tough woman with a headscarf tied back, leather jacket, determined look; (7) a glamorous casino owner, finger-wave hair, emerald earrings, silk gown; (8) a young street-smart woman, newsboy cap, tweed vest, knowing smirk.
```
Kesim sırası: p1 … p8

---

# Tek tek üretilenler

## 1) Şehir haritaları (2.5D, binalar görselin içinde) — `www/assets/bg/` · dikey 9:16, en yüksek çözünürlük · 6 adet
Binalar ayrı yerleştirilmiyor; şehir tek görsel. Dokunma alanlarını, isim tabelalarını ve vurgu çizgilerini kod üstüne ekliyor.
Önce İstanbul üretilir, dokunma alanları ona göre ayarlanır, sonra aynı yerleşimle diğer şehirler.
Promptun tamamı ve şehir değişkenleri: aşağıdaki "Harita promptu" bölümü.

### Harita promptu (İstanbul)
```
Same style as the reference image. Vertical 9:16 illustrated city map for a mobile game, 2.5D three-quarter top-down view: the camera looks down at about 45 degrees, so every building shows its front facade and its roof. Istanbul in 1922. All buildings use the same viewing angle and the same light from the upper left.
Layout from top to bottom:
- Top 15%: dusk sky with the distant skyline silhouette: Galata Tower, Hagia Sophia and Süleymaniye domes and minarets.
- 15–30%: the Golden Horn waterfront. On the far left a wooden pier with a steam ferry and small boats (the harbor). On the quay to the right of the pier: a stone bonded warehouse with big arched cargo doors and stacked crates. On the far right of the quay: a stern Ottoman police station and jail with barred windows and a gas lamp.
- 30–55%: a cobblestone square. In the center a neoclassical bank with columns and a heavy bronze door. On the left a white hospital with a red crescent on the pediment and an ambulance carriage. On the right a glamorous Art Deco casino with gold marquee lights and a red carpet.
- 55–75%: a street row. From left to right: a brick munitions workshop with a tall chimney and ammunition crates; a narrow gunsmith shop with rifles in the window and a pistol-shaped hanging sign; a shadowy two-storey private detective office with venetian blinds and one lit window; a small Ottoman tavern with a wooden bay window, lanterns and a grapevine over the door.
- 75–100%: the lower street. On the left an automobile garage with open doors and a 1920s car inside. In the center-right a covered bazaar with a domed roof and stalls with rugs and brass goods. At the bottom center a small hidden cellar door with steps going down, half in shadow.
Every building stands alone on its own block, separated by streets, stairs or small trees, with clear space around it. No building overlaps or hides another. Each building has a strong dark outline so it reads clearly against the street. Small people and carts may be on the streets but never in front of building entrances.
Art Deco travel poster illustration, flat colors with subtle paper grain, limited palette: antique gold #C9A14A, deep burgundy #7A2331, petrol teal #1F4E55, cream #E8D9BB, charcoal #15110D. Clean silhouettes, thin gold outlines, warm dusk lighting. Flat vector illustration, not pixel art, not photorealistic. No text, no signs with words, no letters, no numbers, no watermark, no signature.
```

### Diğer şehirler (aynı promptu kopyala, sadece bunları değiştir)
| Dosya | "Istanbul in 1922" yerine | Silüet (Top 15%) | Kıyı (15–30%) | Kıyıdaki mekân (depo yerine) | 55–75% sondaki mekân (meyhane yerine) |
|---|---|---|---|---|---|
| `izmir.png` | Izmir in 1922 | Mount Pagos and the Konak clock tower | the Kordon seafront with palm trees | aynı (depo) | a modest coffeehouse with a striped awning, small tables and a hookah by the door |
| `selanik.png` | Thessaloniki in 1922 | the White Tower and Byzantine church domes | the harbor quay with cranes | aynı (depo) | aynı (meyhane) |
| `pire.png` | Piraeus in 1922 | the Acropolis faintly on a distant hill | a busy port with cargo steamers and cranes | a modest coffeehouse with a striped awning, small tables and a hookah by the door | aynı (meyhane) |
| `iskenderiye.png` | Alexandria in 1922 | Qaitbay citadel and palm trees | the Corniche curve with felucca sails | aynı (depo) | a modest coffeehouse with a striped awning, small tables and a hookah by the door |
| `beyrut.png` | Beirut in 1922 | red-tiled houses on hills and snowy Mount Lebanon | the harbor with a lighthouse | aynı (depo) | a modest coffeehouse with a striped awning, small tables and a hookah by the door |
(Mekânlar şehirlerin gerçek mekân listesine göre seçildi: `supabase/migrations/007_spots.sql`.)

## 2) İş illüstrasyonları — `www/assets/jobs/` · 1024×640 (yatay) · 9 adet
Ortak kalıp: *"Wide cinematic scene: [SAHNE]."*

| Dosya | [SAHNE] |
|---|---|
| `cep.png` | a pickpocket slipping a wallet from a gentleman's coat on a crowded tram |
| `dukkan.png` | a masked thief emptying a grocer's cash drawer at night |
| `kumarhane.png` | a thug collecting protection money from a nervous card-den owner |
| `liman.png` | smugglers carrying crates out of a dark harbor warehouse |
| `kuyumcu.png` | a burglar cracking a jeweler's display in a covered bazaar at night |
| `banka.png` | a bank vault door blown open, smoke and scattered banknotes |
| `soygun.png` | gangsters in 1920s motorcars chasing a steam train along the tracks at dusk |
| `organize.png` | a crew in a getaway car outside the Ottoman Bank building, sirens |
| `buyuk.png` | a large crew unloading gold crates from a cargo ship at night under cranes |

## 3) Sonuç kartları — `www/assets/results/` · 1024×640 · 5 adet
| Dosya | Sahne |
|---|---|
| `basari.png` | a gangster counting a thick roll of banknotes under a streetlamp, satisfied |
| `hapis.png` | a gangster behind jail bars, a guard with keys walking away |
| `kacti.png` | a gangster running away down a foggy alley, police whistles far behind |
| `vuruldu.png` | a fedora hat lying on wet cobblestones, a single rose, dramatic shadow (no blood, no body) |
| `yaris.png` | two 1920s cars racing side by side along a coastal road, dust clouds |

## 4) Tek parçalar — `www/assets/ui/` · 2 adet
| Dosya | Boyut | Sahne |
|---|---|---|
| `splash.png` | 1080×1920 | lone kabadayı in a long coat and fez standing on the Galata Bridge at night, Istanbul skyline and moon behind him, fog |
| `emblem.png` | 1024×1024 | Art Deco emblem: crossed pistol and prayer beads (tespih) inside a gold sunburst medallion, charcoal background |
