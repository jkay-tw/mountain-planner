import gzip,hashlib,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

class MainlandAssetsTests(unittest.TestCase):
    def test_all_network_tiles_have_exact_hash_and_source_references(self):
        directory=ROOT/'preview/data/osm-mainland';index=json.loads((directory/'manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(index['source']['sha256'],'6db4a97a72f3e9de6d2404359c6bbca0fec1f34ee870e08bb45368e7aa7a1fa7')
        ways=set();manual=[]
        for tile in index['tiles']:
            packed=(directory/tile['file']).read_bytes();self.assertEqual(len(packed),tile['bytes']);self.assertEqual(hashlib.sha256(packed).hexdigest(),tile['sha256'])
            raw=gzip.decompress(packed);self.assertEqual(len(raw),tile['jsonBytes']);data=json.loads(raw)
            self.assertEqual(len(data['nodes']),tile['nodes']);self.assertEqual(len(data['ways']),tile['ways'])
            junctions=set(data['junctionIds']);self.assertTrue(all(str(node) in data['nodes'] for node in junctions))
            for way in data['ways']:
                self.assertNotIn(way['id'],ways);ways.add(way['id']);self.assertTrue(way['version']>0 and way['timestamp'])
                self.assertTrue(all(str(node) in data['nodes'] for node in way['refs']))
                self.assertIn(way['refs'][0],junctions);self.assertIn(way['refs'][-1],junctions)
            if tile.get('manualOnly'):manual.append(tile['file'])
        self.assertEqual(len(ways),323900);self.assertEqual(manual,['2430_500.json.gz'])
    def test_all_dem_grids_are_intact_and_original_archive_is_identified(self):
        directory=ROOT/'preview/data/dem-mainland';index=json.loads((directory/'manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(index['source']['archiveSha256'],'5965dab6fd19ca1b1ecb077b0219fe4e932b599dd985fa96266d383e166594a0')
        self.assertIn('NoData',index['source']['method']);self.assertEqual(len(index['tiles']),1398)
        for tile in index['tiles']:
            packed=(directory/tile['file']).read_bytes();self.assertEqual(len(packed),tile['bytes']);self.assertEqual(hashlib.sha256(packed).hexdigest(),tile['sha256']);self.assertEqual(len(gzip.decompress(packed)),181*181*2)

if __name__=='__main__':unittest.main()
