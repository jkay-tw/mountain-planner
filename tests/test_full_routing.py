import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from build_full_terrain import Network
from scipy.sparse.csgraph import dijkstra
class FullRoutingTests(unittest.TestCase):
 def raw(self):
  return {'nodes':{'1':[121,24],'2':[121.001,24],'3':[121.00101,24],'4':[121.002,24],'5':[121.0005,24.00001]},'blockedNodeIds':[5],
   'ways':[{'id':1,'refs':[1,2],'tags':{}},{'id':2,'refs':[3,4],'tags':{}},{'id':3,'refs':[1,5,2],'tags':{}}]}
 def test_projections_split_existing_edges_without_connecting_nearby_components_or_blocked_vertex(self):
  n=Network(self.raw());a=n.snap({'nodeId':'a','coordinate':[121.0005,24.00001]});b=n.snap({'nodeId':'b','coordinate':[121.0015,24]});n.compile()
  self.assertAlmostEqual(n.anchors['a']['coordinate'][1],24)
  self.assertNotEqual(n.anchors['a'].get('osmNodeId'),'5')
  self.assertEqual(dijkstra(n.graph,indices=a)[b],float('inf'))
 def test_foot_direction_and_duplicate_edges_do_not_reverse_or_double_distance(self):
  raw=self.raw();raw['ways']=[{'id':1,'refs':[1,2],'tags':{'oneway:foot':'yes'}},{'id':2,'refs':[1,2],'tags':{'oneway:foot':'yes'}}]
  n=Network(raw);a=n.snap({'nodeId':'a','coordinate':[121,24]});b=n.snap({'nodeId':'b','coordinate':[121.001,24]});n.compile()
  cost=dijkstra(n.graph,indices=a)[b]
  self.assertTrue(100<cost<103)
  self.assertEqual(dijkstra(n.graph,indices=b)[a],float('inf'))
  self.assertFalse(n.reversible([a,b]))
 def test_two_identical_projections_share_anchor_and_no_120m_fallback_is_invented(self):
  n=Network(self.raw());a=n.snap({'nodeId':'a','coordinate':[121.0005,24]});b=n.snap({'nodeId':'b','coordinate':[121.0005,24]})
  self.assertEqual(a,b);self.assertIsNone(n.snap({'nodeId':'far','coordinate':[122,25]}))
if __name__=='__main__':unittest.main()
