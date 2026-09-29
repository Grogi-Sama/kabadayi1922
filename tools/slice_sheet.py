"""Toplu görsel sayfasını (ızgara) tek tek dosyalara böler.

Kullanım:
  python tools/slice_sheet.py <sayfa.png> <sütun> <satır> <çıktı_klasörü> ad1 ad2 ... [--size 512] [--bottom]
  python tools/slice_sheet.py <sayfa.png> auto auto <çıktı_klasörü> ad1 ad2 ...   (satır/nesne sayısı serbest)

- Arka planı SİLİNMİŞ (saydam) sayfada nesneler saydamlığa göre bulunur (binalar).
- Düz arka planlı sayfada arka plan rengi kenarlardan okunur, nesneler ondan ayrılır (eşyalar, portreler).
  Bu betik saydamlık ÜRETMEZ; saydam sayfa kullanıcıdan hazır gelir.
- Görseller ızgaraya tam oturmasa da olur: kare sınırları en boş sütun/satıra kaydırılır.
- Ad yerine '-' yazılan kare atlanır. --bottom: nesne karenin altına oturtulur (binalar aynı zemine basar).
  --top: uzun nesnenin sadece üstteki kare kısmı alınır (portrede baş ve omuzlar).
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image


def split_points(occ, n, search=0.22):
    """Beklenen sınırların yakınındaki en boş çizgiyi bul."""
    L = len(occ)
    cell = L / n
    pts = [0]
    for k in range(1, n):
        exp = int(k * cell)
        lo, hi = max(1, exp - int(cell * search)), min(L - 1, exp + int(cell * search))
        win = occ[lo:hi]
        best = win.min()
        cands = np.nonzero(win <= best + max(1, best * 0.05))[0] + lo
        # en boş bölgenin ortası (aynı boşluktaki çizgilerin ortası)
        pts.append(int(cands[np.argmin(np.abs(cands - exp))]))
    pts.append(L)
    return pts


def bands(occ, min_gap):
    """Dolu bölgeleri (aralarında en az min_gap boşluk olan) [başlangıç, bitiş) olarak döndür."""
    full = occ > 2
    out, start, gap = [], None, 0
    for i, f in enumerate(full):
        if f:
            if start is None:
                start = i
            gap = 0
            end = i + 1
        elif start is not None:
            gap += 1
            if gap >= min_gap:
                out.append((start, end)); start = None
    if start is not None:
        out.append((start, end))
    return out


def auto_cells(mask):
    """Önce satırları, sonra her satırdaki nesneleri boşluklara göre bul (okuma sırası)."""
    H, W = mask.shape
    cells = []
    for y0, y1 in bands(mask.sum(axis=1), max(8, H // 60)):
        for x0, x1 in bands(mask[y0:y1].sum(axis=0), max(8, W // 100)):
            cells.append((x0, x1, y0, y1))
    return cells


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opts = sys.argv[1:]
    size = int(opts[opts.index('--size') + 1]) if '--size' in opts else 512
    if '--size' in opts:
        args.remove(str(size))
    bottom = '--bottom' in opts
    top = '--top' in opts  # portre: kare, üstten (baş ve omuzlar)
    sheet, cols, rows, outdir, names = args[0], args[1], args[2], Path(args[3]), args[4:]
    auto = cols == 'auto'
    if not auto:
        cols, rows = int(cols), int(rows)
        if len(names) != cols * rows:
            sys.exit(f'{cols}x{rows}={cols * rows} ad gerekli, {len(names)} verildi')

    im = Image.open(sheet).convert('RGBA')
    a = np.asarray(im).astype(np.int16)
    alpha = a[..., 3]
    transparent = (alpha < 250).mean() > 0.2
    if transparent:
        mask = alpha > 24
        bg = None
    else:
        edge = np.concatenate([a[0, :, :3], a[-1, :, :3], a[:, 0, :3], a[:, -1, :3]])
        bg = np.median(edge, axis=0)
        mask = np.abs(a[..., :3] - bg).sum(axis=2) > 60
    print(f'{sheet}: {im.width}x{im.height}, ' + ('saydam' if transparent else f'arka plan rgb{tuple(int(v) for v in bg)}'))

    if auto:
        cells = auto_cells(mask)
        if len(cells) != len(names):
            sys.exit(f'{len(cells)} nesne bulundu, {len(names)} ad verildi')
    else:
        xs = split_points(mask.sum(axis=0), cols)
        ys = split_points(mask.sum(axis=1), rows)
        cells = [(xs[c], xs[c + 1], ys[r], ys[r + 1]) for r in range(rows) for c in range(cols)]
    outdir.mkdir(parents=True, exist_ok=True)

    for name, (x0, x1, y0, y1) in zip(names, cells):
        if name == '-':
            continue
        m = mask[y0:y1, x0:x1]
        # gürültüyü yok say: en az birkaç piksel dolu satır/sütunlar
        rr = np.nonzero(m.sum(axis=1) > 2)[0]
        cc = np.nonzero(m.sum(axis=0) > 2)[0]
        if len(rr) == 0 or len(cc) == 0:
            print(f'  ! {name}: kare boş, atlandı')
            continue
        bx0, bx1, by0, by1 = x0 + cc[0], x0 + cc[-1] + 1, y0 + rr[0], y0 + rr[-1] + 1
        if top and by1 - by0 > bx1 - bx0:
            by1 = by0 + (bx1 - bx0)
        obj = im.crop((bx0, by0, bx1, by1))
        w, h = obj.size
        pad = 0.04 if transparent else 0.06
        side = int(max(w, h) * (1 + 2 * pad))
        fill = (0, 0, 0, 0) if transparent else tuple(int(v) for v in bg) + (255,)
        canvas = Image.new('RGBA', (side, side), fill)
        ox = (side - w) // 2
        oy = side - h - int(side * pad) if bottom else (side - h) // 2
        canvas.paste(obj, (ox, oy), obj)
        out = canvas.resize((size, size), Image.LANCZOS)
        if not transparent:
            out = out.convert('RGB')
        out.save(outdir / f'{name}.png', optimize=True)
        print(f'  {name}.png  (kaynak {w}x{h})')


if __name__ == '__main__':
    main()
