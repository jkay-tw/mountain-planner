import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'tools'))
from apply_g11_g12_owner_gpx import apply, parse_components, SHA, SOURCE


class FakeDem:
    def __init__(self, sha):
        self.sha256, self.hashes = sha, {}
    def sample(self, point):
        return 1000+point[0]


class OwnerGpxTests(unittest.TestCase):
    def setUp(self):
        self.path = ROOT/'data/geometry/sources'/f'{SOURCE}.gpx'
        self.data = json.loads((ROOT/'preview/data/geometry/planner-terrain-v1.json').read_text(encoding='utf-8'))
        self.report = json.loads((ROOT/'data/geometry/sources/g11-g12-owner-gpx-application-20261119.json').read_text(encoding='utf-8'))

    def test_raw_source_and_unjoined_boundary(self):
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(), SHA)
        components, segments = parse_components(self.path)
        self.assertEqual(len(segments), 16)
        self.assertNotEqual(components[0][-1], components[1][0])
        self.assertAlmostEqual(self.report['boundaryGapMeters'], 18.108, places=3)
        self.assertEqual(len(components[1]), 855)
        self.assertTrue(self.report['straightConnectorsApproved'])
        self.assertEqual([c['distanceMeters'] for c in self.report['userConnectors']], [18.108, 9.893])

    def test_only_two_spans_changed_and_node_times_preserved(self):
        digest = lambda value: hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        changed = {s['id'] for s in self.report['previousSpans']}
        self.assertEqual(len(changed), 2)
        for key in ('nodes', 'spanDependencies'):
            self.assertEqual(digest(self.data[key]), self.report['baselineInvariants'][key])
        self.assertEqual(digest([s for s in self.data['spans'] if s['id'] not in changed]), self.report['baselineInvariants']['unaffectedSpans'])
        self.assertEqual(len(self.data['spans']), 695)
        for name, sha in self.report['baselineRouteSha256'].items():
            content = (ROOT/f'data/routes/owner-reviewed/{name}.json').read_bytes().replace(b'\r\n', b'\n')
            self.assertEqual(hashlib.sha256(content).hexdigest(), sha)

    def test_builder_is_nonmutating_and_rejects_wrong_dem(self):
        original = copy.deepcopy(self.data)
        result, _ = apply(self.data, self.path, FakeDem(self.data['terrainSource']['zipSha256']))
        self.assertEqual(self.data, original)
        self.assertEqual(result['nodes'], original['nodes'])
        with self.assertRaisesRegex(ValueError, 'DEM archive differs'):
            apply(self.data, self.path, FakeDem('wrong'))


if __name__ == '__main__':
    unittest.main()
