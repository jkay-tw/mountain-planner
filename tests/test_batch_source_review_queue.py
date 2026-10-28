"""Source review queue refuses to mark candidate times as independent evidence."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('source_review_queue',
 ROOT/'tools'/'build_source_review_queue.py')
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class SourceQueueTests(unittest.TestCase):
 def test_supplemental_and_ambiguous_locations_are_flagged(self):
  with tempfile.TemporaryDirectory() as tmp:
   d=Path(tmp)
   candidate=d/'candidate.json'
   mapping=d/'mapping.json'
   candidate.write_text(json.dumps(dict(segments=[
     {'group':'A','from':'登山口','to':'B','go':30,'back':40},
     {'group':'Supplement','from':'X','to':'Y','go':10,'back':15}
   ])),encoding='utf-8')
   mapping.write_text(json.dumps(dict(mapping=[
     dict(candidateGroup='A',officialChartId='G02'),
     dict(candidateGroup='Supplement',officialChartId=None)
   ])),encoding='utf-8')
   report=mod.build(candidate,mapping,d/'report')
   self.assertEqual(report['totalDirectedRows'],4)
   self.assertEqual(report['sourceVerified'],0)
   self.assertFalse(report['publicationEligible'])
   csv=(d/'report'/'source_review_queue.csv').read_text(encoding='utf-8-sig')
   self.assertIn('supplemental_group_unmapped',csv)
   self.assertIn('generic_node_needs_identity_review',csv)
   self.assertIn('pending',csv)
   self.assertIn('G02',csv)

 def test_unknown_group_fails_closed(self):
  with tempfile.TemporaryDirectory() as tmp:
   d=Path(tmp)
   source=d/'s.json';source.write_text(json.dumps(dict(segments=[
    {'group':'Missing','from':'A','to':'B','go':2,'back':4}
   ])),encoding='utf-8')
   mapping=d/'m.json';mapping.write_text(json.dumps(dict(mapping=[])),encoding='utf-8')
   with self.assertRaises(ValueError):
    mod.build(source,mapping,d/'out')

 def test_official_source_catalog_links_19_chart_families_with_updated_versions(self):
  catalog=json.loads((ROOT/'data'/'official_chart_sources.json').read_text(encoding='utf-8'))
  charts={x['id']:x for x in catalog['charts']}
  self.assertEqual(set(charts),{f'G{x:02d}' for x in range(2,21)})
  self.assertEqual(charts['G07']['chartURL'],'https://www.sunriver.com.tw/images/hiking/G07_hiking_new.jpg')
  self.assertEqual(charts['G09']['chartURL'],'https://www.sunriver.com.tw/images/hiking/G09_hiking_new.jpg')
  self.assertTrue(charts['G07']['updateChartURL'].endswith('G07_hiking_new3.jpg'))
  self.assertTrue(charts['G09']['updateChartURL'].endswith('G09_hiking_new3.jpg'))
  self.assertTrue(all(not x['perDirectionVerified'] for x in charts.values()))
  with tempfile.TemporaryDirectory() as tmp:
   folder=Path(tmp)
   candidate=folder/'source.json';candidate.write_text(json.dumps({'segments':[
      {'group':'A','from':'A1','to':'A2','go':20,'back':30}]}),encoding='utf-8')
   mapping=folder/'groups.json';mapping.write_text(json.dumps({'mapping':[{
      'candidateGroup':'A','officialChartId':'G07'}]}),encoding='utf-8')
   mod.build(candidate,mapping,folder/'reports',ROOT/'data'/'official_chart_sources.json')
   csv=(folder/'reports'/'source_review_queue.csv').read_text(encoding='utf-8-sig')
   self.assertIn('G07_hiking_new3.jpg',csv)
   self.assertIn('pending',csv)

if __name__=='__main__':unittest.main()
