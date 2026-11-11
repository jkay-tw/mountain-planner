import copy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('review_bridge', ROOT/'tools/node_coordinate_review.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ReviewBridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = module.build()

    def test_current_ids_sources_directions_and_retirements(self):
        import json
        terrain = json.loads((ROOT/self.data['runtimePath']).read_text(encoding='utf-8'))
        tables = self.data['tables']
        nodes = tables['節點總表'][1:]
        self.assertEqual({n[0] for n in nodes}, {n['nodeId'] for n in terrain['nodes']})
        self.assertEqual(len(nodes), len({n[0] for n in nodes}))
        source_ids = {r[0] for r in tables['來源明細'][1:]}
        for row in nodes:
            self.assertTrue(set(row[13].split('；')) <= source_ids)
        self.assertEqual(len(tables['退休節點'])-1, 7)
        expected = []
        manifest = json.loads((ROOT/'data/unified-editor-manifest.json').read_text(encoding='utf-8'))
        for entry in manifest['routes']:
            route = json.loads((ROOT/entry['file'].split('?')[0]).read_text(encoding='utf-8'))
            for kind in ('segments', 'manualConnections'):
                expected.extend((entry['name'], e['fromId'], e['toId'], e.get('minutes'))
                                for e in route.get(kind, []))
        self.assertEqual(expected, [(r[1], r[2], r[4], r[6]) for r in tables['相鄰關係'][1:]])

    def test_projection_matches_independent_owner_twd97(self):
        self.assertEqual(module.twd97([121.2257164, 23.4461582]), [273062, 2593707])
        self.assertEqual(module.twd97(None), ['', ''])

    def test_user_fields_survive_sorting_and_refresh(self):
        fresh = self.data['tables']['審查與決策'][1:]
        old = copy.deepcopy(fresh[:2])
        old[0][7:14] = ['請核對', '採用填入座標', 273062, 2593707, 'https://example.test', '人工備註', '待處理']
        merged = module.merge_decisions(list(reversed(fresh)), list(reversed(old)))
        self.assertEqual(next(r for r in merged if r[0] == old[0][0]), old[0])
        self.assertEqual(old[0][7], '請核對')

    def test_conflicts_retirements_and_duplicate_ids(self):
        row = copy.deepcopy(self.data['tables']['審查與決策'][1])
        old = copy.deepcopy(row)
        old[4], old[8] = 'old-base', '保留現值'
        merged = module.merge_decisions([row], [old])
        self.assertEqual(merged[0][4], 'old-base')
        self.assertEqual(merged[0][8], '保留現值')
        self.assertIn('同步衝突', merged[0][13])
        self.assertIn('不在現行', module.merge_decisions([], [row])[0][13])
        with self.assertRaises(ValueError):
            module.merge_decisions([row], [row, row])
        other = copy.deepcopy(row)
        other[1] = 'different-node'
        with self.assertRaises(ValueError):
            module.merge_decisions([row], [other])


    def test_online_plan_never_writes_human_columns_and_follows_live_order(self):
        rows = self.data['tables']['審查與決策'][1:3]
        live = copy.deepcopy(list(reversed(rows)))
        live[0][7] = '保留我的指示'
        requests = module.decision_requests(rows, live, 105)
        self.assertEqual(requests[0]['updateCells']['start']['rowIndex'], 2)
        for request in requests:
            update = request['updateCells']
            cols = set(range(update['start']['columnIndex'],
                             update['start']['columnIndex']+len(update['rows'][0]['values'])))
            self.assertFalse(cols & set(range(7, 13)))
        self.assertEqual(live[0][7], '保留我的指示')


if __name__ == '__main__':
    unittest.main()
