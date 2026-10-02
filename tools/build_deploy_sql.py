"""Supabase'e kurulacak tek SQL dosyasını üretir: supabase/deploy.sql

Kullanım:  python tools/build_deploy_sql.py          (hepsi, boş proje için → deploy.sql)
           python tools/build_deploy_sql.py 020      (canlı sunucuya: 020 ve sonrası → deploy_020.sql)
Sonra Supabase panel → SQL Editor → New query → deploy.sql içeriğini yapıştır → Run.

- Sadece migrations/ klasöründeki dosyalar sırayla birleştirilir.
- local-shim.sql (sahte auth) ve local-seed.sql (sahte oyuncular) ASLA eklenmez.
- Bir kez, BOŞ bir projeye çalıştırılır. Sonraki değişiklikler için yeni migration dosyaları tek tek çalıştırılır.
"""
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
start = sys.argv[1] if len(sys.argv) > 1 else None
migs = [m for m in sorted((root / 'supabase' / 'migrations').glob('*.sql')) if not start or m.name[:3] >= start]
parts = ['-- Kabadayı: Supabase kurulumu (otomatik üretildi: tools/build_deploy_sql.py)\n'
         + (f'-- CANLI sunucuya güncelleme ({start} ve sonrası). SQL Editor\'de YENİ bir sorguda bir kez çalıştır.\n' if start
            else '-- Boş bir projede SQL Editor\'de bir kez çalıştır. Sahte oyuncu/yerel dosyalar içermez.\n')
         + 'begin;\n']
for m in migs:
    parts.append(f'\n-- ════════════════ {m.name} ════════════════\n')
    parts.append(m.read_text(encoding='utf-8'))
parts.append('\ncommit;\n')
out = root / 'supabase' / (f'deploy_{start}.sql' if start else 'deploy.sql')
out.write_text(''.join(parts), encoding='utf-8')
print(f'{out} yazıldı: {len(migs)} migration, {out.stat().st_size // 1024} KB')
