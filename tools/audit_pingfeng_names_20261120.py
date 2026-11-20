"""Finalize label metadata and audit the authorized update against its immutable base."""
import copy,gzip,hashlib,json,sys,xml.etree.ElementTree as ET
from pathlib import Path
from build_xueshan_geometry import distance
ROOT=Path(__file__).resolve().parents[1]
BASE='57b5469c68321276ed6acbcadba54dc54ff81c5f'
def read(p):return json.loads((ROOT/p).read_text(encoding='utf-8'))
def old(p):
 snapshot=json.loads(gzip.decompress((ROOT/'data/geometry/sources/pingfeng-prior-20261120.json.gz').read_bytes()))
 assert snapshot['baseCommit']==BASE
 return json.loads(snapshot['files'][p])
def projected(p,a,b):
 import math
 scale=math.cos(p[1]*math.pi/180);dx=(b[0]-a[0])*scale;dy=b[1]-a[1];t=max(0,min(1,((p[0]-a[0])*scale*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy or 1)))
 return distance(p,[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])])
def audit(finalize=False):
 decision=read('data/geometry/sources/pingfeng-names-owner-20261120.json');changes={n['id']:n for n in decision['nameChanges']};allowed={c['nodeId'] for c in decision['coordinateChanges']}
 manifest=read('data/unified-editor-manifest.json');nodes={}
 for entry in manifest['routes']:
  p=entry['file'].split('?')[0];before=old(p);after=read(p)
  assert {n['id'] for n in before['nodes']}=={n['id'] for n in after['nodes']}
  for a,b in zip(before['segments'],after['segments']):
   assert {k:v for k,v in a.items() if k not in ['from','to']}=={k:v for k,v in b.items() if k not in ['from','to']},'Source edge/time changed'
  for n in after['nodes']:
   nodes[n['id']]=n
   if n['id'] in changes:assert n['name']==changes[n['id']]['newName'] and changes[n['id']]['oldName'] in n['aliases']
 p='preview/data/geometry/planner-terrain-v1.json';g=read(p);base=old('data/geometry/planner-terrain-v1.json')
 if finalize:
  for n in g['nodes']:
   if n['nodeId'] in changes:n['aliases']=copy.deepcopy(nodes[n['nodeId']]['aliases'])
  (ROOT/p).write_text(json.dumps(g,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
 before_nodes={n['nodeId']:n for n in base['nodes']};assert set(before_nodes)=={n['nodeId'] for n in g['nodes']}
 coords=[{'nodeId':n['nodeId'],'name':n['name'],'before':before_nodes[n['nodeId']]['coordinate'],'after':n['coordinate'],'elevationMeters':n['elevationMeters']} for n in g['nodes'] if n['coordinate']!=before_nodes[n['nodeId']]['coordinate']]
 assert {n['nodeId'] for n in coords}==allowed
 before_spans={s['id']:s for s in base['spans']};assert set(before_spans)=={s['id'] for s in g['spans']}
 changed=[s for s in g['spans'] if s!=before_spans[s['id']]]
 assert len(changed)==3 and all(allowed.intersection([s['fromId'],s['toId'],*s.get('viaNodeIds',[])]) for s in changed)
 bridge='node:97e309d22937a82f9ade';cross='node:ac2e2b0473232211e496';end='node:d69a18f19c7940c3ebf4';path=[]
 for a,b in [(bridge,cross),(cross,end)]:
  s=next(s for s in changed if {s['fromId'],s['toId']}=={a,b});points=s['coordinates'] if s['fromId']==a else list(reversed(s['coordinates']))
  if path:assert path[-1]==points[0],'Source topology discontinuity'
  path.extend(points[1:] if path else points)
 ns={'g':'http://www.topografix.com/GPX/1/1'};gpx=ROOT/'data/geometry/sources/pingfeng-owner-direction-20261120.gpx';track=ET.fromstring(gpx.read_bytes());segments=[[ [float(p.attrib['lon']),float(p.attrib['lat'])] for p in s.findall('g:trkpt',ns)] for s in track.findall('.//g:trkseg',ns)]
 offsets=sorted(min(projected(p,a,b) for a,b in zip(path,path[1:])) for seg in segments for p in seg)
 assert offsets[len(offsets)//2]<5 and max(offsets)<100,'GPX corridor mismatch'
 assert distance(segments[0][0],next(n['coordinate'] for n in g['nodes'] if n['nodeId']==bridge))<2
 result={'schemaVersion':1,'date':'2026-11-20','baseCommit':BASE,'nodeCount':len(nodes),'coordinateChanges':coords,'renamedNodes':list(changes.values()),'changedSpans':[{'id':s['id'],'fromId':s['fromId'],'toId':s['toId'],'distanceMeters':s['distanceMeters'],'wayIds':s['sourceWayIds'],'anchorOffsetsMeters':s['anchorOffsetsMeters']} for s in changed],'preservedSpans':len(g['spans'])-len(changed),'sourceEdgesAndTimesUnchanged':True,'gpx':{'file':str(gpx.relative_to(ROOT)).replace('\\','/'),'sha256':hashlib.sha256(gpx.read_bytes()).hexdigest(),'segments':len(segments),'points':sum(map(len,segments)),'medianOffsetMeters':offsets[len(offsets)//2],'maxOffsetMeters':max(offsets)},'forwardPathMeters':sum(distance(a,b) for a,b in zip(path,path[1:])),'OSMsource':g['ownerUpdateRoutingSource'],'DEMsource':g['terrainSource']}
 result['baselineArchiveSha256']=hashlib.sha256((ROOT/'data/geometry/sources/pingfeng-prior-20261120.json.gz').read_bytes()).hexdigest()
 out=ROOT/'data/audits/pingfeng-names-20261120.json'
 if finalize:out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 else:assert read(str(out.relative_to(ROOT)))==result,'Audit is stale'
 print(json.dumps({k:result[k] for k in ['preservedSpans','sourceEdgesAndTimesUnchanged','gpx','forwardPathMeters']},ensure_ascii=False))
if __name__=='__main__':audit('--finalize' in sys.argv)
