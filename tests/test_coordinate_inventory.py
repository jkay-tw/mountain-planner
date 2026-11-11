import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('inventory', ROOT/'tools/build_coordinate_inventory.py')
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)


class CoordinateInventoryTests(unittest.TestCase):
    def obj(self, ref, name):
        return {'osmRef':ref, 'coordinate':[121,24], 'tags':{'name':name}}

    def test_same_name_never_merges_reviewed_ids_or_assigns_coordinates(self):
        nodes={i:{'nodeId':i,'name':'岔路','aliases':[]} for i in ['a','b']}
        rows=inventory.match_candidates(nodes,[self.obj('node/1','岔路')],{})
        self.assertEqual(len(rows),2)
        self.assertTrue(all(r['status']=='single-candidate' and r['coordinate'] is None for r in rows))

    def test_multiple_osm_entities_remain_multiple_and_old_geometry_wins(self):
        nodes={'a':{'nodeId':'a','name':'山屋','aliases':[]}}
        objects=[self.obj('node/1','山屋'),self.obj('way/2','山屋')]
        row=inventory.match_candidates(nodes,objects,{})[0]
        self.assertEqual(row['status'],'multiple-candidates')
        row=inventory.match_candidates(nodes,objects,{'a':{'coordinate':[121.2,24.3]}})[0]
        self.assertEqual(row['status'],'available')
        self.assertEqual(row['coordinate'],[121.2,24.3])

    def test_no_semantic_guess_between_hut_summit_and_junction(self):
        nodes={'a':{'nodeId':'a','name':'雪山登山口','aliases':[]}}
        row=inventory.match_candidates(nodes,[self.obj('node/1','雪山')],{})[0]
        self.assertEqual(row['status'],'no-candidate')
        self.assertEqual(row['candidates'],[])

    def test_full_inventory_uses_manifest_ids_and_has_real_neighbors(self):
        manifest,nodes=inventory.load_nodes()
        self.assertEqual(len(manifest['routes']),24)
        self.assertEqual(len(nodes),721)
        self.assertEqual(nodes['g04-039']['name'],'圈谷底部')
        self.assertTrue(nodes['g04-039']['neighbors'])

    def test_name_variants_are_only_search_hints(self):
        n={'nodeId':'a','name':'玉山主峰','aliases':[]}
        row=inventory.match_candidates({'a':n},[self.obj('node/1','玉山')],{})[0]
        self.assertEqual(row['status'],'single-candidate')
        self.assertIsNone(row['coordinate'])
        self.assertIn('非已確認別名',row['candidates'][0]['matchBasis'])
        self.assertEqual(n['aliases'],[])

    def test_landform_priority_preserves_rejected_name_matches(self):
        peak=self.obj('node/1','山峰');peak['tags']['natural']='peak'
        road=self.obj('way/2','山峰');road['tags']['highway']='residential'
        node={'nodeId':'a','name':'山峰','aliases':[],'groups':['G'],'candidates':[peak,road],'status':'multiple-candidates'}
        result=inventory.refine_candidates([node])[0]
        self.assertEqual(result['status'],'single-candidate')
        self.assertEqual(result['candidates'][0]['osmRef'],'node/1')
        self.assertEqual(result['rejectedCandidates'][0]['osmRef'],'way/2')


if __name__=='__main__':unittest.main()
