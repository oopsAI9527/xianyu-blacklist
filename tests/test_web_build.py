import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('build_web', ROOT / 'scripts/build_web.py')
build_web = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_web)


class WebBuildTests(unittest.TestCase):
    def test_public_view_omits_provenance_and_shops_without_changing_database(self):
        record = {'id':'R1', 'name':'示例课程', 'category':'课程', 'sources':[{'document':'S1'}],
                  'risk_note':'私人附件备注', 'object_type':'课程', 'labels':['待核对']}
        database = {'source_labels':{'S1':'私人附件'}, 'records':[record,
                    {'name':'示例店铺', 'object_type':'店铺'},
                    {'name':'其他店铺线索', 'category':'店铺来源提醒'}]}
        view = build_web.web_data(database)
        self.assertEqual(view['origin'], '来自于网络收集')
        self.assertEqual(view['records'], [{'id':'R1', 'name':'示例课程', 'category':'课程',
                                          'object_type':'课程', 'labels':['待核对']}])
        self.assertNotIn('source_labels', view)
        self.assertEqual(len(database['records']), 3)
        self.assertIn('sources', record)

    def test_distributed_page_matches_source(self):
        self.assertEqual((ROOT / 'index.html').read_text(encoding='utf-8'), build_web.render())

    def test_database_is_inert_json(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'data.json'
            value = '</script><img src=x onerror=alert(1)>/*__APP__*/&\u2028'
            path.write_text(json.dumps({'records':[{'name':value}]}), encoding='utf-8')
            html = build_web.render(database=path)
            payload = html.split('<script id="risk-data" type="application/json">',1)[1].split('</script>',1)[0]
            self.assertNotIn('<',payload)
            self.assertEqual(json.loads(payload)['records'][0]['name'], value)


if __name__ == '__main__':
    unittest.main()
