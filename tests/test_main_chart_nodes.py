import importlib.util
import json
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('main_chart_nodes',ROOT/'tools/check_main_chart_nodes.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

class MainStepNodeTests(unittest.TestCase):
    def setUp(self):
        self.inventory=json.loads((ROOT/'data/audits/main_step_chart_label_inventory_20261028.json').read_text())
    def test_current_catalog_has_no_undocumented_main_step_nodes(self):
        self.assertEqual(mod.check_catalog(ROOT),[])
    def test_local_update_pond_cannot_be_reintroduced_in_g07(self):
        route={'route_id':'G07','nodes':[{'id':'new','name':'黑水塘'}]}
        self.assertEqual(mod.check_route(route,self.inventory)[0]['name'],'黑水塘')
    def test_same_name_is_allowed_where_main_schematic_actually_labels_it(self):
        route={'route_id':'G17','nodes':[{'id':'local','name':'黑水塘'}]}
        self.assertEqual(mod.check_route(route,self.inventory),[])
    def test_unreviewed_chart_does_not_silently_pass(self):
        with self.assertRaises(ValueError):mod.check_route({'route_id':'G99','nodes':[]},self.inventory)

if __name__=='__main__':unittest.main()
