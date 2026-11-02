"""Route positioned owner-reviewed pairs on pinned OSM topology and sample Rudy DEM.
Raw source network and country extract remain outside the repository.
"""
import argparse,array,collections,copy,gzip,hashlib,json,math
from pathlib import Path
import numpy as np
from scipy.spatial import cKDTree
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from build_planner_geometry import build as seed,ROOT
from build_xueshan_geometry import distance
from build_xueshan_terrain import project,resample
from full_dem import Dem

def trim_network(raw,nodes,route_pairs):
 # Keep whole OSM ways touching broad route corridors, never clip a way or
 # invent a connection at a bounding-box edge. Country source remains pinned.
 by={n['nodeId']:n for n in nodes};cells=set();step=.025
 def box(a,b,pad):
  for x in range(math.floor((min(a[0],b[0])-pad)/step),math.floor((max(a[0],b[0])+pad)/step)+1):
   for y in range(math.floor((min(a[1],b[1])-pad)/step),math.floor((max(a[1],b[1])+pad)/step)+1):cells.add((x,y))
 for p in route_pairs:
  a,b=by[p['fromId']]['coordinate'],by[p['toId']]['coordinate']
  if a and b:box(a,b,max(.04,max(abs(a[i]-b[i]) for i in (0,1))*.5))
 for n in nodes:
  if n['coordinate']:box(n['coordinate'],n['coordinate'],.02)
 near={i for i,p in raw['nodes'].items() if (math.floor(p[0]/step),math.floor(p[1]/step)) in cells}
 ways=[w for w in raw['ways'] if any(str(i) in near for i in w['refs'])];used={str(i) for w in ways for i in w['refs']}
 raw['ways']=ways;raw['nodes']={i:p for i,p in raw['nodes'].items() if i in used};raw['blockedNodeIds']=[i for i in raw['blockedNodeIds'] if str(i) in used]
 print('corridor network',len(raw['nodes']),'nodes',len(ways),'ways',flush=True)
 return raw

class Network:
 def __init__(self,raw):
  self.raw=raw;self.ids=list(raw['nodes']);self.index={i:j for j,i in enumerate(self.ids)}
  self.coords=[raw['nodes'][i] for i in self.ids];blocked=set(map(str,raw['blockedNodeIds']))
  aa=array.array('I');bb=array.array('I');ww=array.array('I');self.directions=[]
  for wi,w in enumerate(raw['ways']):
   foot=w['tags'].get('oneway:foot','no');self.directions.append((foot!='-1',foot not in ('yes','1','true')))
   for a,b in zip(w['refs'],w['refs'][1:]):
    a,b=str(a),str(b)
    if a==b or a in blocked or b in blocked:continue
    aa.append(self.index[a]);bb.append(self.index[b]);ww.append(wi)
  self.a=np.asarray(aa);self.b=np.asarray(bb);self.w=np.asarray(ww)
  xy=np.array(self.coords)*[101500,111200]
  self.vertexIndices=np.unique(np.concatenate((self.a,self.b)))
  self.midTree=cKDTree((xy[self.a]+xy[self.b])/2);self.vertexTree=cKDTree(xy[self.vertexIndices])
  self.splits=collections.defaultdict(dict);self.anchors={}
 def snap(self,node,max_offset=120):
  p=node['coordinate'];_,ix=self.midTree.query(np.array(p)*[101500,111200],k=min(64,len(self.a)))
  choices=[]
  for i in np.atleast_1d(ix):
   a,b=self.coords[self.a[i]],self.coords[self.b[i]];_,_,f,q=project(p,[a,b]);choices.append((distance(p,q),int(i),f,q))
  best=min(choices);vd,vi=self.vertexTree.query(np.array(p)*[101500,111200]);vi=int(self.vertexIndices[int(vi)]);vp=self.coords[vi]
  if distance(p,vp)<best[0]:
   offset=distance(p,vp);index=int(vi);info={'osmNodeId':self.ids[index]}
  else:
   offset,i,f,q=best;u,v=int(self.a[i]),int(self.b[i]);info={'wayId':self.raw['ways'][int(self.w[i])]['id'],'edgeOsmNodeIds':[self.ids[u],self.ids[v]],'fraction':round(f,9)}
   if offset>max_offset:return None
   if f<1e-8:index=u
   elif f>1-1e-8:index=v
   else:
    key=(min(u,v),max(u,v));f=round(f if u<v else 1-f,9)
    if f not in self.splits[key]:
     index=len(self.coords);self.coords.append([round(c,7) for c in q]);self.ids.append('anchor:'+node['nodeId']);self.splits[key][f]=index
    index=self.splits[key][f]
  if offset>max_offset:return None
  self.anchors[node['nodeId']]={'nodeId':node['nodeId'],'index':index,'coordinate':self.coords[index],'offsetMeters':round(offset,2),**info}
  return index
 def compile(self):
  aa=array.array('I');bb=array.array('I');weights=array.array('d');ways=array.array('I')
  for u,v,wi in zip(self.a,self.b,self.w):
   u,v,wi=int(u),int(v),int(wi);key=(min(u,v),max(u,v));splits=[j for _,j in sorted(self.splits.get(key,{}).items())]
   if u>v:splits.reverse()
   chain=[u,*splits,v];forward,reverse=self.directions[wi]
   for a,b in zip(chain,chain[1:]):
    w=distance(self.coords[a],self.coords[b])
    if w<.001:continue
    if forward:aa.append(a);bb.append(b);weights.append(w);ways.append(wi)
    if reverse:aa.append(b);bb.append(a);weights.append(w);ways.append(wi)
  n=len(self.coords);a=np.asarray(aa);b=np.asarray(bb);keys=a.astype(np.int64)*n+b
  self.keys,unique=np.unique(keys,return_index=True);self.edgeWays=np.asarray(ways)[unique]
  self.graph=csr_matrix((np.asarray(weights)[unique],(a[unique],b[unique])),shape=(n,n));self.size=n
  del self.midTree,self.vertexTree
 def source_ways(self,indices):
  keys=np.array(indices[:-1],dtype=np.int64)*self.size+indices[1:];positions=np.searchsorted(self.keys,keys)
  return sorted(set(int(i) for i in self.edgeWays[positions]))
 def reversible(self,indices):
  keys=np.array(indices[1:],dtype=np.int64)*self.size+indices[:-1];p=np.searchsorted(self.keys,keys)
  return bool(np.all(p<len(self.keys)) and np.all(self.keys[p]==keys))

def profile(coords,dem):
 samples=resample(coords);heights=[dem.sample(p) for _,p in samples]
 if len(samples)==1:return [[0,round(heights[0],3)],[0,round(heights[0],3)]]
 zs=[heights[0]]+[sum(heights[i-1:i+2])/3 for i in range(1,len(heights)-1)]+[heights[-1]]
 return [[round(d,3),round(z,3)] for (d,_),z in zip(samples,zs)]

def pairs():
 out={}
 for row in json.loads((ROOT/'data/unified-editor-manifest.json').read_text())['routes']:
  r=json.loads((ROOT/row['file'].split('?')[0]).read_text())
  for s in [*r['segments'],*r.get('manualConnections',[])]:
   k=tuple(sorted((s['fromId'],s['toId'])))
   p=out.setdefault(k,{'fromId':k[0],'toId':k[1],'groups':[],'minutes':0,'ownerConfirmed':bool(s.get('manualTimeRequired'))})
   if row['id'] not in p['groups']:p['groups'].append(row['id'])
   p['minutes']=max(p['minutes'],s.get('minutes') or 0)
 return list(out.values())

def build(network_path,dem_path):
 data=seed();dem=Dem(dem_path)
 corrections=json.loads((ROOT/'data/geometry/sources/coordinate-corrections-v08.json').read_text())
 for correction in corrections['corrections']:
  node=next(n for n in data['nodes'] if n['nodeId']==correction['nodeId'])
  assert node['coordinate']==correction['previousCoordinate']
  node.update(coordinate=correction['coordinate'],coordinateMethod='source-role-correction-v08',coordinateSource=correction['source'])
 data['coordinateCorrections']=corrections
 by={n['nodeId']:n for n in data['nodes']};pilot_ids={n['nodeId'] for n in json.loads((ROOT/'data/geometry/xueshan-terrain-v1.json').read_text())['nodes']}
 height_gaps=[]
 for n in data['nodes']:
  if not n['coordinate']:continue
  try:
   z=round(dem.sample(n['coordinate']),1)
   if n['nodeId'] not in pilot_ids:n['elevationMeters']=z;n['elevationSource']='rudy-dem'
  except (ValueError,KeyError) as e:height_gaps.append({'nodeId':n['nodeId'],'reason':str(e)})
 print('DEM positioned nodes',data['counts']['located'],'unavailable',len(height_gaps),flush=True)
 with gzip.open(network_path,'rt') as f:raw=json.load(f)
 all_pairs=pairs();raw=trim_network(raw,data['nodes'],all_pairs);net=Network(raw)
 for n in data['nodes']:
  if n['coordinate']:net.snap(n)
 print('OSM anchors',len(net.anchors),'of',data['counts']['located'],flush=True)
 net.compile();print('compiled walking graph',net.graph.shape[0],'vertices',net.graph.nnz,'directed edges',flush=True)
 existing={tuple(sorted((s['fromId'],s['toId']))) for s in data['spans']};gaps=[];todo=collections.defaultdict(list);used_ways=set()
 for p in all_pairs:
  a,b=p['fromId'],p['toId']
  if tuple(sorted((a,b))) in existing:continue
  if not by[a]['coordinate'] or not by[b]['coordinate']:gaps.append({**p,'reason':'missing-coordinate'});continue
  if a not in net.anchors or b not in net.anchors:gaps.append({**p,'reason':'no-OSM-anchor-within-120m'});continue
  todo[a].append(p)
 completed=0
 for number,(a,ps) in enumerate(todo.items()):
  start=net.anchors[a]['index'];costs,prev=dijkstra(net.graph,directed=True,indices=start,return_predecessors=True,limit=80000)
  for p in ps:
   b=p['toId'];end=net.anchors[b]['index'];total=costs[end]
   if not math.isfinite(total):gaps.append({**p,'reason':'disconnected-OSM-topology'});continue
   direct=distance(by[a]['coordinate'],by[b]['coordinate'])
   limit=max(2000,direct*6+300)
   if p['minutes']:limit=min(limit,1000+p['minutes']*100)
   if total>limit:gaps.append({**p,'reason':'OSM-route-detour-needs-review','routeDistanceMeters':round(total),'straightDistanceMeters':round(direct)});continue
   indices=[int(end)];current=int(end)
   while current!=start:
    current=int(prev[current])
    if current<0:raise ValueError('Broken routing predecessor')
    indices.append(current)
   indices.reverse()
   if len(indices)<2:gaps.append({**p,'reason':'different-nodes-share-one-anchor-needs-review'});continue
   coords=[[round(v,7) for v in net.coords[i]] for i in indices]
   try:pr=profile(coords,dem)
   except (KeyError,ValueError) as e:gaps.append({**p,'reason':'route-DEM-unavailable','detail':str(e)});continue
   wi=net.source_ways(indices);used_ways.update(wi)
   span={'id':'osm-full-'+hashlib.sha256((a+'>'+b).encode()).hexdigest()[:16],'fromId':a,'toId':b,'fromAnchor':coords[0],'toAnchor':coords[-1],'coordinates':coords,'profile':pr,'distanceMeters':pr[-1][0],'reversible':net.reversible(indices),'status':'OSM-derived-planning-route','ownerConfirmed':p['ownerConfirmed'],'sourceWayIds':[raw['ways'][i]['id'] for i in wi],'groups':p['groups'],'routingMethod':'Shortest permitted OSM walking distance between projections on existing edges; no off-trail connectors'}
   data['spans'].append(span);completed+=1
  if (number+1)%25==0:print('routed origins',number+1,'new spans',completed,'gaps',len(gaps),flush=True)
 anchors=[{k:v for k,v in a.items() if k!='index'} for a in net.anchors.values()]
 data['pilotSource']=data['source'];data['source']={**raw['source'],'attribution':'© OpenStreetMap contributors'}
 data.update(id='full-route-osm-rudy-dem-20261103',terrainSource=dem.provenance(),routingSource=raw['source'],routingAnchors=anchors,coverage={'routePairs':len(all_pairs),'newOSMSpans':completed,'routeDataGaps':gaps,'elevationDataGaps':height_gaps})
 data['notes']=['節點海拔與沿線升降來自魯地圖DEM。','步道線形按OSM真實連通節點及允許步行路段計算；規劃路線不代表現況開放或官方實測。','標記點與步道投影錨點分開；不畫離徑直線，也不跨來源缺口補線。','使用者暫未補齊的座標及來源本身未連通的路段，在coverage中逐段記錄。']
 source={'source':raw['source'],'ways':[{k:v for k,v in raw['ways'][i].items() if k!='refs'} for i in sorted(used_ways)]}
 return data,source
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('network',type=Path);a.add_argument('dem',type=Path);v=a.parse_args();d,s=build(v.network,v.dem)
 (ROOT/'data/geometry/planner-terrain-v1.json').write_text(json.dumps(d,ensure_ascii=False,separators=(',',':'))+'\n')
 (ROOT/'data/geometry/sources/full-route-osm-used-20261103.json').write_text(json.dumps(s,ensure_ascii=False,separators=(',',':'))+'\n')
 print('full coverage',collections.Counter(p['reason'] for p in d['coverage']['routeDataGaps']),flush=True)
