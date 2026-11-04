import copy,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from apply_happyman_nearby_review import apply_review,valid_anchor_path
from resolve_coordinate_sources import distance

class NearbyReviewTests(unittest.TestCase):
 def fixture(self):
  base={'nodes':[{'nodeId':'a','name':'anchor','coordinate':[121,24],'status':'selected-planning-coordinate'},{'nodeId':'n','name':'new','groups':['g'],'coordinate':None}], 'sourceCatalog':[{'id':'happyman','sha256':'test'}],'references':[],'counts':{'selected-planning-coordinate':1,'unresolved':1}}
  point={'id':'h:1','rawName':'new recorded','coordinate':[121.0001,24],'sourceFileSha256':'test'}
  discovery={'nodes':[{'nodeId':'n','groups':['g'],'candidates':[{'sourceId':'h:1','coordinate':point['coordinate']}],'anchors':[{'nodeId':'a','name':'anchor','coordinate':[121,24],'status':'selected-planning-coordinate','minutes':1,'hops':1,'branch':'a'}]}],'points':[point]}
  choices=[{'nodeId':'n','expectedName':'new','sourceId':'h:1','expectedRawName':'new recorded','rationale':'explicit fixture review'}]
  return base,discovery,choices,{'n':{'a':1},'a':{'n':1}}
 def test_accepts_actual_point_and_preserves_original(self):
  b,d,c,g=self.fixture();original=copy.deepcopy(b);r,_,_=apply_review(b,d,c,g)
  self.assertEqual(b,original);self.assertEqual(r['nodes'][0],b['nodes'][0]);self.assertEqual(r['nodes'][1]['coordinate'],d['points'][0]['coordinate'])
 def test_rejects_existing_coordinate_relocation(self):
  b,d,c,g=self.fixture();b['nodes'][1]['coordinate']=[121,24]
  with self.assertRaises(ValueError):apply_review(b,d,c,g)
 def test_rejects_changed_source_raw_label(self):
  b,d,c,g=self.fixture();d['points'][0]['rawName']='different'
  with self.assertRaises(ValueError):apply_review(b,d,c,g)
 def test_rejects_invented_or_changed_walking_path(self):
  b,d,c,g=self.fixture();g['n']['a']=2
  with self.assertRaises(ValueError):apply_review(b,d,c,g)
 def test_rejects_unlocated_context(self):
  b,d,c,g=self.fixture();b['nodes'][0]['coordinate']=None
  with self.assertRaises(ValueError):apply_review(b,d,c,g)
 def test_dataset_keeps_roles_and_numeric_identity_differences_visible(self):
  d=json.loads((ROOT/'data/geometry/all-route-coordinates-v1.json').read_text());nodes=d['nodes'];refs={p['id']:p for p in d['references']};new=[n for n in nodes if n.get('selectionMethod')=='happyman-similar-name-with-reviewed-route-context']
  self.assertEqual(len(new),d['nearbyRecheck']['addedCount']);self.assertEqual(len({n['nodeId'] for n in nodes}),729)
  for n in new:
   self.assertEqual(n['coordinate'],refs[n['selectedSource']]['coordinate']);self.assertTrue(n['nameReview']['rationale']);self.assertTrue(n['routeContext'])
  find=lambda name:next(n for n in new if n['name']==name)
  self.assertEqual(find('屏風山新登山口')['nameReview']['sourceRawName'],'屏風新路登')
  self.assertEqual(find('石山秀湖')['nameReview']['sourceRawName'],'123 鬼湖(石山秀湖)')
  self.assertEqual(find('巴紗拉雲山屋毀損')['nameReview']['sourceRawName'],'巴紗拉雲山屋')
  self.assertEqual(find('156.5K登山口')['nameReview']['sourceRawName'],'戒茂斯山登山口（南橫156.5K）')
  for name in ['28.5K登山口','27.5K林道登山口','松針營地']:
   self.assertIsNone(next(n for n in nodes if n['name']==name)['coordinate'])

if __name__=='__main__':unittest.main()
