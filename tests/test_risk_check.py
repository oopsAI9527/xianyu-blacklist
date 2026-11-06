import contextlib
import csv
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('risk_check',ROOT/'scripts'/'risk_check.py')
rc=importlib.util.module_from_spec(spec);spec.loader.exec_module(rc)


def record(name='星桥示例课程',company='虚构示例教育公司',rid='BL0001'):
    return dict(id=rid,name=name,variants=[name],category='教育课程',object_type='名称线索',
                companies=[company] if company else [],labels=['来源提示待核对'],registrations=['DEMO-001'],
                verification='unverified',risk_note='示例记录，未核验',
                sources=[dict(document='sample.csv',sheet='CSV',cell='A2',original_name=name,label='来源提示待核对',company=company,registration='DEMO-001')])


class RiskTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)
        self.db=dict(schema_version=1,updated_at='2026-10-31',records=[record()])
        self.dbfile=self.path/'data.json';self.dbfile.write_text(json.dumps(self.db,ensure_ascii=False))

    def cli(self,*args):
        with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):return rc.main(args)

    def test_exact_and_company_relationship(self):
        a=rc.query_one(self.db,'星桥示例课程');b=rc.query_one(self.db,'虚构示例教育公司')
        self.assertEqual(a['status'],'matched');self.assertEqual(a['matches'][0]['match_type'],'exact_name')
        self.assertEqual(b['matches'][0]['match_type'],'exact_company')

    def test_partial_is_only_candidate(self):
        a=rc.query_one(self.db,'星桥示例课程全套资料')
        self.assertEqual(a['status'],'candidates');self.assertEqual(a['matches'][0]['match_type'],'partial_candidate')

    def test_short_keywords_do_not_match_substrings(self):
        db=dict(self.db,records=[record('金融','',rid='BL1')])
        self.assertEqual(rc.query_one(db,'金融数据分析')['status'],'no_match')
        self.assertEqual(rc.query_one(db,'金融')['status'],'matched')

    def test_no_match_is_not_safe(self):
        result=rc.query_one(self.db,'未收录的虚构商品')
        self.assertEqual(result['status'],'no_match');self.assertIn('仍需核对',result['guidance'])
        self.assertNotIn('safe',result)

    def test_normalization_preserves_distinct_names(self):
        self.assertEqual(rc.normalize('  ＡＢＣ\u202e  Tool '),rc.normalize('abc Tool'))
        self.assertNotEqual(rc.normalize('星桥'),rc.normalize('星侨'))

    def test_same_name_preserves_two_companies_and_sources(self):
        a=record('Demo Tool','公司甲');b=record('ＤＥＭＯ Tool','公司乙',rid='BL0002')
        b['sources'][0]['cell']='B3';b['category']='软件工具';b['registrations']=['DEMO-002']
        merged=rc.merge_records([a,b])
        self.assertEqual(len(merged),1);self.assertEqual(len(merged[0]['sources']),2)
        self.assertEqual(merged[0]['companies'],['公司甲','公司乙'])
        self.assertEqual(merged[0]['registrations'],['DEMO-001','DEMO-002'])
        self.assertEqual(set(merged[0]['category_variants']),{'教育课程','软件工具'})

    def test_duplicate_ids_are_reassigned_for_different_names(self):
        result=rc.merge_records([record('作品甲'),record('作品乙')])
        self.assertEqual(len({r['id'] for r in result}),2)

    def test_import_blank_rows_and_ambiguous_headers(self):
        p=self.path/'sample.csv';p.write_text('名称,公司,标签,标签\n示例一,公司甲,提示甲,提示乙\n,公司乙,,\n',encoding='utf-8')
        out=self.path/'out.json'
        self.assertEqual(self.cli('build','--input',str(p),'--name-column','名称','--label-column','标签','--output',str(out)),2)
        self.assertEqual(self.cli('build','--input',str(p),'--name-column','名称','--company-column','公司','--label-column','#4','--output',str(out)),0)
        data=rc.load_db(out);self.assertEqual(len(data['records']),1)
        self.assertEqual(data['records'][0]['labels'],['提示乙'])
        self.assertEqual(data['records'][0]['sources'][0]['cell'],'A2')
        self.assertNotIn(str(self.path),out.read_text())

    def test_html_spans_preserve_cell_coordinates_and_ignore_scripts(self):
        p=self.path/'index.html';p.write_text('<table><tr><th rowspan="2">编号</th><th>名称</th></tr><tr><td>作品<script>not run</script>甲</td></tr></table>')
        rows=rc.source_tables(p)[0][2]
        self.assertEqual(rows,[['编号','名称'],['','作品甲']])
        out=self.path/'html.json'
        self.assertEqual(self.cli('build','--input',str(p),'--name-column','名称','--output',str(out)),0)
        self.assertEqual(rc.load_db(out)['records'][0]['sources'][0]['cell'],'B2')

    def test_formula_text_stays_data_and_export_is_escaped(self):
        self.assertEqual(rc.safe_sheet_cell(' \t=HYPERLINK("x")'),'\' \t=HYPERLINK("x")')
        self.assertEqual(rc.safe_sheet_cell('正常名称'),'正常名称')
        self.assertIn('&lt;script&gt;',rc.md('<script>'))

    def test_batch_query_csv_column(self):
        p=self.path/'candidates.csv';p.write_text('其他,商品标题\n备注,星桥示例课程\n备注,陌生商品\n')
        out=self.path/'query.json'
        self.assertEqual(self.cli('query','--database',str(self.dbfile),'--input',str(p),'--field','商品标题','--output',str(out)),0)
        data=json.loads(out.read_text());self.assertEqual([r['status'] for r in data['results']],['matched','no_match'])
        self.assertEqual(data['updated_at'],'2026-10-31')

    def test_limit_reports_total(self):
        db=dict(self.db,records=[record('示例课程甲','公司',rid='A'),record('示例课程乙','公司',rid='B')])
        result=rc.query_one(db,'示例课程',limit=1)
        self.assertEqual(result['total_matches'],2);self.assertTrue(result['truncated'])

    def test_existing_output_not_overwritten(self):
        out=self.path/'result.json';out.write_text('original')
        self.assertEqual(self.cli('export','--database',str(self.dbfile),'--format','json','--output',str(out)),2)
        self.assertEqual(out.read_text(),'original')

    def test_csv_and_markdown_export(self):
        out=self.path/'result.csv'
        self.assertEqual(self.cli('export','--database',str(self.dbfile),'--format','csv','--output',str(out)),0)
        with out.open(encoding='utf-8-sig',newline='') as f:rows=list(csv.reader(f))
        self.assertEqual(rows[1][1],'星桥示例课程')
        self.assertIn('sample.csv',rc.export_markdown(self.db))

    def test_missing_mapping_does_not_silently_create_empty_db(self):
        p=self.path/'wrong.csv';p.write_text('编号,其他\n1,文本\n')
        self.assertEqual(self.cli('build','--input',str(p),'--name-column','名称','--output',str(self.path/'out.json')),2)

    def test_invalid_database_rejected(self):
        bad=self.path/'bad.json';bad.write_text(json.dumps(dict(self.db,records=[record(),record()])))
        with self.assertRaises(ValueError):rc.load_db(bad)

    @unittest.skipUnless(__import__('importlib').util.find_spec('openpyxl'),'optional openpyxl not installed')
    def test_excel_roundtrip_and_long_field_preservation(self):
        import openpyxl
        r=record();r['registrations']=['X'*35000]
        out=self.path/'out.xlsx';rc.export_xlsx(dict(self.db,records=[r]),out)
        w=openpyxl.load_workbook(out)
        self.assertEqual(w['名单总表']['B2'].value,'星桥示例课程')
        chunks=[row[4] for row in list(w['长字段全文'].values)[1:]]
        self.assertEqual(''.join(chunks),'X'*35000)
        self.assertTrue(w['名单总表'].tables);self.assertEqual(w['名单总表'].freeze_panes,'C2')
        p=self.path/'input.xlsx';x=openpyxl.Workbook();s=x.active
        s.append(['名称','公司']);s.append(['示例作品','虚构公司']);x.save(p)
        self.assertEqual(rc.source_tables(p)[0][2][1],['示例作品','虚构公司'])

    @unittest.skipUnless(__import__('importlib').util.find_spec('openpyxl'),'optional openpyxl not installed')
    def test_excel_formula_and_long_source_remain_text(self):
        import openpyxl
        r=record('=1+1');r['sources'][0]['label']='长'*35000
        out=self.path/'formula.xlsx';rc.export_xlsx(dict(self.db,records=[r]),out)
        w=openpyxl.load_workbook(out,data_only=False)
        self.assertEqual(w['名单总表']['B2'].value,'=1+1')
        self.assertEqual(w['名单总表']['B2'].data_type,'s')
        chunks=[row[4] for row in list(w['长字段全文'].values)[1:]]
        self.assertEqual(''.join(chunks),'长'*35000)


if __name__=='__main__':unittest.main()


class HandlingTests(unittest.TestCase):
    def setUp(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('handling', ROOT / 'scripts/handling.py')
        self.h = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.h)

    def test_levels_follow_status_and_labels(self):
        red = self.h.advise('matched', {'category':'商业管理与通识成长', 'labels':['售假'], 'object_type':'版权词／人物机构'})
        self.assertEqual((red['level'], red['score']), ('red', 80))
        self.assertTrue(any('售假' in m for m in red['meaning']))
        self.assertIn('闲鱼', red['platforms'])
        amber = self.h.advise('candidates', {'category':'未知领域', 'labels':['售假']})
        self.assertEqual(amber['level'], 'amber')
        self.assertTrue(amber['actions'][0].startswith('名字像不等于同一个'))
        green = self.h.advise('no_match')
        self.assertEqual((green['level'], green['score'], green['platforms'], green['meaning']), ('green', 10, {}, []))
        registered = self.h.advise('matched', {'category':'设计素材与字体', 'registrations':['X-1']})
        self.assertEqual(registered['level'], 'red')
        self.assertTrue(any('登记' in m for m in registered['meaning']))

    def test_query_and_markdown_include_handling(self):
        db = rc.load_db(ROOT / 'examples/sample-database.json')
        result = rc.query_one(db, '未收录的虚构商品')
        self.assertEqual(result['handling']['level'], 'green')
        text = rc.query_markdown(dict(updated_at='2026-01-01', results=[result]))
        self.assertIn('运营处置建议', text)
        self.assertIn('绿灯', text)
