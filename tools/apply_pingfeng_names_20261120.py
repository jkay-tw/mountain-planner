"""Apply the explicitly authorized owner data decisions; geometry is rebuilt separately."""
import hashlib,json,shutil
from pathlib import Path
from import_coordinate_review import twd97_to_wgs84
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'data/geometry/sources/pingfeng-names-owner-20261120.json'
def load(p):return json.loads(p.read_text(encoding='utf-8'))
def save(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def apply():
 decision=load(SOURCE);changes={n['id']:n for n in decision['nameChanges']}
 assert len(changes)==16 and all(n['newName'] for n in changes.values())
 manifest=load(ROOT/'data/unified-editor-manifest.json');updated=[]
 for entry in manifest['routes']:
  p=ROOT/entry['file'].split('?')[0];data=load(p);before=json.dumps(data,ensure_ascii=False)
  for n in data['nodes']:
   if n['id'] not in changes:continue
   c=changes[n['id']];assert n['name'] in [c['oldName'],c['newName']],n
   n['name']=c['newName'];n['aliases']=list(dict.fromkeys(a for a in [*n.get('aliases',[]),c['oldName']] if a!=n['name']))
  for e in [*data['segments'],*data.get('manualConnections',[])]:
   for key,label in [('fromId','from'),('toId','to')]:
    if e[key] in changes:e[label]=changes[e[key]]['newName']
  if json.dumps(data,ensure_ascii=False)!=before:
   save(p,data);updated.append(str(p.relative_to(ROOT)));entry['file']=str(p.relative_to(ROOT)).replace('\\','/')+'?v=names'+hashlib.sha256(p.read_bytes()).hexdigest()[:12]
  dest=ROOT/'preview'/p.relative_to(ROOT);shutil.copyfile(p,dest)
 save(ROOT/'data/unified-editor-manifest.json',manifest);shutil.copyfile(ROOT/'data/unified-editor-manifest.json',ROOT/'preview/data/unified-editor-manifest.json')
 transport=ROOT/'data/transport-owner-reviewed.json';d=load(transport)
 for e in d['segments']:
  for key,label in [('fromId','from'),('toId','to')]:
   if e[key] in changes:e[label]=changes[e[key]]['newName']
 save(transport,d)
 overrides=ROOT/'data/geometry/sources/owner-coordinate-overrides.json';d=load(overrides)
 for c in decision['coordinateChanges']:
  record=next((n for n in d['nodes'] if n['nodeId']==c['nodeId']),None)
  if record is None:record={'nodeId':c['nodeId']};d['nodes'].append(record)
  prior={k:v for k,v in record.items() if k!='priorTo20261120'}
  record.setdefault('priorTo20261120',prior)
  record.update(reviewId='OWNER-20261120-'+c['nodeId'].split(':')[-1],name=c['name'],action='coordinate',choice='自行補座標',coordinate=twd97_to_wgs84(*c['twd97']),originalCoordinate={'format':'TWD97','x':c['twd97'][0],'y':c['twd97'][1]},source={'kind':'owner-chat','date':'2026-11-20','evidenceRef':str(SOURCE.relative_to(ROOT)).replace('\\','/')},note='使用者明確指定座標；依 GPX 方向核對 OSM，保留 Node ID 與原方向時間。')
 d['reviewDate']='2026-11-20';save(overrides,d)
 print('Updated datasets:',updated)
if __name__=='__main__':apply()
