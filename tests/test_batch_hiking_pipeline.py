"""Regression tests for batch walking-data ingest; no web or external inputs."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('batch_hiking_pipeline',
    ROOT / 'tools' / 'batch_hiking_pipeline.py')
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)


class BatchAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def put(self, name, value):
        file = self.root / name
        file.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
        return file

    def run_audit(self, source, **kwargs):
        return pipeline.audit(source, self.root / 'results', **kwargs)

    def test_batch_is_structural_only_and_never_publishes(self):
        file = self.put('input.json', dict(segments=[
            dict(group='G1', **{'from':'A','to':'B'}, go=25, back=35),
            dict(group='G2', **{'from':'A','to':'B'}, go=25, back=35)]))
        report = self.run_audit(file)
        self.assertEqual(report['candidateRows'], 2)
        self.assertEqual(report['directedKeys'], 4)
        self.assertFalse(report['published'])
        self.assertEqual(report['crossGroupChecked'], 0)
        self.assertEqual(report['approvedEdges'], 0)
        self.assertEqual(len(list((self.root/'results'/'candidate_groups').glob('*.json'))), 2)

    def test_recognizes_bidirectional_conflict_and_identity_checked_overlap(self):
        crosswalk = self.put('crosswalk.json', dict(canonicalNodes=[
            dict(canonicalId='shared-a',members=[dict(group='G1',name='A'),dict(group='G2',name='A')]),
            dict(canonicalId='shared-b',members=[dict(group='G1',name='B'),dict(group='G2',name='B')])],
            deniedPairRecords=[]))
        source = self.put('input.json', dict(segments=[
            dict(group='G1', **{'from':'A','to':'B'},go=20,back=30),
            dict(group='G1', **{'from':'B','to':'A'},go=31,back=20),
            dict(group='G2', **{'from':'A','to':'B'},go=40,back=30)]))
        report = self.run_audit(source,crosswalk=crosswalk)
        self.assertEqual(report['conflictingDirectedKeys'], 1)
        self.assertEqual(report['crossGroupChecked'], 1)
        self.assertEqual(report['crossGroupConflicts'], 1)

    def test_staging_agreement_does_not_autopromote(self):
        folder=self.root/'staging'
        folder.mkdir()
        (folder/'G1.json').write_text(json.dumps(dict(route_name='G1',segments=[
            dict(**{'from':'A','to':'B'},minutes=20,travelMode='walking',
                 verificationStatus='verified')])),encoding='utf-8')
        source=self.put('input.json', dict(segments=[
            dict(group='G1',**{'from':'A','to':'B'},go=20,back=25)]))
        report=self.run_audit(source,staging=folder)
        self.assertEqual(report['validationClasses']['staging_match_not_independently_approved'],1)
        self.assertEqual(report['approvedEdges'],0)
        self.assertFalse(report['published'])

    def test_signed_approval_required_and_must_match_direction(self):
        source=self.put('input.json',dict(segments=[
            dict(group='G1',**{'from':'A','to':'B'},go=20,back=25)]))
        ledger=self.put('approval.json',dict(schemaVersion=1,approvedDirectedEdges=[
            dict(group='G1',**{'from':'A','to':'B'},minutes=20,
                 travelMode='walking',sourceURL='https://www.sunriver.com.tw/example.jpg',
                 reviewedBy='reviewer',reviewedAt='2026-10-27',evidenceNote='manual chart comparison')]))
        report=self.run_audit(source,approvals=ledger)
        self.assertEqual(report['approvedEdges'],1)
        self.assertFalse(report['published'])

    def test_invalid_and_denied_membership_fail_closed(self):
        source=self.put('input.json',dict(segments=[
            dict(group='G1',**{'from':'A','to':'B'},go=0,back=25)]))
        result=self.run_audit(source)
        self.assertEqual(result['structuralIssues'],1)
        self.assertEqual(result['directedKeys'],0)
        crosswalk=self.put('contradiction.json',dict(canonicalNodes=[
            dict(canonicalId='s',members=[dict(group='G1',name='A'),dict(group='G2',name='A')])],
            deniedPairRecords=[dict(name='A',groupA='G1',groupB='G2')]))
        with self.assertRaises(ValueError):
            self.run_audit(source,crosswalk=crosswalk)


if __name__=='__main__':
    unittest.main()
