import sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from clip_reference_gpx import clip
class ReferenceGpxTests(unittest.TestCase):
 def write(self,path,segments):
  path.write_text('<gpx>'+''.join('<trk><trkseg>'+''.join(f'<trkpt lon="{p[0]}" lat="{p[1]}"/>' for p in ps)+'</trkseg></trk>' for ps in segments)+'</gpx>')
 def test_projected_anchors_trace_only_source_edges_in_both_directions(self):
  with tempfile.TemporaryDirectory() as td:
   p=Path(td)/'ref.gpx';ps=[[121,24],[121.001,24],[121.002,24],[121.003,24]];self.write(p,[ps]);before=p.read_bytes()
   a=[121.00025,24.0001];b=[121.00275,24.0001];r=clip(p,a,b,1000);back=clip(p,b,a,1000)
   self.assertEqual(r['coordinates'],[[121.00025,24.0],*ps[1:3],[121.00275,24.0]])
   self.assertEqual(back['coordinates'],r['coordinates'][::-1]);self.assertEqual(before,p.read_bytes())
 def test_separate_tracks_and_large_recording_gaps_never_gain_a_connector(self):
  with tempfile.TemporaryDirectory() as td:
   p=Path(td)/'ref.gpx';self.write(p,[[[121,24],[121.001,24]],[[121.01,24],[121.011,24]]])
   with self.assertRaises(ValueError):clip(p,[121,24],[121.011,24],5000)
   self.write(p,[[[121,24],[121.02,24]]])
   with self.assertRaises(ValueError):clip(p,[121,24],[121.02,24],5000)
if __name__=='__main__':unittest.main()
