"""Discover similar names near known route neighbors; never assign a coordinate.
Raw named Mapsforge POIs are an external input; candidates need explicit review.
"""
import argparse,collections,difflib,hashlib,heapq,json,math,re
from pathlib import Path
import numpy as np
from scipy.spatial import cKDTree
from resolve_coordinate_sources import ROOT,distance,key
from import_happyman_points import labels

def name_key(s):
 s=key(s).replace('臺','台').replace('彙','匯')
 for a,b in [('合匯點','合流'),('匯合點','合流'),('合匯處','合流'),('匯流','合流'),('廢棄','廢'),('遺址','舊址'),('公尺',''),('登山口','登口'),('山莊','山屋'),('工作站','工站')]:s=s.replace(a,b)
 return s

def similarity(a,b):
 a,b=name_key(a),name_key(b)
 if not a or not b:return 0
 score=difflib.SequenceMatcher(None,a,b,autojunk=False).ratio()
 # A named feature inside a recorded descriptive waypoint is a search hint.
 if min(len(a),len(b))>=3 and (a in b or b in a):score=max(score,.86)
 return score

from apply_happyman_nearby_review import graph

def anchors(nid,nodes,adj):
 # Follow each outgoing branch until the first known point; max 4 edges.
 found={}
 for branch,minutes in adj[nid].items():
  queue=[(minutes,1,branch)];seen={nid}
  while queue:
   cost,depth,i=heapq.heappop(queue)
   if i in seen:continue
   seen.add(i)
   if nodes[i]['coordinate']:
    value={'nodeId':i,'name':nodes[i]['name'],'coordinate':nodes[i]['coordinate'],'minutes':cost,'hops':depth,'branch':branch}
    if i not in found or cost<found[i]['minutes']:found[i]=value
    break
   if depth<4:
    for other,m in adj[i].items():
     if other not in seen:heapq.heappush(queue,(cost+m,depth+1,other))
 return sorted(found.values(),key=lambda x:(x['hops'],x['minutes'],x['nodeId']))

def discover(baseline,rawpath):
 nodes={n['nodeId']:n for n in baseline['nodes']};adj=graph();points={};sha=next(s['sha256'] for s in baseline['sourceCatalog'] if s['id']=='happyman')
 for line in rawpath.open():
  p=json.loads(line)
  if p['tags'].get('gpx')!='wpt':continue
  raw=p['tags']['name'];variants=labels(raw)
  if not variants:continue
  canonical=json.dumps(p,ensure_ascii=False,sort_keys=True,separators=(',',':'));i='happyman:'+hashlib.sha256(canonical.encode()).hexdigest()[:20]
  points[i]={'id':i,'source':'happyman','name':variants[0],'rawName':raw,'aliases':variants[1:],'coordinate':p['coordinate'],'category':'recorded-waypoint','tags':p['tags'],'sourceFileSha256':sha,'url':'https://tile.happyman.idv.tw/~happyman/gpx_map/20240813_155542/Happyman.map'}
 ps=list(points.values());xy=np.array([[p['coordinate'][0]*101500,p['coordinate'][1]*111200] for p in ps]);tree=cKDTree(xy);results=[];used=set()
 for n in nodes.values():
  if n['coordinate']:continue
  aa=anchors(n['nodeId'],nodes,adj)
  if not aa:results.append({'nodeId':n['nodeId'],'name':n['name'],'groups':n['groups'],'anchors':[],'candidates':[]});continue
  a=aa[0];radius=min(12000,600+a['minutes']*85)
  indices=tree.query_ball_point([a['coordinate'][0]*101500,a['coordinate'][1]*111200],radius)
  cs=[]
  for ix in indices:
   p=ps[ix];ds=[distance(p['coordinate'],t['coordinate']) for t in aa]
   if any(d>600+t['minutes']*85 for d,t in zip(ds,aa)):continue
   hints=[n['name'],*({'南湖主峰':['南湖大山']}.get(n['name'],[]))]
   score=max(similarity(hint,v) for hint in hints for v in [p['name'],*p['aliases']])
   if score<.48:continue
   cs.append({'sourceId':p['id'],'rawName':p['rawName'],'coordinate':p['coordinate'],'similarity':round(score,3),'anchorDistancesMeters':[round(d) for d in ds],'contextScore':round(sum(d/max(600,t['minutes']*85) for d,t in zip(ds,aa))/len(aa),3)})
  cs.sort(key=lambda c:(-c['similarity'],c['contextScore'],c['sourceId']))
  keep=[]
  for c in cs:
   # For inspection show distinct labels / clusters rather than repeated recordings.
   if any(name_key(c['rawName'])==name_key(k['rawName']) and distance(c['coordinate'],k['coordinate'])<80 for k in keep):continue
   keep.append(c)
   if len(keep)>=12:break
  used.update(c['sourceId'] for c in keep)
  results.append({'nodeId':n['nodeId'],'name':n['name'],'groups':n['groups'],'anchors':aa,'candidates':keep})
 return {'schemaVersion':1,'baselineCommit':'543a8aaf73679e6ddbe41eee29c51db0de89b459','purpose':'Review candidates only; similarity and nearby positions do not establish identity','nodes':results,'points':[p for p in ps if p['id'] in used]}

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('baseline',type=Path);ap.add_argument('raw',type=Path);ap.add_argument('output',type=Path);a=ap.parse_args();d=discover(json.loads(a.baseline.read_text()),a.raw);a.output.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');print('remaining',len(d['nodes']),'with candidates',sum(bool(n['candidates']) for n in d['nodes']))
