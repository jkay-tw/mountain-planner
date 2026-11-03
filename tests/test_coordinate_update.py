import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from import_coordinate_review import twd97_to_wgs84
from update_planner_terrain import missing_chains

class CoordinateUpdateTests(unittest.TestCase):
 def test_central_meridian_origin(self):
  self.assertEqual(twd97_to_wgs84(250000,0),[121.,0.])
 def test_bridges_have_explicit_order_and_stop_at_known_points(self):
  by={n:{'coordinate':[121,24] if n in 'acd' else None} for n in 'abcd'}
  edges={('a','b'):{},('b','a'):{},('b','c'):{},('c','b'):{},('c','d'):{}}
  self.assertEqual(missing_chains(by,edges),[('a','b','c')])
 def test_vehicle_and_manual_connections_do_not_enter_walking_chains(self):
  by={n:{'coordinate':[121,24] if n in 'ac' else None} for n in 'abc'}
  self.assertEqual(missing_chains(by,{('a','b'):{}}),[])
 def test_unknown_cycles_do_not_recurse_or_swallow_a_known_branch(self):
  by={n:{'coordinate':[121,24] if n in 'ae' else None} for n in 'abcde'}
  edges={p:{} for p in [('a','b'),('b','c'),('c','b'),('c','d'),('d','e')]}
  self.assertEqual(missing_chains(by,edges),[('a','b','c','d','e')])

if __name__=='__main__':unittest.main()
