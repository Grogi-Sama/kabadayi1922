"""art/sheets/ altındaki toplu sayfaları www/assets/ altına keser. Olmayan sayfa atlanır.
Kullanım: python tools/slice_all.py"""
import subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHEETS = [
    ('binalar', 'auto', 'auto', 'buildings', ['gazino', 'meyhane', 'kahvehane', 'antrepo', 'karakol', 'hastane', 'banka',
                                    'fabrika', 'silahci', 'dedektif', 'garaj', 'carsi'], ['--size', '512', '--bottom']),
    ('arac_silah', 'auto', 'auto', 'items', ['w_tabanca', 'w_pompali', 'w_thompson', 't_deniz_ucagi', 'c_kamyonet', 'c_taksi',
                                   'c_aile', 'c_spor', 'c_sedan', 'c_limuzin', 't_vapur', 't_motorbot'], ['--size', '256']),
    ('mallar', 'auto', 'auto', 'items', ['g_kahve', 'g_tutun', 'g_sarap', 'g_raki', 'g_konyak', 'g_viski'], ['--size', '256']),
    ('portreler', 'auto', 'auto', 'portraits', [f'p{i}' for i in range(1, 9)], ['--size', '384', '--top']),
]

for name, cols, rows, out, names, extra in SHEETS:
    src = ROOT / 'art' / 'sheets' / f'{name}.png'
    if not src.exists():
        print(f'- {name}.png yok, atlandı')
        continue
    subprocess.run([sys.executable, str(ROOT / 'tools' / 'slice_sheet.py'), str(src), str(cols), str(rows),
                    str(ROOT / 'www' / 'assets' / out), *names, *extra], check=True)
