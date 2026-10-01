"""Supabase'e kurulacak tek SQL dosyasını üretir: supabase/deploy.sql

Kullanım:  python tools/build_deploy_sql.py
Sonra Supabase panel → SQL Editor → New query → deploy.sql içeriğini yapıştır → Run.

- Sadece migrations/ klasöründeki dosyalar sırayla birleştirilir.
- local-shim.sql (sahte auth) ve local-seed.sql (sahte oyuncular) ASLA eklenmez.
- Bir kez, BOŞ bir projeye çalıştırılır. Sonraki değişiklikler için yeni migration dosyaları tek tek çalıştırılır.
"""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
migs = sorted((root / 'supabase' / 'migrations').glob('*.sql'))
parts = ['-- Kabadayı: Supabase kurulumu (otomatik üretildi: tools/build_deploy_sql.py)\n'
         '-- Boş bir projede SQL Editor\'de bir kez çalıştır. Sahte oyuncu/yerel dosyalar içermez.\n'
         'begin;\n']
for m in migs:
    parts.append(f'\n-- ════════════════ {m.name} ════════════════\n')
    parts.append(m.read_text(encoding='utf-8'))
parts.append('\ncommit;\n')
out = root / 'supabase' / 'deploy.sql'
out.write_text(''.join(parts), encoding='utf-8')
print(f'{out} yazıldı: {len(migs)} migration, {out.stat().st_size // 1024} KB')
