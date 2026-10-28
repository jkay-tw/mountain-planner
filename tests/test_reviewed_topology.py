import copy
import importlib.util
import json
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('reviewed_topology',ROOT/'tools/apply_reviewed_topology.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class TopologyReviewTests(unittest.TestCase):
    def setUp(self):self.ledger=json.loads((ROOT/'data/audits/user_reviewed_topology_20261028.json').read_text())
    def source(self):return {'segments':[copy.deepcopy(d['match']) for d in self.ledger['entries']]}
    def test_scoped_corrections_remove_six_invalid_rows_and_keep_confirmed_triangle(self):
        raw=self.source();raw['segments'] += [dict(group='大霸聖稜武陵四秀',**{'from':'三叉營地','to':'桃山山屋'},go=1,back=2),dict(group='丹大山列',**{'from':'廢棄工寮','to':'鐵軌岔路'},go=180,back=180)]
        before=copy.deepcopy(raw);out,report=mod.apply_review(raw,self.ledger)
        self.assertEqual(raw,before);self.assertEqual(report['excludedRows'],6)
        lines=out['segments']
        self.assertIn(dict(group='丹大山列',**{'from':'廢棄工寮','to':'鐵軌岔路'},go=180,back=180),lines)
        self.assertTrue(any(r['group']=='大霸聖稜武陵四秀' and r['from']=='三叉營地' for r in lines))
        self.assertTrue(any(r['from']=='東巒大山' and r['to']=='岔路' and r['go']==50 for r in lines))
        self.assertTrue(any(r['from']=='東北鞍營地' and r['to']=='東郡大山' and r['go']==5 for r in lines))
        self.assertTrue(any(r['from']=='烏達佩山' and r['to']=='岔路' and (r['go'],r['back'])==(5,10) for r in lines))
        triangle=next(r for r in lines if r['from']=='主北三岔路')
        self.assertEqual((triangle['go'],triangle['back']),(40,30));self.assertFalse(triangle['routingEnabled'])
        vehicle=next(r for r in lines if r['from']=='合歡山管理站')
        self.assertEqual(vehicle['travelMode'],'vehicle');self.assertEqual(vehicle['go'],2)
        self.assertFalse(out['publicationEligible'])
    def test_unknown_or_changed_source_record_fails_closed(self):
        raw=self.source();raw['segments'][0]['go']=3
        with self.assertRaises(ValueError):mod.apply_review(raw,self.ledger)
    def test_repeat_application_does_not_duplicate_replacement_or_drop_more_rows(self):
        out,_=mod.apply_review(self.source(),self.ledger);again,report=mod.apply_review(out,self.ledger)
        self.assertEqual(out,again);self.assertTrue(report['alreadyApplied'])
