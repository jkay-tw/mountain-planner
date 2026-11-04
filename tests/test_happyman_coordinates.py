import json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from import_happyman_points import labels
from recheck_happyman_coordinates import HIGH,BASE,peak_roles
from resolve_coordinate_sources import distance,GENERIC

class HappymanTests(unittest.TestCase):
 def test_metadata_cleaning_preserves_roles_and_kilometres(self):
  self.assertIn('志佳陽基點峰',labels('108-志佳陽基點峰3289M'))
  self.assertIn('志佳陽大山最高峰',labels('020志佳陽大山最高峰, 3345 M'))
  self.assertIn('4.8K岔路口',labels('4.8K岔路口'))
  self.assertIn('32K登山口',labels('32K登山口'))
  self.assertIn('12營地',labels('12營地'))
  self.assertIn('3199峰',labels('3199峰'))
  self.assertIn('3199峰',labels('042-3199峰'))
  self.assertIn('2920營地',labels('024- 2920營地'))
 def test_lowest_saddle_requires_multiple_neighbors(self):
  self.assertTrue(GENERIC.fullmatch('最低鞍部'))
 def test_two_peak_roles_are_distinct_and_use_actual_source_points(self):
  d=json.loads((ROOT/'data/geometry/all-route-coordinates-v1.json').read_text());nodes={n['nodeId']:n for n in d['nodes']};refs={p['id']:p for p in d['references']}
  h,b=nodes[HIGH],nodes[BASE]
  self.assertEqual(h['reviewedElevationMeters'],3345);self.assertEqual(b['reviewedElevationMeters'],3289)
  self.assertLess(h['coordinate'][0],b['coordinate'][0]);self.assertGreater(h['coordinate'][1],b['coordinate'][1]);self.assertTrue(390<distance(h['coordinate'],b['coordinate'])<420)
  for n in (h,b):
   self.assertEqual(n['coordinate'],refs[n['selectedSource']]['coordinate'])
   source=[refs[i] for i in n['sourceRefs'] if refs[i]['source']=='happyman']
   self.assertTrue(source)
   self.assertLess(min(distance(n['coordinate'],p['coordinate']) for p in source),5)
   self.assertTrue(all(('最高' in p['rawName'] or '主峰' in p['rawName']) if n is h else '基點' in p['rawName'] for p in source))
  self.assertGreater(h['roleReview']['previousDisplacementMeters'],390)
  self.assertLess(distance(h['roleReview']['previousCoordinate'],b['coordinate']),5)
 def test_source_snapshot_and_count_reconciliation(self):
  d=json.loads((ROOT/'data/geometry/all-route-coordinates-v1.json').read_text());s=json.loads((ROOT/'data/geometry/sources/happyman-coordinate-reference-20240813.json').read_text())
  self.assertEqual(s['source']['md5'],'8262e5acb7650ed064c8a3499fc39091');self.assertEqual(s['source']['rawNamedPoiCount'],207518)
  self.assertEqual(d['counts']['selected-planning-coordinate'],366+d['recheck']['addedCount']+d.get('nearbyRecheck',{}).get('addedCount',0));self.assertEqual(sum(d['counts'].values()),729)
  high,base,_=peak_roles(s['points']);self.assertTrue(high);self.assertTrue(base)
  self.assertEqual(len(s['points']),len({p['id'] for p in s['points']}))
  for p in s['points']:self.assertEqual(p['sourceFileSha256'],s['source']['sha256'])
 def test_unconnected_lake_is_not_selected_by_name_alone(self):
  d=json.loads((ROOT/'data/geometry/all-route-coordinates-v1.json').read_text());n=next(n for n in d['nodes'] if n['nodeId']=='node:bddbd00b5a0ab63bf4ec');self.assertIsNone(n['coordinate'])

if __name__=='__main__':unittest.main()
