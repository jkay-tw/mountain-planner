import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('xueshan', ROOT/'tools/build_xueshan_geometry.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class GeometryTests(unittest.TestCase):
    def test_pinned_source_rebuilds_exactly(self):
        self.assertEqual(module.build(), json.loads(module.OUTPUT.read_text()))

    def test_every_edge_is_consecutive_in_the_recorded_osm_way(self):
        source = ET.parse(module.SOURCE).getroot()
        ways = {w.get('id'): [n.get('ref') for n in w.findall('nd')] for w in source.findall('way')}
        for span in module.build()['spans']:
            for a, b, wid in zip(span['osmNodeIds'], span['osmNodeIds'][1:], span['edgeWayIds']):
                pairs = list(zip(ways[wid], ways[wid][1:]))
                self.assertTrue((a,b) in pairs or (b,a) in pairs)

    def test_closure_and_disconnection_fail_instead_of_bridging(self):
        for closure in (True, False):
            root = ET.parse(module.SOURCE).getroot()
            way = next(w for w in root.findall('way') if w.get('id') == module.WAY_IDS[0])
            if closure:
                ET.SubElement(way, 'tag', k='access', v='no')
            else:
                # Break the start's shared ID; nearby coordinates must not reconnect it.
                way.findall('nd')[0].set('ref', '2101224904')
            with tempfile.TemporaryDirectory() as tmp:
                source = Path(tmp)/'test.osm'
                ET.ElementTree(root).write(source)
                with self.assertRaises(ValueError):
                    module.build(source)


if __name__ == '__main__':
    unittest.main()
