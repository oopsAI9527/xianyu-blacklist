#!/usr/bin/env python3
"""Maintenance-only: regenerate assets/pinyin-table.json with pypinyin.

Runtime code never imports pypinyin; it reads the generated table. Coverage:
GB2312 level-1 common characters (3755) plus every Han character that appears
in assets/risk-names.json names, variants and companies. Heteronyms use the
pypinyin default reading, which is enough for disguise matching.

Usage: <venv-with-pypinyin>/bin/python scripts/gen_pinyin_table.py
"""
import json
import sys
from pathlib import Path

from pypinyin import Style, lazy_pinyin

ROOT = Path(__file__).resolve().parents[1]


def gb2312_level1():
    chars = set()
    for b1 in range(0xB0, 0xD8):
        for b2 in range(0xA1, 0xFF):
            try:
                chars.add(bytes([b1, b2]).decode('gb2312'))
            except UnicodeDecodeError:
                pass
    return chars


def main():
    data = json.loads((ROOT / 'assets/risk-names.json').read_text(encoding='utf-8'))
    chars = gb2312_level1()
    for r in data['records']:
        for s in [r.get('name', ''), *r.get('variants', []), *r.get('companies', [])]:
            chars.update(c for c in s if '一' <= c <= '鿿')
    table = {}
    for c in sorted(chars):
        py = lazy_pinyin(c, style=Style.NORMAL, errors='ignore')
        if py and py[0].isascii() and py[0].isalpha():
            table[c] = py[0]
    out = {
        'source': 'pypinyin 默认读音；覆盖 GB2312 一级常用字与词库中出现的全部汉字',
        'generated_by': 'scripts/gen_pinyin_table.py',
        'count': len(table),
        'table': table,
    }
    path = ROOT / 'assets/pinyin-table.json'
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'wrote {path.name}: {len(table)} chars, {path.stat().st_size:,} bytes')


if __name__ == '__main__':
    sys.exit(main())
