import importlib.util
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('owner_workbook',ROOT/'tools/import_owner_review_workbook.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class OwnerWorkbookTests(unittest.TestCase):
    def row(self,**changes):
        d={'Row ID':'r','JSON 群組':'原組','修正群組名稱':'新組','官方圖組':'G02',
           '候選起點':'A','候選終點':'B','候選去程(分)':20,'候選回程(分)':30,
           '人工核對狀態':'確認','交通方式':''}
        d.update(changes);return d
    def test_header_names_and_explicit_owner_overrides_apply_even_when_status_confirmed(self):
        d=self.row(**{'圖上終點（修正）':'C','官方迄→起(分)':0,'交通方式':'車'})
        rows,summary=m.normalize([(2,d)])
        self.assertEqual((rows['rows'][0]['group'],rows['rows'][0]['to'],rows['rows'][0]['back']),('新組','C',0))
        self.assertEqual(summary['vehicleRows'],1);self.assertFalse(rows['rows'][0]['routingEnabled'])
    def test_excluded_and_missing_vehicle_marker(self):
        data,s=m.normalize([(2,self.row()),(3,self.row(**{'Row ID':'x','人工核對狀態':'排除'}))])
        self.assertEqual(len(data['excluded']),1);self.assertEqual(s['walkingRows'],1)
    def test_repeated_ids_preserved_and_unlabelled_conflict_held(self):
        data,s=m.normalize([(2,self.row()),(3,self.row(**{'候選回程(分)':60}))])
        self.assertEqual(len({r['reviewRowKey'] for r in data['rows']}),2)
        self.assertEqual(len(s['issues']),1)
        self.assertTrue(all(r['holdReason']=='unlabelled_time_variants' for r in data['rows']))
    def test_conditions_preserved_as_variants(self):
        data,s=m.normalize([(2,self.row(**{'備註/圖上標示':'輕裝:30 重裝:60'})),
                            (3,self.row(**{'候選回程(分)':60}))])
        self.assertEqual(s['issues'],[]);self.assertEqual(len(s['conditionalVariants']),1)
    def test_invalid_or_incomplete_input_rejected(self):
        for changes in [{'交通方式':'巴士?'},{'人工核對狀態':''},{'候選去程(分)':-1}]:
            with self.assertRaises(ValueError):m.normalize([(2,self.row(**changes))])
    def test_read_only_named_sheet_and_ignore_other_sheet(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'input.xlsx'
            ns=m.NS['s'];rel=m.NS['r']
            head=list(self.row());head.insert(2,'備用欄')
            # New column position must never become a fixed index assumption.
            def cells(vals):
                return ''.join(f'<c r="{chr(65+i)}1" t="inlineStr"><is><t>{v}</t></is></c>' for i,v in enumerate(vals))
            with ZipFile(p,'w') as z:
                z.writestr('xl/workbook.xml',f'<workbook xmlns="{ns}" xmlns:r="{rel}"><sheets><sheet name="全部路段" r:id="r1"/></sheets></workbook>')
                z.writestr('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="r1" Target="worksheets/sheet7.xml"/></Relationships>')
                z.writestr('xl/worksheets/sheet7.xml',f'<worksheet xmlns="{ns}"><sheetData><row r="1">{cells(head + [k for k in m.FIELDS if k not in head])}</row></sheetData></worksheet>')
                z.writestr('xl/worksheets/sheet1.xml','invalid; never read')
            self.assertEqual(m.read_sheet(p),[])

if __name__=='__main__':unittest.main()
