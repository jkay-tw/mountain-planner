"""End-to-end candidate ingest builds reports but does not publish routes."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
spec=importlib.util.spec_from_file_location('run_candidate_ingest',ROOT/'tools'/'run_candidate_ingest.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

class CandidateIngestTest(unittest.TestCase):
    def test_full_24_group_pipeline_is_deterministic_and_nonpublishing(self):
        mapping=json.loads((ROOT/'data'/'candidate_group_mapping.json').read_text())
        ledger=json.loads((ROOT/'data'/'audits'/'user_reviewed_time_overrides_20261028.json').read_text())
        segments=[{'group':r['group'],'from':r['from'],'to':r['to'],
                    'go':r['go'],'back':r['back']} for r in ledger['entries']]
        present={r['group'] for r in segments}
        for group in (r['candidateGroup'] for r in mapping['mapping']):
            if group not in present:
                segments.append({'group':group,'from':'測試起點','to':'測試終點','go':10,'back':20})
        with tempfile.TemporaryDirectory() as folder:
            work=Path(folder)
            source=work/'input.json'
            source.write_text(json.dumps({'segments':segments},ensure_ascii=False),encoding='utf-8')
            output=work/'out'
            result=mod.run(source,ROOT/'data'/'audits'/'user_reviewed_time_overrides_20261028.json',
                           ROOT/'data'/'candidate_group_mapping.json',
                           ROOT/'data'/'crosswalk-reviewed.json',
                           None,output)
            self.assertFalse(result['publicationAllowed'])
            self.assertEqual(result['batchValidation']['groups'],24)
            self.assertEqual(result['batchValidation']['conflictingDirectedKeys'],0)
            self.assertEqual(result['groupMapping']['mappedOfficialCharts'],
                             [f'G{n:02d}' for n in range(2,21)])
            self.assertTrue((output/'01_reviewed_times'/'reviewed_directed.csv').is_file())
            self.assertTrue((output/'02_group_normalization'/'mapping_report.json').is_file())
            self.assertTrue((output/'03_batch_validation'/'summary.json').is_file())
            report=json.loads((output/'02_group_normalization'/'normalized_candidate.json').read_text())
            g13=[r for r in report['segments'] if r['group']=='干卓萬群峰' and
                 (r['from']=='火山' or r['to']=='火山')]
            self.assertEqual(g13,[])  # synthetic set didn't include legacy name
            self.assertFalse(report['routingEnabled'])

if __name__=='__main__':unittest.main()
