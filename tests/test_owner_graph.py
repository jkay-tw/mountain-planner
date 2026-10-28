import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('owner_graph',ROOT/'tools/build_owner_reviewed_graph.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class OwnerGraphTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.policy={'ownerFollowup':{'sourceRowId':'follow','group':'G','from':'A','to':'B','go':50,'back':30,'note':'回程 輕裝:30分 重裝:60分'},'displayAliases':[], 'contextNodes':[], 'ambiguousLabels':{}}
        self.put('data/audits/owner_full_review_policy_20261028.json',self.policy)
        self.put('data/crosswalk-reviewed.json',{'canonicalNodes':[]})
        self.put('data/unified-editor-manifest.json',{'routes':[]})
    def put(self,path,data):
        p=self.root/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(data))
    def row(self,id='r',**kwargs):
        d={'sourceRowId':id,'sheetRow':2,'originalGroup':'G','group':'G','chartId':'G02','from':'A','to':'B', 'go':10,'back':20,'note':'','travelMode':'walking','ownerReviewStatus':'確認'};d.update(kwargs);return d
    def run_graph(self,rows):return m.compile_rows({'rows':rows,'sourceWorkbookSHA256':'test'},self.root)
    def test_followup_conditions_and_vehicle_separation(self):
        g,s,_=self.run_graph([self.row('follow',go=50,back=60),self.row('car',travelMode='vehicle',**{'from':'C','to':'D'})])
        rev=next(e for e in g['segments'] if e['minutes']==30)
        self.assertEqual(rev['timeAlternatives'],[{'kind':'heavy_pack','minutes':60}]);self.assertEqual(len(g['transportSegments']),2)
        self.assertTrue(all(e['travelMode']=='walking' for e in g['segments']))
    def test_conditional_times_do_not_enter_shortest_path_as_parallel_edges(self):
        a=self.row(note='回程 輕裝:20分 重裝60分');b=self.row(back=60,note=a['note'])
        g,s,_=self.run_graph([a,b]);self.assertEqual(len(g['segments']),2);self.assertEqual(s['issues'],[])
        self.assertEqual(sorted(e['minutes'] for e in g['segments']),[10,20])
    def test_same_chart_same_label_in_other_group_does_not_infer_identity(self):
        self.put('data/unified-editor-manifest.json',{'routes':[{'id':'G02','file':'data/known.json'}]})
        self.put('data/known.json',{'nodes':[{'id':'a','name':'A'},{'id':'b','name':'B'}], 'segments':[{'from':'A','to':'B','fromId':'a','toId':'b'}]})
        g,s,bindings=self.run_graph([self.row(),self.row('other',originalGroup='Other',group='Other',**{'from':'A','to':'C'})])
        self.assertNotEqual(bindings[0]['nodeId'],bindings[2]['nodeId'])
    def test_ambiguous_labels_are_resolved_by_edge_context_only(self):
        self.policy['ambiguousLabels']={'G':['岔路']};self.put('data/audits/owner_full_review_policy_20261028.json',self.policy)
        g,s,_=self.run_graph([self.row(**{'from':'岔路'})]);self.assertFalse(g['routingEnabled'])
        self.assertTrue(any(i['kind']=='unresolved_physical_identity' for i in s['issues']))
    def test_crosswalk_conflict_quarantines_without_losing_evidence(self):
        self.put('data/crosswalk-reviewed.json',{'canonicalNodes':[
            {'canonicalId':'a','name':'A','members':[{'group':g,'name':'A'} for g in ['G','H']]},
            {'canonicalId':'b','name':'B','members':[{'group':g,'name':'B'} for g in ['G','H']]}]})
        g,s,_=self.run_graph([self.row(),self.row('r2',originalGroup='H',group='H',go=11)])
        e=next(e for e in g['segments'] if e['from']=='A')
        self.assertFalse(e['routingEnabled']);self.assertEqual(e['conflictingSources'][0]['minutes'],11)
        self.assertFalse(g['routingEnabled']);self.assertEqual(len(s['issues']),1)
    def test_pending_input_cannot_be_marked_verified(self):
        with self.assertRaises(ValueError):self.run_graph([self.row(ownerReviewStatus='待查')])
    def test_stable_ids_and_input_not_mutated(self):
        a=[self.row(),self.row('r2',**{'from':'B','to':'C'})];before=copy.deepcopy(a)
        g,_,_=self.run_graph(a);h,_,_=self.run_graph(list(reversed(a)))
        self.assertEqual(a,before);self.assertEqual([n['id'] for n in g['nodes']],[n['id'] for n in h['nodes']])
if __name__=='__main__':unittest.main()
