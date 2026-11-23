import sys,json,gzip,hashlib,shutil
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from import_coordinate_review import twd97_to_wgs84
R=Path(__file__).resolve().parents[1]
def load(p):return json.loads((R/p).read_text(encoding='utf8'))
def save(p,d):(R/p).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
manifest=load('data/unified-editor-manifest.json')
files=[r['file'].split('?')[0] for r in manifest['routes']]+['data/geometry/planner-terrain-v1.json']
prior={p:(R/p).read_text(encoding='utf8') for p in files}
archive=R/'data/geometry/sources/route-prior-20261123.json.gz'
if archive.exists():raise SystemExit('Already applied; refusing to overwrite prior source archive')
archive.write_bytes(gzip.compress(json.dumps(prior,ensure_ascii=False).encode(),mtime=0))
changes=[]
for file,nid in [('data/routes/owner-reviewed/G04.json','g04-fork-zhenxibao'),('data/routes/owner-reviewed/G05.json','node:67f469173d3d382ca79c')]:
 d=load(file);n=next(n for n in d['nodes'] if n['id']==nid);n['plannerHidden']=True
 n['plannerHiddenReason']='Owner requested database-only intermediate 2026-11-23'
 incoming=[e for e in d['segments'] if e['toId']==nid and e.get('routingEnabled',True)]
 outgoing=[e for e in d['segments'] if e['fromId']==nid and e.get('routingEnabled',True)]
 for a in incoming:
  for b in outgoing:
   if a['fromId']==b['toId']:continue
   edge={**a,'toId':b['toId'],'to':b['to'],'minutes':a['minutes']+b['minutes'],'sourceParts':[a,b],'sourceRows':list(dict.fromkeys(a.get('sourceRows',[])+b.get('sourceRows',[]))),'viaNodeIds':[nid],'sourceNote':'Owner-approved consolidation 2026-11-23; exact directed minutes summed'}
   edge['sources']=[{'kind':'owner-approved-directional-sum','date':'2026-11-23','minutes':edge['minutes'],'parts':[{'fromId':part['fromId'],'toId':part['toId'],'minutes':part['minutes'],'sources':part.get('sources',[])} for part in [a,b]]}]
   d['segments'].append(edge);changes.append({'nodeId':nid,'fromId':edge['fromId'],'toId':edge['toId'],'minutes':edge['minutes']})
 for e in [*incoming,*outgoing]:e['routingEnabled']=False;e['archiveReason']='owner-consolidated-20261123'
 save(file,d)
for e in manifest['routes']:
 p=e['file'].split('?')[0]
 if p in ['data/routes/owner-reviewed/G04.json','data/routes/owner-reviewed/G05.json']:e['file']=p+'?v=owner20261123'+hashlib.sha256((R/p).read_bytes()).hexdigest()[:12]
 shutil.copyfile(R/p,R/'preview'/p)
save('data/unified-editor-manifest.json',manifest)
shutil.copyfile(R/'data/unified-editor-manifest.json',R/'preview/data/unified-editor-manifest.json')
p='data/geometry/sources/owner-coordinate-overrides.json';d=load(p);nid='node:2262a9d2e8c96b37a520'
old=next((n for n in d['nodes'] if n['nodeId']==nid),None)
record={'nodeId':nid,'reviewId':'OWNER-20261123-3444','name':'3444主稜','action':'coordinate','choice':'自行補座標','coordinate':twd97_to_wgs84(241342,2570474),'originalCoordinate':{'format':'TWD97','x':241342,'y':2570474},'source':{'kind':'owner-chat','date':'2026-11-23'},'note':'使用者指定 TWD97，固定來源 OSM/DEM 重算'}
if old:record['previous']=old;d['nodes'].remove(old)
d['nodes'].append(record);d['reviewDate']='2026-11-23';save(p,d)
save('data/geometry/sources/route-owner-20261123.json',{'date':'2026-11-23','authorization':'Owner requested coordinate, database-only nodes, directed time consolidation, recomputation and release','coordinate':record,'consolidations':changes,'vehicle':{'nodeId':'g04-062','fromId':'g04-062','toId':'g04-033','minutes':10,'coordinateRequired':False,'basis':'existing directed transport source; both directions separately present'}})
print(record['coordinate'],changes)
