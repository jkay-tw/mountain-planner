import importlib.util,unittest
from pathlib import Path
class PingfengNamesAudit(unittest.TestCase):
 def test_authorized_changes_and_gpx_osm_corridor(self):
  p=Path(__file__).resolve().parents[1]/'tools/audit_pingfeng_names_20261120.py';s=importlib.util.spec_from_file_location('pingfeng_audit',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.audit(False)
