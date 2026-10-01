"""Saydam sayfadaki ayrı parçaları (birbirine değmeyen nesneler) tek tek keser — ızgaraya dizilmemiş sayfalar için.

Kullanım:
  python tools/slice_blobs.py <sayfa.png> <çıktı_klasörü> ad1 ad2 ... [--rowh 300] [--max 400]

- Parçalar okuma sırasına dizilir: önce üst kenara göre --rowh piksellik bantlar, bant içinde soldan sağa.
  Ad sırası buna göre verilir; betik bulduğu sırayı konumlarıyla yazar.
- Her parça kendi boyunda (kare değil) kırpılır; en uzun kenarı --max pikseli aşarsa küçültülür.
- Bu betik saydamlık ÜRETMEZ; sayfa kullanıcıdan saydam gelir.
"""
import sys
from collections import deque
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter


def blobs(im, scale=4, min_px=40):
    """Saydam olmayan bölgeleri (biraz şişirip) bağlı parçalara ayır, kutularını döndür."""
    small = im.getchannel('A').resize((im.width // scale, im.height // scale))
    m = np.asarray(small.point(lambda v: 255 if v > 24 else 0).filter(ImageFilter.MaxFilter(5))) > 0
    H, W = m.shape
    seen = np.zeros((H, W), bool)
    out = []
    for y, x in zip(*np.nonzero(m)):
        if seen[y, x]:
            continue
        seen[y, x] = True
        q, x0, x1, y0, y1, cnt = deque([(y, x)]), x, x, y, y, 0
        while q:
            cy, cx = q.popleft()
            cnt += 1
            x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
            for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                if 0 <= ny < H and 0 <= nx < W and m[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))
        if cnt >= min_px:
            out.append((x0 * scale, y0 * scale, min(im.width, (x1 + 1) * scale), min(im.height, (y1 + 1) * scale)))
    return out


def main():
    args = sys.argv[1:]
    opt = lambda k, d: int(args[args.index(k) + 1]) if k in args else d
    rowh, maxs = opt('--rowh', 300), opt('--max', 400)
    pos = [a for i, a in enumerate(args) if not a.startswith('--') and (i == 0 or not args[i - 1].startswith('--'))]
    sheet, outdir, names = pos[0], Path(pos[1]), pos[2:]
    im = Image.open(sheet).convert('RGBA')
    found = sorted(blobs(im), key=lambda b: (b[1] // rowh, b[0]))
    print(f'{sheet}: {len(found)} parça')
    if len(found) != len(names):
        for b in found:
            print('  ', b)
        sys.exit(f'{len(found)} parça bulundu, {len(names)} ad verildi')
    outdir.mkdir(parents=True, exist_ok=True)
    for name, box in zip(names, found):
        obj = im.crop(box)
        obj = obj.crop(obj.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox())
        if max(obj.size) > maxs:
            k = maxs / max(obj.size)
            obj = obj.resize((round(obj.width * k), round(obj.height * k)), Image.LANCZOS)
        obj.save(outdir / f'{name}.png', optimize=True)
        print(f'  {name}.png  {obj.size[0]}x{obj.size[1]}  (kaynakta {int(box[0])},{int(box[1])})')


if __name__ == '__main__':
    main()
