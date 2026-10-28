"""Route compilation requires source evidence, rights, stable IDs and no conflict."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('compiled_routes',ROOT/'tools'/'compile_approved_routes.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

class CompiledRouteTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.p=Path(self.temp.name)
        self.stage=self.p/'staging';self.stage.mkdir()
        self.put('staging/G17.json',dict(route_name='南二段',segments=[
            dict(**{'from':'A','to':'B'},minutes=25,
                 verificationStatus='verified',travelMode='walking',
                 source='https://www.sunriver.com.tw/images/hiking/G17_hiking.jpg'),
            dict(**{'from':'B','to':'A'},minutes=35,
                 verificationStatus='verified',travelMode='walking',
                 source='https://www.sunriver.com.tw/images/hiking/G17_hiking.jpg')]))
        self.put('crosswalk.json',dict(canonicalNodes=[],deniedPairRecords=[]))
        self.put('mapping.json',dict(mapping=[dict(candidateGroup='南二段',officialChartId='G17')]))
        self.approval=dict(group='南二段',**{'from':'A','to':'B'},minutes=25,
            travelMode='walking',sourceURL='https://www.sunriver.com.tw/images/hiking/G17_hiking.jpg',
            reviewedBy='reviewer',reviewedAt='2026-10-28',evidenceNote='independent image verification',
            publicationPermission='written_permission',timeAlternatives=[dict(kind='slow',minutes=45)])

    def put(self,where,payload):
        path=self.p/where;path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps(payload,ensure_ascii=False),encoding='utf-8')
        return path

    def compile(self,approved):
        ledger=self.put('approved.json',dict(schemaVersion=1,approvedDirectedEdges=approved))
        return mod.compile_graph(self.stage,self.p/'crosswalk.json',ledger,self.p/'mapping.json')

    def test_verified_single_direction_preserves_conditional_time(self):
        graph,meta=self.compile([self.approval])
        self.assertFalse(graph['publicationEligible'])
        self.assertEqual(meta['approvedDirections'],1)
        self.assertEqual(meta['compiledDirections'],1)
        self.assertEqual(graph['segments'][0]['minutes'],25)
        self.assertEqual(graph['segments'][0]['timeAlternatives'],[{'kind':'slow','minutes':45}])
        self.assertEqual(graph['segments'][0]['sourceGroups'],['南二段'])

    def test_explicit_rights_are_required(self):
        approved={**self.approval}
        del approved['publicationPermission']
        with self.assertRaisesRegex(ValueError,'rights'):
            self.compile([approved])

    def test_staging_mismatch_is_never_silently_accepted(self):
        approved={**self.approval,'minutes':35}
        with self.assertRaisesRegex(ValueError,'disagrees'):
            self.compile([approved])

    def test_unknown_source_is_rejected(self):
        approved={**self.approval,'sourceURL':'https://example.com/hiking.jpg'}
        with self.assertRaisesRegex(ValueError,'official source'):
            self.compile([approved])

    def test_approved_edge_must_exist_in_staging(self):
        approved={**self.approval,'to':'C'}
        with self.assertRaisesRegex(ValueError,'missing from staged'):
            self.compile([approved])

    def test_no_approvals_produce_empty_nonpublishing_graph(self):
        graph,meta=self.compile([])
        self.assertEqual(graph['segments'],[])
        self.assertFalse(meta['publicationEligible'])

    def test_cross_chart_alias_is_user_reviewed_identity_not_new_physical_node(self):
        physical,names=mod.identity_index(dict(canonicalNodes=[
          dict(canonicalId='c1',name='官方名稱',members=[
            dict(group='南二段',name='局部名稱'),
            dict(group='新康橫斷',name='另一名稱')])],deniedPairRecords=[]))
        self.assertEqual(physical[('南二段','局部名稱')],physical[('新康橫斷','另一名稱')])
        self.assertEqual(names[physical[('南二段','局部名稱')]],'官方名稱')

    def test_crosswalk_denied_pair_cannot_share_canonical_id(self):
        self.put('crosswalk.json',dict(canonicalNodes=[
            dict(canonicalId='same',members=[dict(group='南二段',name='A'),dict(group='其他',name='A')])],
            deniedPairRecords=[dict(groupA='南二段',groupB='其他',name='A')]))
        with self.assertRaisesRegex(ValueError,'contradicts'):
            self.compile([self.approval])

if __name__=='__main__':unittest.main()
