# Kabadayı — Görsel Üretim Listesi (art-deco afiş tarzı)

**Yapı:** Ana ekran her şehrin 2D panoraması; binalar ayrı saydam PNG olarak üstüne yerleştirilir (hepsi düz ön cephe, perspektif yok).
**Toplam:** 60 görsel. Klasör: `www/assets/` altındaki alt klasörler (aşağıda yazıyor). Dosya adları aynen böyle olsun.

## Nasıl üretelim
1. **Önce stil çapası:** `bg/istanbul.png` + `buildings/gazino.png` + `portraits/p1.png` üret, bana at. Tutarlılığa bakıp onay vereyim (renk/çizgi kalınlığı oturduysa geri kalanı aynı tarzda gider).
2. Geri kalanları üretirken **ilk onaylanan görseli referans görsel olarak ekle** (Nano Banana'da görsel ekleyip "same style as the reference" demek tutarlılığı çok artırır).
3. **Saydamlık sadece `buildings/` klasöründe gerekli.** O 12 dosyayı arka planı silinmiş PNG olarak ver (remove.bg, Photoshop, Canva vb.). Diğer her şey düz arka planlı — saydamlık yok.
4. Kod hazır: görsel gelmeyen yerde geçici çizim/emoji görünür, dosyayı klasöre koyduğun an otomatik yerine oturur.

## Ortak stil (her promptun SONUNA ekle)
```
1920s Art Deco travel poster illustration, flat colors with subtle paper grain, limited palette: antique gold #C9A14A, deep burgundy #7A2331, petrol teal #1F4E55, cream #E8D9BB, charcoal #15110D. Bold geometric shapes, clean silhouettes, thin gold outlines, warm dusk lighting. Strictly flat 2D, orthographic front view, no perspective, no 3D. No text, no letters, no numbers, no watermark, no signature.
```

---

## 1) Şehir arka planları — `www/assets/bg/` · 1080×1920 (dikey 9:16) · 6 adet
Ortak kalıp: *"Vertical 9:16 city backdrop for a mobile game map. Top 35%: sky and skyline silhouette of [ŞEHİR]. Middle: calm harbor water on the left edge. Bottom 60%: an empty cobblestone town square and streets seen from the front, with EMPTY flat ground areas (buildings will be placed on top later, so leave open space, no large buildings in the lower 60%)."*

| Dosya | [ŞEHİR] kısmına yazılacak |
|---|---|
| `istanbul.png` | Istanbul 1922: Galata Tower, Hagia Sophia and Süleymaniye domes and minarets, Golden Horn with steam ferries |
| `izmir.png` | Izmir 1922: Kordon seafront, the clock tower of Konak, palm trees, Mount Pagos behind |
| `selanik.png` | Thessaloniki 1922: the White Tower on the seafront, Byzantine church domes, harbor cranes |
| `pire.png` | Piraeus 1922: busy port with cargo steamers, cranes, Acropolis faintly on a distant hill |
| `iskenderiye.png` | Alexandria 1922: Corniche curve, Qaitbay citadel, palm trees, felucca sails |
| `beyrut.png` | Beirut 1922: red-tiled Ottoman houses on hills, Mount Lebanon snowy peaks behind, harbor lighthouse |

## 2) Binalar — `www/assets/buildings/` · 1024×1024 · **SAYDAM PNG** · 12 adet
Ortak kalıp: *"Single 1920s building, flat front facade elevation (like an architectural drawing), centered, full building visible, isolated on a plain white background, [TARİF]."*

| Dosya | [TARİF] | Oyundaki işlevi |
|---|---|---|
| `gazino.png` | glamorous Art Deco casino with neon-like gold marquee lights, arched entrance, red carpet | Kumarhane + mekân |
| `meyhane.png` | small Ottoman tavern with wooden bay window, hanging lanterns, grapevine over the door | Mekân |
| `kahvehane.png` | modest coffeehouse with striped awning, small tables and stools outside, hookah by the door | Mekân |
| `antrepo.png` | stone bonded warehouse with big arched cargo doors and crates stacked in front | Mekân |
| `karakol.png` | stern Ottoman police station and jail, barred windows, heavy iron door, gas lamp | Hapishane |
| `hastane.png` | white hospital building with a red crescent emblem on the pediment, ambulance carriage | Hastane |
| `banka.png` | neoclassical bank with columns and a heavy bronze door | Banka |
| `fabrika.png` | brick munitions workshop with a tall chimney and ammunition crates | Kurşun fabrikası |
| `silahci.png` | narrow gunsmith shop, rifles displayed in the window, hanging sign shaped like a pistol (no text) | Silahçı + korumalar |
| `dedektif.png` | shadowy upstairs private detective office, frosted glass door, venetian blinds, a lit window | Dedektif + infaz + kelle listesi |
| `garaj.png` | automobile garage with open doors showing a 1920s car, tools on the wall | Araba + yarış |
| `carsi.png` | covered bazaar entrance with domed roof, market stalls with rugs and brass goods | Oyuncu pazarı |

## 3) Karakter portreleri — `www/assets/portraits/` · 768×768 · 8 adet
Ortak kalıp: *"Head-and-shoulders portrait of [KİŞİ], facing slightly left, confident expression, framed inside a gold Art Deco circle, solid charcoal #15110D background."*

| Dosya | [KİŞİ] |
|---|---|
| `p1.png` | a young Istanbul kabadayı man, thick black moustache, fez tilted, dark suit with a gold chain |
| `p2.png` | a scarred older mob boss man, grey beard, fedora, fur-collar overcoat, cigar |
| `p3.png` | a slim sharp-eyed man, slicked-back hair, pinstripe suit, flower in lapel |
| `p4.png` | a heavy-set dock-worker bruiser man, flat cap, rolled sleeves, suspenders |
| `p5.png` | an elegant woman with a black bob haircut, pearl necklace, flapper dress, cigarette holder |
| `p6.png` | a tough woman with a headscarf tied back, leather jacket, determined look |
| `p7.png` | a glamorous woman casino owner, finger-wave hair, emerald earrings, silk gown |
| `p8.png` | a young street-smart woman, newsboy cap, tweed vest, knowing smirk |

## 4) Eşya kutucukları — `www/assets/items/` · 512×512 · kare, düz koyu arka plan · 18 adet
Ortak kalıp: *"Single [NESNE], centered, slightly angled for readability but flat illustrated, on a solid dark brown #211A13 square background with a thin gold Art Deco border."*

| Dosya | [NESNE] |
|---|---|
| `w_tabanca.png` | 1920s pistol |
| `w_pompali.png` | pump-action shotgun |
| `w_thompson.png` | Thompson submachine gun with drum magazine |
| `c_kamyonet.png` | battered old pickup truck, 1920s |
| `c_taksi.png` | 1920s city taxi cab |
| `c_aile.png` | 1920s family sedan car |
| `c_spor.png` | 1920s open-top roadster sports car |
| `c_sedan.png` | long luxury 1920s limousine sedan |
| `c_limuzin.png` | grand 1920s state limousine with chrome details |
| `g_kahve.png` | burlap sack of coffee beans |
| `g_tutun.png` | bundle of tobacco leaves tied with string |
| `g_sarap.png` | wooden crate of wine bottles |
| `g_raki.png` | crate of clear anise liquor bottles |
| `g_konyak.png` | crate of cognac bottles with gold labels (no text) |
| `g_viski.png` | wooden whisky barrel |
| `t_vapur.png` | steam ferry boat |
| `t_motorbot.png` | fast wooden motorboat |
| `t_deniz_ucagi.png` | 1920s seaplane |

## 5) İş illüstrasyonları — `www/assets/jobs/` · 1024×640 (yatay) · 9 adet
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

## 6) Sonuç kartları — `www/assets/results/` · 1024×640 · 5 adet
| Dosya | Sahne |
|---|---|
| `basari.png` | a gangster counting a thick roll of banknotes under a streetlamp, satisfied |
| `hapis.png` | a gangster behind jail bars, a guard with keys walking away |
| `kacti.png` | a gangster running away down a foggy alley, police whistles far behind |
| `vuruldu.png` | a fedora hat lying on wet cobblestones, a single rose, dramatic shadow (no blood, no body) |
| `yaris.png` | two 1920s cars racing side by side along a coastal road, dust clouds |

## 7) Tek parçalar — `www/assets/ui/` · 2 adet
| Dosya | Boyut | Sahne |
|---|---|---|
| `splash.png` | 1080×1920 | lone kabadayı in a long coat and fez standing on the Galata Bridge at night, Istanbul skyline and moon behind him, fog |
| `emblem.png` | 1024×1024 | Art Deco emblem: crossed pistol and prayer beads (tespih) inside a gold sunburst medallion, charcoal background |
