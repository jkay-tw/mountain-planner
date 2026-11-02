import importlib.util,json,struct,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
import build_xueshan_terrain as terrain
class TerrainTests(unittest.TestCase):
 def test_bilinear_signed_grid_orientation_and_void(self):
  h=terrain.Hgt(struct.pack('>4h',100,200,300,400))
  self.assertEqual(h.sample([121.5,24.5]),250)
  self.assertEqual(h.sample([121,25]),100)
  with self.assertRaises(ValueError):terrain.Hgt(struct.pack('>4h',100,-32768,300,400)).sample([121.5,24.5])
 def test_resampling_preserves_endpoints_and_distance(self):
  coords=[[121.23,24.38],[121.231,24.381],[121.232,24.381]];p=terrain.resample(coords)
  self.assertEqual(p[0][1],coords[0]);self.assertEqual(p[-1][1],coords[-1]);self.assertTrue(all(b[0]-a[0]<=30.000001 for a,b in zip(p,p[1:])))
 def test_source_and_profile_joins(self):
  d=json.loads((ROOT/'data/geometry/xueshan-terrain-v1.json').read_text());self.assertEqual(d['terrainSource']['gridSize'],3601)
  spans=[s for s in d['spans'] if not s.get('aggregate')]
  self.assertEqual(len(spans),6)
  for a,b in zip(spans,spans[1:]):self.assertEqual(a['profile'][-1][1],b['profile'][0][1])
  for s in spans:
   self.assertTrue(all(b[0]>a[0] for a,b in zip(s['profile'],s['profile'][1:])))
   self.assertEqual(s['profile'][-1][0],s['distanceMeters'])
