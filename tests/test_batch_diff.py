import csv
import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('batch_diff',ROOT/'tools'/'diff_hiking_audits.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AuditDiffTest(unittest.TestCase):
    def test_changed_removed_added_and_status_update_are_reported(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            def write(name,rows):
                file=root/name
                with file.open('w',encoding='utf-8',newline='') as h:
                    w=csv.DictWriter(h,fieldnames=['group','start','end','minutes','status'])
                    w.writeheader()
                    w.writerows(rows)
                return file
            before=write('old.csv',[
                dict(group='G',start='A',end='B',minutes=20,status='candidate_unverified'),
                dict(group='G',start='B',end='C',minutes=30,status='candidate_unverified'),
                dict(group='G',start='D',end='E',minutes=40,status='candidate_unverified')])
            after=write('new.csv',[
                dict(group='G',start='A',end='B',minutes=25,status='candidate_unverified'),
                dict(group='G',start='B',end='C',minutes=30,status='approved_source_verified'),
                dict(group='G',start='E',end='F',minutes=50,status='candidate_unverified')])
            result=module.diff(before,after)
            self.assertEqual(result['changeCount'],4)
            self.assertEqual(set(result['changeTypes']),{
                'added','removed','minutes_changed','verification_status_changed'})
            self.assertEqual(module.diff(after,after)['changeCount'],0)


if __name__=='__main__':unittest.main()
