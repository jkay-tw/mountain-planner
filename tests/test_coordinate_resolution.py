import copy,importlib.util,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import resolve_coordinate_sources as resolver
HAS_SCIPY=importlib.util.find_spec('scipy') is not None
if HAS_SCIPY:import refine_coordinate_topology as topology

class SelectionTests(unittest.TestCase):
 def test_decimal_kilometres_remain_distinct(self):
  self.assertNotEqual(resolver.key('8.2K工寮'),resolver.key('82K工寮'))
  self.assertEqual(resolver.key('8.2K工寮'),resolver.key('8.2k 工寮'))
 def test_relative_fork_names_need_context_even_with_a_peak_suffix(self):
  self.assertTrue(resolver.GENERIC.fullmatch('南峰岔路口'))
  self.assertTrue(resolver.GENERIC.fullmatch('主北岔路'))
  self.assertFalse(resolver.GENERIC.fullmatch('火石山下營地'))
 def test_kilometre_prefix_is_search_hint_not_identity_change(self):
  n={'name':'9K 北大武山','aliases':[]};exact,aliases=resolver.search_names(n)
  self.assertIn('北大武山',aliases);self.assertEqual(exact,['9K 北大武山']);self.assertEqual(n['aliases'],[])
 def test_proximity_cluster_does_not_chain(self):
  cs=[{'id':str(i),'coordinate':[121+i*.0006,24]} for i in range(3)]
  clusters=resolver.cluster_points(cs,80)
  self.assertEqual(len(clusters),2)
  self.assertTrue(all(resolver.distance(a['coordinate'],b['coordinate'])<=80 for cl in clusters for a in cl for b in cl))
 def test_spatial_support_can_outweigh_offset_official_marker(self):
  cs=[{'id':'official','source':'official','coordinate':[121,24.001]}, {'id':'tw','source':'twmap','checked':True,'coordinate':[121,24]}, {'id':'osm','source':'osm','coordinate':[121,24.00001],'tags':{'natural':'peak'}}]
  self.assertEqual(resolver.preferred(cs)['id'],'tw')
 def test_region_uses_coherent_landmarks_not_distant_same_name(self):
  near=[[120.95,23.45],[120.96,23.46],[120.94,23.47]];far=[121.5,25.1]
  result=resolver.coherent_anchor_points([*near,far]);self.assertEqual(result,near)
 def test_dataset_preserves_ids_pilot_and_actual_source_coordinates(self):
  data=json.loads((ROOT/'data/geometry/all-route-coordinates-v1.json').read_text());base=json.loads((ROOT/'data/audits/all-route-coordinate-inventory-20261102.json').read_text());pilot=json.loads((ROOT/'data/geometry/xueshan-terrain-v1.json').read_text());byid={n['nodeId']:n for n in data['nodes']};refs={r['id']:r for r in data['references']}
  self.assertEqual(set(byid),{n['nodeId'] for n in base['nodes']});self.assertEqual(len(byid),729)
  self.assertEqual(sum(data['counts'].values()),729)
  for p in pilot['nodes']:self.assertEqual(byid[p['nodeId']]['coordinate'],p['coordinate'])
  for n in data['nodes']:
   if n['coordinate'] is None:continue
   if n.get('selectedSource'):self.assertEqual(n['coordinate'],refs[n['selectedSource']]['coordinate'])
   for other in n.get('contextNeighborIds',[]):self.assertIsNotNone(byid[other]['coordinate'])
 def test_known_name_traps_do_not_become_distant_coordinates(self):
  data=json.loads((ROOT/'data/geometry/all-route-coordinates-v1.json').read_text());nodes=data['nodes']
  for n in nodes:
   if n['name']=='新山' and n['coordinate']:self.assertLess(n['coordinate'][1],24)
   if n['name']=='大峭壁' and n['coordinate']:self.assertLess(resolver.distance(n['coordinate'],[120.957282,23.470001]),20000)

@unittest.skipUnless(HAS_SCIPY,'scipy needed only for optional offline topology analysis')
class TopologyTests(unittest.TestCase):
 def example(self,broken=False,name='三岔路口'):
  points={'1':[121,24],'2':[120.999,24],'3':[121.001,24],'4':[121,24.001]}
  nodes=[{'nodeId':str(i),'name':str(i),'coordinate':points[str(i)],'status':'selected-planning-coordinate'} for i in (2,3,4)]
  nodes.append({'nodeId':'fork','name':name,'coordinate':None,'status':'unresolved','candidateRefs':[],'neighbors':[{'nodeId':str(i),'name':str(i)} for i in (2,3,4)]})
  context={'sourceSha256':'fixture','nodes':points,'tags':{},'ways':[{'id':10,'version':1,'refs':[2,1,3]}]+([] if broken else [{'id':11,'version':1,'refs':[1,4]}])}
  return {'nodes':nodes,'references':[]},context
 def test_unique_existing_intersection_instead_of_midpoint(self):
  d,c=self.example();r=topology.refine(d,c);fork=r['nodes'][-1]
  self.assertEqual(fork['coordinate'],[121,24]);self.assertEqual(fork['selectedSource'],'osm-context:node/1')
 def test_disconnected_branches_never_gain_a_fake_junction(self):
  d,c=self.example(True);r=topology.refine(d,c);self.assertIsNone(r['nodes'][-1]['coordinate'])
 def test_camp_name_containing_peak_fork_word_is_not_a_junction(self):
  d,c=self.example(name='三叉峰下營地');r=topology.refine(d,c);self.assertIsNone(r['nodes'][-1]['coordinate'])

if __name__=='__main__':unittest.main()
