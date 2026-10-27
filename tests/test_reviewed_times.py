"""Regression tests for user-confirmed standard minutes and conditional notes."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
mod_spec=importlib.util.spec_from_file_location("reviewed_times",ROOT/"tools"/"apply_reviewed_times.py")
mod=importlib.util.module_from_spec(mod_spec);mod_spec.loader.exec_module(mod)

class ReviewedTimesTests(unittest.TestCase):
    def test_20261028_review_is_complete_directional_and_has_four_alternates(self):
        ledger=ROOT/"data"/"audits"/"user_reviewed_time_overrides_20261028.json"
        d=mod.load_ledger(ledger)
        self.assertEqual(len(d),32)
        alternatives={k:v['alternate'] for k,v in d.items() if v['alternate']}
        self.assertEqual(len(alternatives),4)
        self.assertEqual(d[('南二段','向陽山','西側登山口')]['minutes'],25)
        self.assertEqual(d[('新康橫斷','西側登山口','向陽山')]['minutes'],35)
        self.assertEqual(d[('馬博拉斯橫斷','觀高坪','對觀')]['minutes'],110)
        self.assertEqual(d[('八通關越嶺','對觀','觀高坪')]['minutes'],150)
        self.assertEqual(d[('北二段','東鞍營地','無明山西峰')]['alternate'],
                         {'kind':'slow','minutes':350})
        self.assertEqual(d[('雪山西南稜','鞍部水源岔路','大劍山')]['alternate'],
                         {'kind':'heavy_pack','minutes':160})
        self.assertEqual(d[('馬博拉斯橫斷','秀姑巒山','秀姑巒山南登山口')]['alternate'],
                         {'kind':'heavy_pack','minutes':60})
        self.assertEqual(d[('八通關越嶺','觀高坪','對觀')]['officialChartMapping'],
                         'unmapped_candidate_group')

    def test_duplicate_candidate_conflict_replaced_but_no_official_approval(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            source=root/"source.json"
            source.write_text(json.dumps({'segments':[
                {'group':'北二段','from':'無明山西峰','to':'東鞍營地','go':290,'back':350},
                {'group':'北二段','from':'無明山西峰','to':'東鞍營地','go':290,'back':190}]}),
                encoding='utf-8')
            ledger=root/"ledger.json"
            ledger.write_text(json.dumps({'schemaVersion':1,'entries':[{
                'group':'北二段','from':'東鞍營地','to':'無明山西峰',
                'go':190,'back':290,'reviewStatus':'user_confirmed_standard_minutes',
                'sourceReviewStatus':'pending_independent_chart_evidence',
                'alternates':{'forward':{'kind':'slow','minutes':350}}
            }]}),encoding='utf-8')
            report=mod.apply(source,ledger,root/"output")
            self.assertEqual(report['reviewedDirectedKeys'],2)
            self.assertEqual(report['changedValues'],1)
            self.assertFalse(report['published'])
            data=json.loads((root/"output"/"reviewed_candidates.json").read_text())
            self.assertEqual([r['back'] for r in data['segments']],[190,190])
            self.assertTrue(all(r['routingEnabled'] is False for r in data['segments']))
            self.assertTrue(all(r['sourceVerification']=='pending' for r in data['segments']))

    def test_unknown_review_direction_never_creates_candidate_edge(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            a=root/"source.json";a.write_text(json.dumps({'segments':[]}),encoding='utf-8')
            b=root/"review.json";b.write_text(json.dumps({'schemaVersion':1,'entries':[{
                'group':'X','from':'A','to':'B','go':12,'back':24
            }]}),encoding='utf-8')
            with self.assertRaises(ValueError):
                mod.apply(a,b,root/"results")


if __name__=='__main__': unittest.main()
