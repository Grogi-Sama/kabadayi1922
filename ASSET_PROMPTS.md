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

## 1) Liman panoraması (haritanın en üstü) — `www/assets/harbor/` · geniş 21:9 · 6 adet
Haritanın tepesinde silüet + su görünür, Liman düğmesi bunun üstünde. ✅ `istanbul.png` hazır.
Referans olarak bina sayfasını ekle. Şehir cümlesini değiştirerek kullan:
```
Same style as the reference image. Ultra-wide panoramic backdrop of [ŞEHİR] in 1922 at dusk, seen from across the water. The skyline stretches across the whole width: [SİLÜET]. In front of the skyline lies calm [SU] with a few small steam ferries and rowing boats. The lower part of the image is only calm water. No buildings or objects in the foreground. Warm sunset sky in gold and soft burgundy. Flat vector illustration, clean shapes, thin gold outlines, subtle paper grain, palette: antique gold, deep burgundy, petrol teal, cream, charcoal. Not pixel art, not photorealistic. No text, no letters, no numbers, no watermark.
```
| Dosya | [ŞEHİR] | [SİLÜET] | [SU] |
|---|---|---|---|
| `izmir.png` | Izmir | the Konak clock tower, Kordon seafront houses, palm trees, Mount Pagos behind | Gulf of Izmir water |
| `selanik.png` | Thessaloniki | the White Tower, Byzantine church domes, the old town on the hill | Thermaic Gulf water |
| `pire.png` | Piraeus | harbor warehouses and cranes, the Acropolis on a distant hill | harbor water with cargo steamers |
| `iskenderiye.png` | Alexandria | Qaitbay citadel, the Corniche curve, palm trees, minarets | Mediterranean water with felucca sails |
| `beyrut.png` | Beirut | red-tiled Ottoman houses on hills, snowy Mount Lebanon behind, a harbor lighthouse | Mediterranean water |

## 1b) Dokular (sokak duvarı ve kaldırım) — `www/assets/tex/` · kare 1024×1024 · **kenarları birleşen (seamless) desen** · 2 adet
Şu an kodla çizilmiş tuğla ve kaldırım var; dosya gelince otomatik onun yerine geçer.
| Dosya | Prompt |
|---|---|
| `duvar.png` | `Seamless tileable texture, flat front view: old Istanbul street wall of warm brown bricks alternating with bands of pale cut stone (Ottoman masonry), slightly worn, dark mortar lines. Even lighting, no shadows from objects, no windows, no doors, no plants. Flat vector illustration with subtle paper grain, muted palette of brown, ochre and charcoal. The pattern repeats perfectly on all four edges. No text.` |
| `kaldirim.png` | `Seamless tileable texture, straight top-down view: old cobblestone street (arnavut kaldırımı), rounded grey-brown stones of slightly different sizes in loose rows, dark gaps between stones. Even lighting. Flat vector illustration with subtle paper grain, muted palette of grey, brown and charcoal. The pattern repeats perfectly on all four edges. No text.` |

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
| `infaz.png` | (2026-10-05) a fedora on wet cobblestones beside an overturned chair under a lone streetlamp, scattered bullet casings, long dramatic shadow (no blood, no body) |
| `yaralandi.png` | (2026-10-05) a wounded gangster leaning against an alley wall, hand pressed to his side, hat fallen, silhouette of a shooter running off at the end of the alley (no blood) |
| `mekan_dustu.png` | (2026-10-05) a gazino at night with its door kicked in, broken sign lights, rival gangsters in silhouette standing in the doorway, overturned card table inside |
| `baskin_puskurtuldu.png` | (2026-10-05) defenders behind sandbags and overturned tables in front of a gazino door, muzzle flashes, attackers retreating into the dark street |

## 4) Tek parçalar — `www/assets/ui/` · 2 adet
| Dosya | Boyut | Sahne |
|---|---|---|
| `splash.png` | 1080×1920 | lone kabadayı in a long coat and fez standing on the Galata Bridge at night, Istanbul skyline and moon behind him, fog |
| `emblem.png` | 1024×1024 | Art Deco emblem: crossed pistol and prayer beads (tespih) inside a gold sunburst medallion, charcoal background |

## Sığınak — `www/assets/buildings/siginak.png` · kare 1024×1024 · **SAYDAM PNG** (arka planı sil)
Bina sayfasını referans olarak ekle. Gelince haritada yuvarlak düğmenin yerine geçer.
```
Same style as the reference image. A single game map object, isolated on a plain flat solid light green background (#9FD8B8), centered, full object visible, seen from the front and slightly above like the buildings in the reference. Istanbul, 1922. A secret underground shelter entrance set into a small patch of cobblestone pavement against a low weathered stone wall: a rectangular stone frame in the ground with a steep stone staircase leading down into darkness. The entrance is covered by a heavy wooden double cellar door with iron straps and hinges, the two leaves open upwards like a hatch. The left leaf is closed and lies flat; the right leaf is half open, raised at an angle. A man dressed as a 1920s private detective (long trench coat, fedora hat) is stepping down the stairs, crouching as he enters, seen from the side and slightly behind; with one hand he holds up the edge of the half-open right leaf above his head, his other arm close to his body. A faint warm lantern glow comes from below the stairs, the rest is dark and secretive. A small gas street lamp beside the wall. Flat vector illustration, clean silhouettes, thin gold outlines, subtle paper grain, palette: antique gold #C9A14A, deep burgundy #7A2331, petrol teal #1F4E55, cream #E8D9BB, charcoal #15110D, warm dusk lighting. Not pixel art, not photorealistic, no 3D render. No text, no signs, no letters, no numbers, no watermark.
```

## Süsler — `art/sheets/susler.png` · 4 sütun × 4 satır · kare · **arka planı silinip SAYDAM PNG**
Duvara asılanlar binaların arasında/arkasında duvarda, yerdekiler kaldırımda binaların arasında durur. Kesip yerleştirmeyi ben yaparım.
```
Same style as the reference image. Sprite sheet layout: 16 separate small street props arranged in a neat, evenly spaced grid of 4 columns and 4 rows on a plain flat solid light green background (#9FD8B8). Each prop sits fully inside its own cell, centered, with wide empty gaps between cells; nothing touches or overlaps. Every prop is drawn as a flat front view like the buildings in the reference, same scale family, no ground, no cast shadows, no grid lines, no labels. Istanbul, 1922.
Row 1 (mounted on a wall): a narrow Ottoman wooden window with half-open shutters and a flower box; a wall gas lantern on a curly iron bracket, lit; a patch of climbing ivy hanging down; a torn old wall poster showing only a picture of a steamship (no words).
Row 2 (mounted on a wall): a short laundry line with a few hanging clothes; a tiny wrought-iron balcony with two flower pots; a small marble Ottoman street fountain (çeşme) set in an arched niche; a hanging wooden shop sign with a simple coffee cup pictogram.
Row 3 (standing on the ground): a cast-iron gas street lamp, lit; a stack of three wooden crates; a wooden barrel; a street cat sitting and looking sideways.
Row 4 (standing on the ground): a simit seller's wooden cart with sesame bread rings; a wooden shoeshine box; a potted fig tree in an old tin can; three pigeons pecking.
Flat vector illustration, clean silhouettes, thin gold outlines, subtle paper grain, warm dusk lighting. Not pixel art, not photorealistic. No text, no letters, no numbers, no watermark.
```

## Sığınak (yeni deneme) — `www/assets/buildings/siginak.png` · kare · **SAYDAM PNG**
Diğer binalar gibi düz önden; kendi zemini/duvarı/lambası YOK, bizim kaldırıma basar.
```
Same style as the reference image. A single flat front elevation, like the buildings in the reference, isolated on a plain flat solid light green background (#9FD8B8), centered, nothing else around it: no ground, no pavement, no wall, no street lamp. Istanbul, 1922. A secret cellar entrance built against the foot of a building: a low weathered stone frame with a pair of heavy slanted wooden cellar doors (bulkhead doors) with iron straps, the kind that open upwards. The left door is closed and lies on its slant; the right door is half open, raised upwards. Through the opening, stone steps lead down into darkness with a faint warm lantern glow below. A man in a 1920s detective outfit (long trench coat, fedora) is crouching as he steps down into the opening, seen from the front-side, one hand raised holding the edge of the half-open right door. The whole object is wide and low, about half as tall as a small house. Flat vector illustration, clean silhouettes, thin gold outlines, subtle paper grain, warm dusk lighting. Not pixel art, not photorealistic, no 3D, no isometric view. No text, no letters, no numbers, no watermark.
```

## ✅ Liman panoramaları toplu sayfa — `art/sheets/limanlar.png` · dikey 9:16 · tek sütun, 5 satır
Sonuç kartları geldi (✅ results/*). Kesim sırası yukarıdan aşağı: harbor/izmir, selanik, pire, iskenderiye, beyrut
