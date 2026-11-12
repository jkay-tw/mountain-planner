import json
import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from node_coordinate_review import twd97


class LowestSaddleFollowupTests(unittest.TestCase):
    def load(self, path):
        return json.loads((ROOT / path).read_text(encoding='utf-8'))

    def test_owner_coordinate_and_previous_decision_are_preserved(self):
        owner = self.load('data/geometry/sources/owner-coordinate-overrides.json')
        n = next(n for n in owner['nodes'] if n['nodeId'] == 'node:9e9822f8d527f3ba8f6a')
        self.assertEqual(twd97(n['coordinate']), [260487, 2601827])
        self.assertEqual(n['source']['verification'], 'user-supplied')
        self.assertTrue(any(p.get('originalCoordinate', {}).get('y') == 2600978 for p in n['previousDecisions']))

    def test_runtime_and_dem_follow_the_owner_coordinate(self):
        for path in ['data/geometry/planner-terrain-v1.json', 'preview/data/geometry/planner-terrain-v1.json']:
            data = self.load(path)
            n = next(n for n in data['nodes'] if n['nodeId'] == 'node:9e9822f8d527f3ba8f6a')
            self.assertEqual(twd97(n['coordinate']), [260487, 2601827])
            self.assertAlmostEqual(n['elevationMeters'], 3242.2, places=1)

    def test_fold_disappears_without_new_review_flags(self):
        audit = self.load('data/audits/lowest-saddle-spatial-audit-20261112.json')
        n = next(n for n in audit['nodes'] if n['nodeId'] == 'node:9e9822f8d527f3ba8f6a')
        self.assertEqual(n['findings'], [])
        for n in audit['nodes']:
            self.assertFalse(any(f['level'] in ['優先確認', '建議複核'] for f in n['findings']))
        report = self.load('data/audits/lowest-saddle-followup-20261112.json')
        self.assertEqual(report['directionalSignatureBefore'], report['directionalSignatureAfter'])
        self.assertEqual(report['unchangedSpans'], 692)
        self.assertEqual(len(report['changedSpanIds']), 2)


if __name__ == '__main__':
    unittest.main()
