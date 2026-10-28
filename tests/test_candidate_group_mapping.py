"""Regression tests for official chart families and isolated display-name alias."""
import importlib.util
import json
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('normalize_candidate_groups',
    ROOT/'tools'/'normalize_candidate_groups.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class GroupMappingTests(unittest.TestCase):
    def setUp(self):
        self.mapping=json.loads((ROOT/'data'/'candidate_group_mapping.json').read_text(encoding='utf-8'))

    def test_chart_family_mapping_is_complete_and_does_not_make_up_g01_or_g21(self):
        rows=self.mapping['mapping']
        self.assertEqual(len(rows),24)
        self.assertEqual(len({x['candidateGroup'] for x in rows}),24)
        self.assertEqual({x['officialChartId'] for x in rows if x['officialChartId']},
                         {f'G{n:02d}' for n in range(2,21)})
        self.assertEqual([x['candidateGroup'] for x in rows if not x['officialChartId']],['八通關越嶺'])
        self.assertEqual(next(x for x in rows if x['candidateGroup']=='干卓萬群峰')['officialChartId'],'G13')

    def test_only_g13_mountain_alias_is_rewritten_without_losing_original_source(self):
        raw={'segments':[
            {'group':'干卓萬群峰','from':'牧山','to':'萬里山西峰','go':150,'back':140},
            {'group':'白姑大山','from':'萬里山西峰','to':'南峰','go':10,'back':20}]}
        tiny={**self.mapping,'mapping':[x for x in self.mapping['mapping']
              if x['candidateGroup'] in ('干卓萬群峰','白姑大山')]}
        normalized,report=module.normalize(raw,tiny)
        self.assertEqual(normalized['segments'][0]['to'],'火山')
        self.assertEqual(normalized['segments'][1]['from'],'萬里山西峰')
        self.assertEqual(raw['segments'][0]['to'],'萬里山西峰')
        self.assertEqual(report['displayRenames'][0]['previous'],'萬里山西峰')
        self.assertEqual(report['displayRenames'][0]['current'],'火山')
        self.assertFalse(report['publicationEligible'])

    def test_unknown_group_must_not_be_guessed_as_a_map_id(self):
        with self.assertRaises(ValueError):
            module.normalize({'segments':[{'group':'新圖組','from':'A','to':'B','go':10,'back':20}]},
                self.mapping)



    def test_source_verified_typo_and_exact_corrupt_row_exclusion(self):
        tiny={'schemaVersion':1,'mapping':[dict(candidateGroup='丹大東郡',officialChartId='G15')],
              'renames':[dict(group='丹大東郡',from='33.5K大崩山',to='33.5K大崩塌',
                              sourceVerified=True,userConfirmed=False)],
              'excludedCandidateSegments':[dict(group='丹大東郡',**{'from':'烏利加南東峰山屋','to':'麻利加南東峰山屋'},
                                                go=30,back=20,sourceVerified=True,reason='corrupt')]}
        raw={'segments':[
            {'group':'丹大東郡','from':'33K行車終點','to':'33.5K大崩山','go':30,'back':30},
            {'group':'丹大東郡','from':'烏利加南東峰山屋','to':'麻利加南東峰山屋','go':30,'back':20}]}
        normalized,report=module.normalize(raw,tiny)
        self.assertEqual(len(normalized['segments']),1)
        self.assertEqual(normalized['segments'][0]['to'],'33.5K大崩塌')
        self.assertEqual(len(report['displayRenames']),1)
        self.assertEqual(len(report['excludedCandidateSegments']),1)

if __name__=='__main__':unittest.main()
