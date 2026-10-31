"""Optional real-browser checks: pip install playwright; playwright install chromium."""
import argparse
import csv
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--executable', help='Optional existing Chromium executable')
    parser.add_argument('--screenshot-dir', type=Path, default=Path(tempfile.gettempdir()) / 'risk-web-checks')
    args = parser.parse_args()
    args.screenshot_dir.mkdir(parents=True, exist_ok=True)
    db = json.loads((ROOT / 'assets/risk-names.json').read_text())
    data = [r for r in db['records'] if r.get('object_type') != '店铺' and r.get('category') != '店铺来源提醒']
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, **({'executable_path': args.executable} if args.executable else {}))
        context = browser.new_context(viewport={'width': 1440, 'height': 1100}, accept_downloads=True, reduced_motion='reduce')
        page = context.new_page()
        errors, external = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
        page.on('request', lambda request: external.append(request.url) if request.url.startswith(('http:', 'https:')) else None)
        page.goto((ROOT / 'index.html').as_uri())
        page.wait_for_load_state('networkidle')
        expect(page.locator('#total-stat')).to_have_text(f'{len(data):,}')
        expect(page.locator('#results-body tr')).to_have_count(20)
        expect(page.locator('#company-stat')).to_have_text('8')
        expect(page.locator('#category-stat')).to_have_text(str(len({r['category'] for r in data})))
        expect(page.locator('#source-stat, #source-filter, #tab-shop, #about-sources')).to_have_count(0)
        expect(page.locator('.sidebar-foot')).to_contain_text('来自于网络收集')
        embedded = json.loads(page.locator('#risk-data').text_content())
        assert len(embedded['records']) == len(data)
        assert 'source_labels' not in embedded
        assert all('sources' not in r and 'risk_note' not in r for r in embedded['records'])
        assert all(r.get('object_type') != '店铺' and r.get('category') != '店铺来源提醒' for r in embedded['records'])
        page.locator('#about-button').click()
        expect(page.locator('#about-dialog')).to_contain_text('来自于网络收集')
        expect(page.locator('#about-dialog')).not_to_contain_text('来源编号')
        page.keyboard.press('Escape')
        expect(page.locator('#result-count')).to_contain_text(f'{len(data):,}')
        page.screenshot(path=str(args.screenshot_dir / 'desktop.png'), full_page=False)

        page.locator('#next-page').click()
        expect(page.locator('#page-description')).to_contain_text('第 21–40 条')
        page.locator('#reset-button').click()
        page.locator('#search').fill('维权骑士版权小课')
        page.locator('#exact-match').check()
        expect(page.locator('#result-count')).to_contain_text('找到 1 条')
        page.locator('.record-open').click()
        expect(page.locator('#detail-dialog')).to_be_visible()
        expect(page.locator('#detail-content')).to_contain_text('苏作登字-2020-A-00048407')
        expect(page.locator('#detail-content')).to_contain_text('杭州刀豆网络科技有限公司')
        expect(page.locator('#detail-content .source-card')).to_have_count(0)
        expect(page.locator('#detail-content')).not_to_contain_text('资料出处')
        page.screenshot(path=str(args.screenshot_dir / 'detail.png'), full_page=False)
        page.keyboard.press('Escape')

        page.locator('#reset-button').click()
        page.locator('#company-filter').select_option('河南百通教育科技有限公司')
        expected = sum('河南百通教育科技有限公司' in r['companies'] for r in data)
        expect(page.locator('#result-count')).to_contain_text(f'找到 {expected} 条')
        with page.expect_download() as download_info:
            page.locator('#export-button').click()
        exported = Path(download_info.value.path())
        with exported.open(encoding='utf-8-sig', newline='') as file:
            rows = list(csv.reader(file))
        assert len(rows) == expected+1, 'Export must include all pages'
        assert len(rows[0]) == 8 and not any('来源' in cell or '出处' in cell for cell in rows[0])
        assert all(row[4] == '河南百通教育科技有限公司' for row in rows[1:])
        page.reload(wait_until='networkidle')
        expect(page.locator('#company-filter')).to_have_value('河南百通教育科技有限公司')
        expect(page.locator('#result-count')).to_contain_text(f'找到 {expected} 条')

        page.locator('#reset-button').click()
        page.locator('#search').fill('兔年日历素材')
        page.locator('#exact-match').check()
        expect(page.locator('#result-count')).to_contain_text('找到 1 条')
        page.locator('.record-open').click()
        expect(page.locator('#detail-content')).to_contain_text('起诉')
        expect(page.locator('#detail-content')).not_to_contain_text('S7')
        page.keyboard.press('Escape')
        page.locator('#reset-button').click()
        page.locator('#search').fill('SummerDog婚 …')
        page.locator('#exact-match').check()
        expect(page.locator('#empty-state')).to_be_visible()
        page.locator('#reset-button').click()
        # Old bookmarked filters must not restore deleted controls or shop records.
        page.goto((ROOT / 'index.html').as_uri() + '#tab=shop&source=S7&category=店铺来源提醒&sort=sources')
        expect(page.locator('#result-count')).to_contain_text(f'找到 {len(data):,} 条')
        assert page.evaluate('location.hash') == ''
        category = data[0]['category']
        page.locator('[data-category]').filter(has_text=category).click()
        category_total = sum(r['category'] == category for r in data)
        expect(page.locator('#result-count')).to_contain_text(f'找到 {category_total:,} 条')
        page.locator('#reset-button').click()
        label = next(r['labels'][0] for r in data if r['labels'])
        page.locator('#label-filter').select_option(label)
        expected = sum(label in r['labels'] for r in data)
        expect(page.locator('#result-count')).to_contain_text(f'找到 {expected:,} 条')
        page.locator('#reset-button').click()
        page.locator('#search').fill('不存在的虚构产品927416')
        page.locator('#search-button').click()
        expect(page.locator('#empty-state')).to_be_visible()
        expect(page.locator('#empty-state')).to_contain_text('未收录不代表安全')
        expect(page.locator('#export-button')).to_be_disabled()
        page.locator('#empty-reset').click()
        page.locator('#search').fill('<script>alert(1)</script>')
        page.locator('#search-button').click()
        expect(page.locator('#active-filters')).to_contain_text('<script>alert(1)</script>')
        assert page.locator('#active-filters script').count() == 0
        page.locator('#reset-button').click()
        page.keyboard.press('/')
        expect(page.locator('#search')).to_be_focused()
        page.locator('#search').fill('河南百通 2021')
        page.locator('#search-button').click()
        expect(page.locator('#result-count')).not_to_contain_text('找到 0 条')
        page.locator('#reset-button').click()

        page.set_viewport_size({'width': 390, 'height': 844})
        page.evaluate('window.scrollTo(0,0)')
        page.screenshot(path=str(args.screenshot_dir / 'mobile.png'), full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile horizontal overflow'
        page.locator('#mobile-categories').click()
        expect(page.locator('#category-list')).to_be_visible()
        page.locator('#mobile-categories').click()
        page.locator('.record-open').first.click()
        expect(page.locator('#detail-dialog')).to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Dialog horizontal overflow'
        page.screenshot(path=str(args.screenshot_dir / 'mobile-detail.png'))
        # Custom databases also support the simplified page.
        with tempfile.TemporaryDirectory() as folder:
            sample = Path(folder) / 'sample.html'
            subprocess.run([sys.executable, str(ROOT / 'scripts/build_web.py'), '--database', str(ROOT / 'examples/sample-database.json'), '--output', str(sample)], check=True)
            page.goto(sample.as_uri(), wait_until='networkidle')
            sample_count = len(json.loads((ROOT / 'examples/sample-database.json').read_text())['records'])
            expect(page.locator('#total-stat')).to_have_text(f'{sample_count:,}')
            page.locator('.record-open').first.click()
            expect(page.locator('#detail-dialog')).to_be_visible()
        assert not errors, errors
        assert not external, external
        browser.close()
    print(f'PASS: offline browser, {len(data)} records, no provenance or shop records, details, search, exact match, company/category/label filters, pagination, CSV export, legacy URL state, injection text, keyboard and mobile layout; no external requests or browser errors.')


if __name__ == '__main__':
    main()
