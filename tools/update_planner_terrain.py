"""Incrementally apply owner coordinates and route only affected/missing spans.

Retains unaffected source geometries, including historical GPX. Unknown intermediate
labels are represented by explicit ordered viaNodeIds, never fabricated coordinates.
"""
import argparse,collections,copy,gzip,hashlib,json,math
from pathlib import Path
from scipy.sparse.csgraph import dijkstra
from build_full_terrain import Network,trim_network,profile,pairs
from build_planner_geometry import ROOT
from build_xueshan_geometry import distance
from full_dem import Dem
from apply_reference_routes import apply as apply_reference

RUNTIME=ROOT/'data/geometry/planner-terrain-v1.json'
OVERRIDES=ROOT/'data/geometry/sources/owner-coordinate-overrides.json'

def catalog():
 nodes={};edges={};manual={}
 manifest=json.loads((ROOT/'data/unified-editor-manifest.json').read_text())
 for entry in manifest['routes']:
  r=json.loads((ROOT/entry['file'].split('?')[0]).read_text())
  nodes.update({n['id']:n for n in r['nodes']})
  for e in r['segments']:
   if e.get('travelMode','walking')=='walking' and e.get('routingEnabled',True):edges[(e['fromId'],e['toId'])]=e
  for e in r.get('manualConnections',[]):manual[(e['fromId'],e['toId'])]=e
 return nodes,edges,manual

def missing_chains(by,edges):
 """Only unlocated interiors; stop at every known anchor or repeated node.
 Keeps distinct forks as distinct ordered sequences. No manual/vehicle crossing.
 """
 adj=collections.defaultdict(set)
 for a,b in edges:adj[a].add(b)
 out=set()
 def walk(path):
  end=path[-1]
  if by[end].get('coordinate'):
   if len(path)>2:out.add(tuple(path))
   return
  for n in sorted(adj[end]):
   if n not in path:walk([*path,n])
 for start in sorted(adj):
  if by[start].get('coordinate'):
   for n in sorted(adj[start]):
    if not by[n].get('coordinate'):walk([start,n])
 # Canonical orientation only when the complete source chain is reversible.
 return sorted(p for p in out if tuple(reversed(p)) not in out or p<tuple(reversed(p)))

def update(network_path,dem_path,overrides=OVERRIDES,runtime=RUNTIME,retry_missing=False):
 data=json.loads(runtime.read_text());original=copy.deepcopy(data)
 review=json.loads(overrides.read_text());active,edges,manual=catalog();old={n['nodeId']:n for n in data['nodes']}
 corrections_path=ROOT/'data/geometry/sources/owner-update-source-corrections.json'
 corrections=json.loads(corrections_path.read_text()) if corrections_path.exists() else {'nodes':[]}
 clips_path=ROOT/'data/geometry/sources/owner-update-reference-clips.json'
 clips=json.loads(clips_path.read_text()) if clips_path.exists() else {'routes':[]}
 fingerprint=hashlib.sha256(json.dumps([review,active,list(edges.items()),list(manual.items()),corrections,clips],sort_keys=True,ensure_ascii=False).encode()).hexdigest()
 if data.get('ownerUpdateInputFingerprint')==fingerprint and not retry_missing:
  return {'noChanges':True,'preservedSpans':len(data['spans']),'generatedSpans':0,'changedNodeIds':[],'removedNodeIds':[],'counts':data['counts'],'failedRoutes':data['coverage'].get('bridgeFailures',[])}
 walking={n for pair in [*edges,*manual] for n in pair};dem=Dem(dem_path);changed=set();nodes=[]
 choices={r['nodeId']:r for r in review['nodes']}
 for nid,n in active.items():
  item=copy.deepcopy(old.get(nid,{'nodeId':nid,'coordinate':None,'elevationMeters':None}));item['name']=n['name'];r=choices.get(nid)
  correction=next((c for c in corrections['nodes'] if c['nodeId']==nid),None)
  if correction:
   if item.get('coordinate')!=correction['coordinate']:changed.add(nid)
   item.update(coordinate=correction['coordinate'],coordinateMethod='source-role-correction-20261104',coordinateSource={'source':'happyman' if correction['coordinate'] else 'rejected-source','url':correction.get('sourceUrl'),'rawName':correction.get('rawName')},note=correction['reason'])
   if not item['coordinate']:item['elevationMeters']=None
  if r and r['action']=='coordinate':
   if item.get('coordinate')!=r['coordinate']:changed.add(nid)
   source=r.get('source',{})
   provenance={'source':'owner-review','url':review['sourceUrl'],'reviewId':r['reviewId'],'fileSha256':review['sourceFileSha256']}
   if source.get('url'):provenance={'source':'owner-review','reviewId':r['reviewId'],**source}
   if source.get('kind')=='owner-chat':provenance={'source':'owner-chat','reviewId':r['reviewId'],**source}
   method='owner-chat-coordinate' if source.get('kind')=='owner-chat' else 'owner-sheet-coordinate' if source.get('url') else 'owner-workbook-coordinate'
   item.update(coordinate=r['coordinate'],coordinateMethod=method,coordinateSource=provenance,note=r.get('note','') if source.get('url') or source.get('kind')=='owner-chat' else '')
  item['coordinatePolicy']='ignored' if r and r['action']=='ignore' else 'vehicle-only' if nid not in walking else 'active'
  if item['coordinatePolicy']!='active':
   if item.get('coordinate'):changed.add(nid)
   item['coordinate']=None;item['elevationMeters']=None
   item['note']='使用者指定忽略座標' if item['coordinatePolicy']=='ignored' else '僅車行用途，不顯示座標'
  elif item.get('coordinate') and (nid in changed or item.get('elevationMeters') is None):
   item['elevationMeters']=round(dem.sample(item['coordinate']),1);item['elevationSource']='rudy-dem'
  nodes.append(item)
 removed=set(old)-set(active);changed|=removed;data['nodes']=nodes;by={n['nodeId']:n for n in nodes}
 # Preserve immutable spans unless an endpoint/interior was updated or retired.
 kept=[s for s in data['spans'] if not set([s['fromId'],*s.get('viaNodeIds',[]),s['toId']])&changed and all(n in active for n in [s['fromId'],*s.get('viaNodeIds',[]),s['toId']])]
 keys={tuple([s['fromId'],*s.get('viaNodeIds',[]),s['toId']]) for s in kept}
 for s in kept:
  if not s.get('intermediateCoordinatesUnknown'):keys.add((s['fromId'],s['toId']))
  if s.get('reversible'):keys.add(tuple(reversed([s['fromId'],*s.get('viaNodeIds',[]),s['toId']])))
  if s.get('reversible') and not s.get('intermediateCoordinatesUnknown'):keys.add((s['toId'],s['fromId']))
 route_pairs=pairs();chains=missing_chains(by,edges);jobs=[]
 for p in route_pairs:
  path=(p['fromId'],p['toId'])
  if path not in keys and all(by[n].get('coordinate') for n in path):jobs.append((path,p))
 for path in chains:
  if path not in keys:jobs.append((path,{'groups':[],'minutes':sum(edges[(a,b)]['minutes'] for a,b in zip(path,path[1:])),'bridge':True}))
 context=route_pairs+[{'fromId':p[0],'toId':p[-1]} for p in chains]
 failed=[];generated=[]
 if jobs:
  with gzip.open(network_path,'rt') as f:raw=json.load(f)
  net=Network(trim_network(raw,nodes,context))
  for n in nodes:
   if n.get('coordinate'):net.snap(n,max_offset=300 if n['nodeId'] in choices and choices[n['nodeId']]['action']=='coordinate' else 120)
  net.compile();todo=collections.defaultdict(list)
  for path,meta in jobs:todo[path[0]].append((path,meta))
  for a,batch in todo.items():
   if a not in net.anchors:
    failed.extend({'nodeIds':list(p),'reason':'no-source-anchor-within-policy'} for p,_ in batch);continue
   costs,prev=dijkstra(net.graph,directed=True,indices=net.anchors[a]['index'],return_predecessors=True,limit=80000)
   for path,meta in batch:
    b=path[-1]
    def fail(reason):failed.append({'nodeIds':list(path),'reason':reason})
    if b not in net.anchors:fail('no-source-anchor-within-policy');continue
    start,end=net.anchors[a]['index'],net.anchors[b]['index'];cost=costs[end];direct=distance(by[a]['coordinate'],by[b]['coordinate'])
    if not math.isfinite(cost):fail('disconnected-OSM-topology');continue
    limit=max(2000,direct*4+300)
    if meta.get('minutes'):limit=min(limit,1000+meta['minutes']*100)
    if cost>limit:fail('OSM-route-detour-needs-review');continue
    indices=[int(end)];current=int(end)
    while current!=start:
     current=int(prev[current]);indices.append(current)
    indices.reverse()
    if len(indices)<2:fail('different-nodes-share-one-anchor-needs-review');continue
    coords=[[round(v,7) for v in net.coords[i]] for i in indices]
    try:pr=profile(coords,dem)
    except (KeyError,ValueError):fail('route-DEM-unavailable');continue
    reversible=net.reversible(indices) and (len(path)==2 or all((b,a) in edges for a,b in zip(path,path[1:])))
    span={'id':'owner-update-'+hashlib.sha256('>'.join(path).encode()).hexdigest()[:16],'fromId':a,'toId':b,'viaNodeIds':list(path[1:-1]),'fromAnchor':coords[0],'toAnchor':coords[-1],'anchorOffsetsMeters':[net.anchors[a]['offsetMeters'],net.anchors[b]['offsetMeters']],'coordinates':coords,'profile':pr,'distanceMeters':pr[-1][0],'reversible':reversible,'status':'OSM-derived-planning-route','ownerConfirmed':meta.get('ownerConfirmed',False),'sourceName':'OpenStreetMap','sourceUrl':raw['source']['url'],'groups':meta.get('groups',[]),'sourceWayIds':[raw['ways'][i]['id'] for i in net.source_ways(indices)]}
    if len(path)>2:
     span['routingMethod']='Continuous permitted OSM route between known anchors across ordered unlocated walking labels; interior label positions remain unknown.'
     span['intermediateCoordinatesUnknown']=True
    generated.append(span)
  data['routingAnchors']=[{k:v for k,v in a.items() if k!='index'} for a in net.anchors.values()]
  data['ownerUpdateRoutingSource']=raw['source']
  used={i for s in [*kept,*generated] for i in s.get('sourceWayIds',[])}
  source_path=ROOT/'data/geometry/sources/owner-update-osm-ways.json'
  previous=json.loads(source_path.read_text()) if source_path.exists() else {'ways':[]}
  source_ways={w['id']:w for w in previous['ways']}
  source_ways.update({w['id']:{k:v for k,v in w.items() if k!='refs'} for w in raw['ways'] if w['id'] in used})
  source_path.write_text(json.dumps({'source':raw['source'],'ways':list(source_ways.values())},ensure_ascii=False,separators=(',',':'))+'\n')
 data['spans']=[*kept,*generated]
 branches=collections.defaultdict(list)
 for span in data['spans']:
  if span.get('intermediateCoordinatesUnknown'):branches[tuple(sorted([span['fromId'],span['toId']]))].append(span)
 for variants in branches.values():
  if len(variants)>1:
   for span in variants:span['routingAmbiguity']='相同端點有不同未定位支線；目前線形僅供參考，支線位置待座標確認。'
 covered={tuple(sorted([s['fromId'],s['toId']])) for s in data['spans'] if not s.get('viaNodeIds')}
 # Pilot aggregate spans can also satisfy their historical direct official pair.
 covered|={tuple(sorted([s['fromId'],s['toId']])) for s in data['spans'] if not s.get('intermediateCoordinatesUnknown')}
 fail_pairs={tuple(sorted([f['nodeIds'][0],f['nodeIds'][-1]])):f['reason'] for f in failed}
 data['coverage']['routePairs']=len(route_pairs)
 data['coverage']['routeDataGaps']=[{**p,'reason':'missing-coordinate' if not all(by[n].get('coordinate') for n in [p['fromId'],p['toId']]) else fail_pairs.get(tuple(sorted([p['fromId'],p['toId']])),'unresolved-source-route')} for p in route_pairs if tuple(sorted([p['fromId'],p['toId']])) not in covered]
 data['coverage']['elevationDataGaps']=[{'nodeId':n['nodeId']} for n in nodes if n.get('coordinate') and n.get('elevationMeters') is None]
 dem.hashes.update(data['terrainSource']['tileSha256'])
 if clips['routes']:data=apply_reference(data,clips,dem)
 resolved_pairs={tuple(sorted([s['fromId'],s['toId']])) for s in data['spans']}
 failed=[f for f in failed if tuple(sorted([f['nodeIds'][0],f['nodeIds'][-1]])) not in resolved_pairs or len(f['nodeIds'])>2]
 data['coverage']['positionedPairs']=sum(all(by[n].get('coordinate') for n in [p['fromId'],p['toId']]) for p in route_pairs)
 data['coverage']['coveredPairs']=sum(tuple(sorted([p['fromId'],p['toId']])) in resolved_pairs for p in route_pairs)
 data['coverage']['bridgeSpans']=sum(bool(s.get('intermediateCoordinatesUnknown')) for s in data['spans'])
 represented=set()
 for span in data['spans']:
  sequence=[span['fromId'],*span.get('viaNodeIds',[]),span['toId']]
  represented.update(tuple(sorted([a,b])) for a,b in zip(sequence,sequence[1:]))
 data['coverage']['unrepresentedPairs']=[g for g in data['coverage']['routeDataGaps'] if tuple(sorted([g['fromId'],g['toId']])) not in represented]
 data['counts']={'activeNodes':len(nodes),'located':sum(bool(n.get('coordinate')) for n in nodes),'unlocated':sum(not n.get('coordinate') for n in nodes),'ignored':sum(n['coordinatePolicy']=='ignored' for n in nodes),'vehicleOnly':sum(n['coordinatePolicy']=='vehicle-only' for n in nodes)}
 data['ownerReview']={'sourceUrl':review['sourceUrl'],'sha256':review['sourceFileSha256'],'date':review['reviewDate']}
 data['ownerUpdateInputFingerprint']=fingerprint
 report={'changedNodeIds':sorted(changed),'removedNodeIds':sorted(removed),'preservedSpans':len(kept),'generatedSpans':len(generated),'bridgeSpans':sum(bool(s.get('intermediateCoordinatesUnknown')) for s in data['spans']),'failedRoutes':failed,'counts':data['counts']}
 # Persist dependency index for subsequent targeted updates and no-op detection.
 data['spanDependencies']={n:sorted(s['id'] for s in data['spans'] if n in [s['fromId'],*s.get('viaNodeIds',[]),s['toId']]) for n in active}
 data['coverage']['bridgeFailures']=failed
 runtime.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
 return report

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('network',type=Path);p.add_argument('dem',type=Path);p.add_argument('--overrides',type=Path,default=OVERRIDES);p.add_argument('--output',type=Path,default=RUNTIME);p.add_argument('--retry-missing',action='store_true');p.add_argument('--report',type=Path,default=ROOT/'data/geometry/sources/owner-coordinate-update-report.json');a=p.parse_args()
 report=update(a.network,a.dem,a.overrides,a.output,a.retry_missing)
 if not report.get('noChanges'):a.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print({k:v for k,v in report.items() if k not in ['changedNodeIds','failedRoutes']},flush=True)
