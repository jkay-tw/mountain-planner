import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from review_g14_g15_gpx import generate,ingest,tables


class GpxReviewTests(unittest.TestCase):
    def test_manual_priority_track_segments_provenance_and_no_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            def write(path,data):
                p=root/path;p.parent.mkdir(parents=True,exist_ok=True)
                p.write_text(json.dumps(data),encoding='utf-8');return p
            write('data/unified-editor-manifest.json',{'routes':[
                {'id':'G14','name':'G14｜測試','file':'data/g14.json'},
                {'id':'G15','name':'G15｜測試','file':'data/g15.json'}]})
            write('data/g14.json',{'nodes':[{'id':'a','name':'山峰','aliases':[]}],'segments':[]})
            write('data/g15.json',{'nodes':[{'id':'b','name':'未定位點','aliases':[]}],'segments':[]})
            write('data/geometry/sources/owner-coordinate-overrides.json',{'nodes':[
                {'nodeId':'a','action':'coordinate','coordinate':[121.002,24.002]}]})
            runtime=write('runtime.json',{'nodes':[{'nodeId':'a','coordinate':[121.001,24.001],'coordinatePolicy':'active'},
                                                  {'nodeId':'b','coordinate':None,'coordinatePolicy':'active'}]})
            paths=[]
            for i in range(4):
                p=root/f'source{i}.gpx'
                p.write_text('<gpx xmlns="http://www.topografix.com/GPX/1/1"><wpt lat="24" lon="121"><name>山峰</name></wpt>'
                             '<wpt lat="24" lon="121"><name>山峰</name></wpt><trk><trkseg><trkpt lat="24" lon="121"/>'
                             '</trkseg><trkseg><trkpt lat="24.1" lon="121.1"/></trkseg></trk></gpx>',encoding='utf-8')
                paths.append(p)
            before={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
            report=generate(paths,runtime,root)
            a=next(n for n in report['nodes'] if n['nodeId']=='a')
            self.assertEqual(a['coordinate'],[121.002,24.002])
            self.assertEqual(a['status'],'手填優先；GPX僅備註')
            self.assertEqual(len(a['candidates']),4)
            self.assertEqual(a['candidates'][0]['waypointIndices'],[0,1])
            self.assertEqual(a['candidates'][0]['coordinate'],[121,24])
            self.assertEqual(a['candidates'][0]['nearestTrackSample']['segment'],0)
            self.assertEqual(report['files'][0]['trackSegmentCount'],2)
            self.assertEqual(len(tables(report)['G14-G15座標討論']),3)
            self.assertEqual(before,{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()})
            # A large mismatch is a discussion flag, never a replacement point.
            write('data/geometry/sources/owner-coordinate-overrides.json',{'nodes':[]})
            write('runtime.json',{'nodes':[{'nodeId':'a','coordinate':[121.1,24.1],'coordinatePolicy':'active'},
                                         {'nodeId':'b','coordinate':None,'coordinatePolicy':'active'}]})
            shifted=generate(paths,runtime,root)['nodes'][0]
            self.assertEqual(shifted['status'],'GPX距現值>1km；需優先核對')
            self.assertEqual(shifted['coordinate'],[121.1,24.1])

    def test_gpx_entity_declarations_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'bad.gpx'
            p.write_text('<!DOCTYPE gpx [<!ENTITY x "text">]><gpx/>',encoding='utf-8')
            with self.assertRaises(ValueError):ingest([p])


if __name__=='__main__':unittest.main()
