import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


disguise = load('disguise')
rc = load('risk_check')
lint_listing = load('lint_listing')
import_slang = load('import_slang')
build_web = load('build_web')
screen = load('screen_products')

SAMPLE = {'schema_version': 1, 'updated_at': '2026-01-01', 'records': [
    {'id': 'T1', 'name': '粉笔课堂', 'category': '公考考证与职业考试', 'object_type': '版权词／人物机构', 'labels': ['售假']},
    {'id': 'T2', 'name': '可复制的领导力', 'category': '商业管理与通识成长', 'object_type': '版权词／人物机构', 'labels': ['售假']},
    {'id': 'T3', 'name': '星桥示例课程', 'category': '教育课程（领域待补充）', 'companies': ['虚构示例教育公司']},
    {'id': 'T4', 'name': '粉笔', 'category': '公考考证与职业考试', 'object_type': '版权词／人物机构'},
]}


class DisguiseTests(unittest.TestCase):
    def test_pinyin_normalisation(self):
        self.assertEqual(disguise.tokenize('粉bi课堂'), ['fen', 'bi', 'ke', 'tang'])
        self.assertEqual(disguise.tokenize('粉 笔 课 堂'), ['fen', 'bi', 'ke', 'tang'])
        self.assertEqual(disguise.tokenize('fenbi课堂'), ['fen', 'bi', 'ke', 'tang'])
        self.assertEqual(disguise.tokenize('fbkt'), ['fbkt'])
        self.assertEqual(disguise.forms('粉笔课堂')['initials'], 'fbkt')

    def test_disguised_matching_and_guards(self):
        index = disguise.index_records(SAMPLE['records'])
        hit = lambda q: [r['name'] for r, _ in disguise.find_disguised(q, index)]
        self.assertEqual(hit('fb'), [])
        self.assertEqual(hit('fbkt'), ['粉笔课堂'])
        for q in ('粉bi课堂', 'fenbi课堂', '粉 笔 课 堂', '粉.笔.课.堂', '复制领导力', 'kfzdldl'):
            self.assertIn(q and hit(q)[0], ('粉笔课堂', '可复制的领导力'), q)
        self.assertEqual(hit('芬比'), [])      # 纯汉字同音短名不命中
        self.assertEqual(hit('fenbi'), [])     # 纯拼音两音节不命中
        self.assertEqual(hit('课堂'), [])

    def test_query_one_reports_disguised_status(self):
        result = rc.query_one(SAMPLE, 'fbkt')
        self.assertEqual(result['status'], 'disguised')
        self.assertEqual(result['matches'][0]['match_type'], 'disguised_candidate')
        self.assertEqual(result['handling']['level'], 'amber')
        self.assertTrue(any('伪装' in m for m in result['handling']['meaning']))
        self.assertIn('疑似伪装命中', rc.query_markdown(dict(updated_at='x', results=[result])))


class SlangImportTests(unittest.TestCase):
    def test_hard_policy_dropped_grey_marked(self):
        self.assertEqual(import_slang.classify(['裸聊服务', '约聊'])[0], 'hard')
        self.assertEqual(import_slang.classify(['高仿包'])[0], 'grey')
        self.assertEqual(import_slang.classify(['克劳德会员'])[0], '')
        with tempfile.TemporaryDirectory() as folder:
            a = Path(folder) / 'a.json'
            a.write_text(json.dumps([
                {'standardName': '裸聊服务', 'category': 'ai-services', 'slangVariants': ['裸聊车位'], 'liveness': 'active'},
                {'standardName': '测试会员', 'category': 'ai-services', 'slangVariants': ['测试会员代充', 'x', 'ab1'], 'liveness': 'killed', 'riskLevel': 'warning', 'successorSlang': ['测试学习位']},
                {'standardName': '实物手机', 'category': 'digital-phone', 'slangVariants': ['卡贴机']},
            ], ensure_ascii=False), encoding='utf-8')
            h = Path(folder) / 'h.json'
            h.write_text(json.dumps({'categories': [{'id': 'games', 'name': '游戏账号', 'entries': {'原神': ['原批', 'ys', '测试会员代充']}}]}, ensure_ascii=False), encoding='utf-8')
            data, dropped = import_slang.build(a, h)
        names = [t['name'] for t in data['terms']]
        self.assertEqual(names, ['测试会员', '原神'])
        self.assertEqual(dropped, [('裸聊服务', '色情/特殊服务')])
        self.assertEqual(data['terms'][0]['variants'], ['测试会员代充'])
        self.assertEqual(data['terms'][1]['variants'], ['原批'])   # 短变体与已覆盖变体去掉

    def test_shipped_terms_are_virtual_only(self):
        data = json.loads((ROOT / 'assets/slang-terms.json').read_text(encoding='utf-8'))
        self.assertTrue(data['terms'])
        self.assertTrue(all(t['category'] in set(import_slang.AWESOME_CATEGORIES) | import_slang.HELPER_CATEGORIES for t in data['terms']))
        self.assertFalse(any(import_slang.classify([t['name'], *t['variants']])[0] == 'hard' for t in data['terms']))


class LintTests(unittest.TestCase):
    def setUp(self):
        self.slang = {'terms': [
            {'name': '网盘课件秒发', 'variants': ['网盘秒发'], 'category_name': '虚拟资源', 'liveness': 'watching', 'risk': 'warning', 'successors': ['电子笔记自提'], 'policy': ''},
            {'name': '高危服务', 'variants': ['高危暗号'], 'category_name': '测试', 'liveness': 'killed', 'risk': 'danger', 'successors': ['不该出现'], 'policy': ''},
        ]}
        self.banned = json.loads((ROOT / 'assets/banned-terms.json').read_text(encoding='utf-8'))

    def test_three_kinds_of_hits_and_advice(self):
        res = lint_listing.lint(SAMPLE, '粉bi公考全套网盘秒发 高危暗号 星桥示例课程', slang=self.slang, banned=self.banned)
        kinds = {(h['kind'], h['fragment']): h for h in res['hits']}
        self.assertIn(('copyright', '粉bi'), kinds)
        self.assertEqual(kinds[('copyright', '粉bi')]['match_type'], 'disguised_candidate')
        self.assertEqual(kinds[('copyright', '星桥示例课程')]['match_type'], 'exact_name')
        self.assertIn(('banned', '全套'), kinds)
        self.assertIn('电子笔记自提', kinds[('slang', '网盘秒发')]['advice'])
        self.assertNotIn('不该出现', kinds[('slang', '高危暗号')]['advice'])
        self.assertIn('不提供替代词', kinds[('slang', '高危暗号')]['advice'])
        self.assertEqual(res['level'], 'red')
        self.assertEqual(res['handling']['headline'], lint_listing.handling.load_rules()['status']['matched']['headline'])
        md = lint_listing.markdown(dict(updated_at='x', results=[res]))
        self.assertIn('| 粉bi |', md)
        self.assertEqual(lint_listing.lint(SAMPLE, '自制学习计划表', slang=self.slang, banned=self.banned)['level'], 'green')
        amber = lint_listing.lint(SAMPLE, '永久有效的学习计划', slang=self.slang, banned=self.banned)
        self.assertEqual((amber['level'], amber['hits'][0]['group']), ('amber', 'extreme'))

    def test_screen_products_includes_lint(self):
        report = screen.screen(SAMPLE, [{'id': 'P1', 'title': '粉bi课堂全套'}, {'id': 'P2', 'title': '自制学习计划'}])
        self.assertEqual(report['results'][0]['lint']['level'], 'red')
        self.assertEqual([h['fragment'] for h in report['results'][0]['lint']['hits']][:2], ['粉bi课堂', '全套'])
        self.assertNotIn('handling', report['results'][0]['lint'])
        self.assertEqual(report['results'][1]['lint']['level'], 'green')
        self.assertEqual(report['results'][0]['list_status'], 'disguised')


class WebEmbedTests(unittest.TestCase):
    def test_embedded_tables_are_inert_json(self):
        html = build_web.render()
        for sid in ('slang-terms', 'banned-terms', 'pinyin-table'):
            payload = html.split(f'<script id="{sid}" type="application/json">', 1)[1].split('</script>', 1)[0]
            self.assertNotIn('<', payload)
            self.assertTrue(json.loads(payload))


if __name__ == '__main__':
    unittest.main()
