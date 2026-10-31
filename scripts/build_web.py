#!/usr/bin/env python3
"""Build the self-contained offline website, using only the standard library."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def web_data(data):
    """The web publication omits provenance and shop records entirely."""
    fields = ('id', 'name', 'variants', 'category', 'object_type', 'companies',
              'labels', 'registrations', 'verification')
    return {
        'schema_version': data.get('schema_version', 1),
        'updated_at': data.get('updated_at', '未提供'),
        'origin': '来自于网络收集',
        'records': [{key: record[key] for key in fields if key in record}
                    for record in data['records']
                    if record.get('object_type') != '店铺'
                    and record.get('category') != '店铺来源提醒'],
    }


def render(root=ROOT, database=None):
    data = json.loads((database or root / 'assets/risk-names.json').read_text(encoding='utf-8'))
    if not isinstance(data.get('records'), list):
        raise ValueError('Database must contain a records array')
    payload = json.dumps(web_data(data), ensure_ascii=False, separators=(',', ':'))
    # JSON is inert, including records that contain literal HTML closing tags.
    payload = payload.replace('&', '\\u0026').replace('<', '\\u003c').replace('>', '\\u003e')
    payload = payload.replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
    parts = {
        '/*__STYLES__*/': (root / 'web/styles.css').read_text(encoding='utf-8'),
        '/*__DATABASE__*/': payload,
        '/*__APP__*/': (root / 'web/app.js').read_text(encoding='utf-8'),
    }
    template = (root / 'web/index.template.html').read_text(encoding='utf-8')
    for marker in parts:
        if template.count(marker) != 1:
            raise ValueError(f'Expected exactly one placeholder: {marker}')
    # One-pass replacement: data cannot introduce a second template expansion.
    import re
    return re.sub(r'/\*__(?:STYLES|DATABASE|APP)__\*/', lambda m: parts[m[0]], template)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Fail if index.html is stale')
    parser.add_argument('--database', type=Path, help='Use another compatible database')
    parser.add_argument('--output', type=Path, default=ROOT / 'index.html')
    args = parser.parse_args()
    html = render(database=args.database)
    if args.check:
        if not args.output.exists() or args.output.read_text(encoding='utf-8') != html:
            parser.exit(1, 'index.html is stale; run python3 scripts/build_web.py\n')
        print('index.html is up to date')
    else:
        args.output.write_text(html, encoding='utf-8')
        print(f'Built {args.output.name} ({len(html.encode("utf-8")):,} bytes)')


if __name__ == '__main__':
    main()
