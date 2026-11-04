import importlib.util,struct,tempfile,unittest,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def module(name):
 s=importlib.util.spec_from_file_location(name,ROOT/'tools'/f'{name}.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
Dem=module('full_dem').Dem
eligible=module('extract_walking_network').eligible
class FullDemTests(unittest.TestCase):
 def test_tiles_orientation_interpolation_and_missing_are_explicit(self):
  with tempfile.TemporaryDirectory() as td:
   p=Path(td)/'tiles.zip'
   with zipfile.ZipFile(p,'w') as f:
    f.writestr('N23E120.hgt',struct.pack('>9h',*range(0,90,10)))
    f.writestr('N24E121.hgt',struct.pack('>9h',*([100]*9)))
    f.writestr('N22E120.hgt',struct.pack('>9h',*([-32768]*9)))
   d=Dem(p)
   self.assertEqual(d.sample([120.25,23.75]),20)
   self.assertEqual(d.sample([120.75,23.25]),60)
   self.assertEqual(d.sample([121.5,24.5]),100)
   with self.assertRaises(KeyError):d.sample([121.5,25.5])
   with self.assertRaisesRegex(ValueError,'NoData'):d.sample([120.5,22.5])
   self.assertEqual(set(d.provenance()['tileSha256']),{'N23E120.hgt','N24E121.hgt','N22E120.hgt'})
   d.zip.close()
 def test_walking_access_includes_permitted_road_and_never_prohibited_or_vehicle_only(self):
  self.assertTrue(eligible({'highway':'primary'}))
  self.assertTrue(eligible({'highway':'path','access':'private','foot':'yes'}))
  for tags in [{'highway':'motorway'},{'highway':'trunk'},{'highway':'path','foot':'no'},{'highway':'path','access':'private'},{'highway':'primary','motorroad':'yes'},{'highway':'path','construction':'yes'},{'highway':'path','foot:conditional':'no @ (winter)'},{'highway':'footway','area':'yes'}]:
   self.assertFalse(eligible(tags),tags)
if __name__=='__main__':unittest.main()
