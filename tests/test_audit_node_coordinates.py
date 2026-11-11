import copy
import json
import sys
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'tools'))
from node_coordinate_review import build
from audit_node_coordinates import audit, presentation, distance, bearing, readable_sources


class SpatialAuditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bridge = build()
        cls.terrain = json.loads((ROOT/cls.bridge['runtimePath']).read_text(encoding='utf-8'))
        cls.selected = json.loads((ROOT/'data/geometry/all-route-coordinates-v1.json').read_text(encoding='utf-8'))
        cls.report = audit(cls.bridge, cls.terrain, cls.selected)

    def test_full_coverage_exclusions_and_no_mutation(self):
        baseline = copy.deepcopy(self.terrain)
        report = audit(self.bridge, self.terrain, self.selected)
        self.assertEqual(self.terrain, baseline)
        self.assertEqual({n['nodeId'] for n in report['nodes']}, {n['nodeId'] for n in self.terrain['nodes']})
        self.assertEqual(sum(report['counts'].values()), 720)
        self.assertEqual(report['counts']['依政策不定位'], 46)
        self.assertEqual(report['counts'].get('待補座標', 0), 0)
        self.assertNotIn('來源已核實', report['counts'])

    def test_known_geodesic_and_bearing(self):
        self.assertAlmostEqual(distance([121, 23], [121, 24]), 111195, delta=2)
        self.assertAlmostEqual(bearing([121, 23], [121, 24]), 0)
        self.assertGreater(bearing([121, 23], [122, 23]), 89)

    def test_outside_coordinate_flags_and_no_guessing(self):
        terrain = copy.deepcopy(self.terrain)
        terrain['nodes'][0]['coordinate'] = [23, 121]
        report = audit(self.bridge, terrain, self.selected)
        self.assertTrue(any(f['code'] == '座標格式或範圍' for f in report['nodes'][0]['findings']))
        self.assertEqual(terrain['nodes'][0]['coordinate'], [23, 121])

    def test_manual_and_vehicle_edges_never_create_speed_or_bearing_flags(self):
        bridge = copy.deepcopy(self.bridge)
        for row in bridge['tables']['相鄰關係'][1:]:
            row[7] = 'manualConnections/walking'
        report = audit(bridge, self.terrain, self.selected)
        codes = {f['code'] for n in report['nodes'] for f in n['findings']}
        self.assertFalse(codes & {'距離時間提示', '相鄰長距離', '二跳折返提示'})
        self.assertTrue(all(n['twoHopCount'] == 0 for n in report['nodes']))

    def test_readable_tables_keep_all_ids_and_decision_targets(self):
        tables = presentation(self.report, self.bridge)
        rows = tables['檢閱總覽'][1:]
        self.assertEqual(len(rows), 720)
        self.assertEqual(len({r[-1] for r in rows}), 720)
        self.assertTrue(all(r[12].startswith('#gid=105&range=H') for r in rows))
        self.assertEqual(len(tables['疑點明細'])-1, sum(self.report['flagCounts'].values()))

    def test_stale_audit_cannot_be_used_and_human_fields_survive(self):
        bad = copy.deepcopy(self.report)
        bad['inputDigest'] = 'stale'
        with self.assertRaises(ValueError):
            build(spatial_audit=bad)
        prior = copy.deepcopy(self.bridge['tables']['審查與決策'][1:2])
        prior[0][7] = '我仍在核對'
        refreshed = build(previous=prior, spatial_audit=self.report)
        self.assertEqual(refreshed['tables']['審查與決策'][1][7], '我仍在核對')
        self.assertNotIn('尚未執行', refreshed['tables']['審查與決策'][1][5])

    def test_readable_sources_keep_all_records_and_resolve_workbook_links(self):
        rows = readable_sources(self.bridge)
        self.assertEqual(len(rows), len(self.bridge['tables']['來源明細']))
        self.assertTrue(any('drive.google.com/file/' in r[-1] for r in rows[1:]))
        for row in rows:
            self.assertEqual(len(row), 9)


if __name__ == '__main__':
    unittest.main()
