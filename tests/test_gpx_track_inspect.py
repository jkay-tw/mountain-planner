import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('gpx_track_inspect', ROOT/'tools/gpx_track_inspect.py')
gpx=importlib.util.module_from_spec(spec); spec.loader.exec_module(gpx)

class GpxTrackTests(unittest.TestCase):
    def test_segments_never_get_joined_and_export_excludes_timestamps(self):
        fixture='''<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><trkseg>
        <trkpt lat="24" lon="121"><ele>100</ele><time>2020-01-01T00:00:00Z</time></trkpt>
        <trkpt lat="24.001" lon="121"><ele>110</ele></trkpt></trkseg>
        <trkseg><trkpt lat="25" lon="122"/><trkpt lat="25.001" lon="122"/></trkseg></trk></gpx>'''
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'in.gpx';p.write_text(fixture)
            segments=gpx.parse_gpx(p)
            self.assertEqual([len(s) for s in segments],[2,2])
            self.assertEqual(gpx.summarize(segments[0])['gaps_over_100m'],1)
            out=Path(folder)/'out.gpx';gpx.export_gpx(segments[0],out,'測試 & 路徑')
            self.assertNotIn('<time>',out.read_text())
            self.assertEqual(gpx.parse_gpx(out),[segments[0]])
    def test_nearest_finds_observed_point_and_validates_coordinates(self):
        points=[{'lat':24.,'lon':121.,'ele':None},{'lat':24.01,'lon':121.,'ele':None}]
        self.assertEqual(gpx.nearest(points,24.,121.,1)[0],{'index':0,'distance_m':0.0})
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'bad.gpx';p.write_text('<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="999" lon="121"/></trkseg></trk></gpx>')
            with self.assertRaises(ValueError):gpx.parse_gpx(p)

    def test_compare_uses_nearest_line_not_only_recorded_vertices(self):
        reference=[{'lat':24.,'lon':121.},{'lat':24.002,'lon':121.}]
        sample=[{'lat':24.001,'lon':121.}]
        result=gpx.compare_tracks(sample,reference)
        self.assertAlmostEqual(result['max_m'],0,places=1)
        with self.assertRaises(ValueError):gpx.compare_tracks(sample,reference[:1])

if __name__=='__main__': unittest.main()
