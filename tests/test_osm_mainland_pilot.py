import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from build_osm_mainland_pilot import coastline_rings, inside

class CoastlineTests(unittest.TestCase):
    def test_join_by_exact_identity_and_select_largest_ring(self):
        coords={1:[0,0],2:[2,0],3:[2,2],4:[0,2],5:[5,5],6:[5.1,5],7:[5,5.1]}
        ring,stats=coastline_rings([[1,2,3],[1,4,3],[5,6,7,5]],coords)
        self.assertEqual(ring[0],ring[-1]);self.assertEqual(stats['closedRings'],2)
        self.assertTrue(inside([1,1],ring));self.assertFalse(inside([5,5],ring))
    def test_missing_closure_never_gains_a_straight_bridge(self):
        with self.assertRaises(ValueError):coastline_rings([[1,2,3]],{1:[0,0],2:[2,0],3:[2,2]})
    def test_nearby_different_ids_are_not_merged(self):
        with self.assertRaises(ValueError):coastline_rings([[1,2,3],[4,5,6]],{1:[0,0],2:[2,0],3:[2,2],4:[2,2],5:[0,2],6:[0,0]})
