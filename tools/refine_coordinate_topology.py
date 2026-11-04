"""Resolve label points using actual OSM topology, never straight-line interpolation.
Usage: python tools/refine_coordinate_topology.py CONTEXT_JSON_GZ
Requires scipy only for offline context analysis. Runtime UI has no dependency.
"""
import argparse,collections,gzip,itertools,json,math,re
from pathlib import Path
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree
from resolve_coordinate_sources import distance,preferred,cluster_points,write_report,GENERIC
ROOT=Path(__file__).resolve().parents[1]

def refine(data,context):
 ids=list(context['nodes']);coords=np.array([context['nodes'][i] for i in ids]);index={s:i for i,s in enumerate(ids)}
 scale=np.array([111195*math.cos(math.radians(23.5)),111195]);tree=cKDTree(coords*scale)
 rows=[];cols=[];values=[];incidents=collections.defaultdict(set)
 for way in context['ways']:
  seq=[index[str(i)] for i in way['refs']]
  for a,b in zip(seq,seq[1:]):
   if a==b:continue
   value=distance(coords[a],coords[b]);rows.extend((a,b));cols.extend((b,a));values.extend((value,value));incidents[a].add(way['id']);incidents[b].add(way['id'])
 # Duplicate edges represent the same OSM node pair. Retain one distance.
 graph=coo_matrix((values,(rows,cols)),shape=(len(ids),len(ids))).tocsr()
 counts=coo_matrix((np.ones(len(rows)),(rows,cols)),shape=graph.shape).tocsr();graph.data/=counts.data
 del rows,cols,values,counts,context['ways']
 nodes=data['nodes'];byid={n['nodeId']:n for n in nodes};refs={r['id']:r for r in data['references']};anchors={}
 def nearest(point):
  d,i=tree.query(np.array(point)*scale);return float(d),int(i)
 def update_anchor(n):
  if n['coordinate']:
   d,i=nearest(n['coordinate'])
   if d<=200:anchors[n['nodeId']]=i
 for n in nodes:update_anchor(n)
 # For small conflicting label offsets, prefer a compatible physical landform
 # on the actual walking network over an isolated diagram marker.
 for n in nodes:
  if n['coordinate'] or GENERIC.fullmatch(n['name']):continue
  choices=[refs[i] for i in n.get('candidateRefs',[])];clusters=cluster_points(choices,150 if re.search(r'(山|峰)$',n['name']) else 80)
  ranked=sorted([(min(nearest(c['coordinate'])[0] for c in cl),cl) for cl in clusters],key=lambda a:a[0])
  if len(ranked)>=2:
   a,b=ranked[:2]
   diameter=max(distance(x['coordinate'],y['coordinate']) for x in choices for y in choices)
   if a[0]<=50 and b[0]>=max(100,a[0]*3) and diameter<=600:
    cl=a[1];c=preferred(cl)
    n.update(coordinate=c['coordinate'],status='selected-planning-coordinate',selectionMethod='named-feature-supported-by-osm-walking-topology',selectedSource=c['id'],sourceRefs=[p['id'] for p in cl],sourceCount=len({p['source'] for p in cl}),spreadMeters=round(max((distance(x['coordinate'],y['coordinate']) for x in cl for y in cl),default=0),1));update_anchor(n)
 pathcache={}
 def path(a,b):
  k=tuple(sorted((a,b)))
  if k not in pathcache:
   ds,prev=dijkstra(graph,directed=False,indices=a,limit=30000,return_predecessors=True)
   if not np.isfinite(ds[b]):pathcache[k]=None
   else:
    points=[b];cursor=b
    while cursor!=a:
     cursor=int(prev[cursor])
     if cursor<0:break
     points.append(cursor)
    pathcache[k]=points if cursor==a else None
  return pathcache[k]
 selected_count=0
 for iteration in range(4):
  added=0
  for n in nodes:
   if n['coordinate']:continue
   neighbors=[(p['nodeId'],anchors[p['nodeId']]) for p in n.get('neighbors',[]) if p['nodeId'] in anchors]
   # Three distinct branch anchors must meet at a unique existing OSM node.
   chosen=None;method=None;evidence=[]
   if re.search(r'岔|叉|登山口|上稜',n['name']) and '營地' not in n['name'] and len(neighbors)>=3:
    for trio in itertools.combinations(neighbors[:5],3):
     if len({p[1] for p in trio})<3:continue
     paths=[path(a[1],b[1]) for a,b in itertools.combinations(trio,2)]
     if any(p is None for p in paths):continue
     shared=set(paths[0]).intersection(*[set(p) for p in paths[1:]])
     shared={i for i in shared if graph.indptr[i+1]-graph.indptr[i]>=3 and all(distance(coords[i],coords[p[1]])>40 for p in trio)}
     if len(shared)==1:
      chosen=next(iter(shared));method='unique-osm-junction-of-three-reviewed-branches';evidence=[p[0] for p in trio];break
   # A sole compatible mapped camp/spring/trailhead on the path between the
   # itinerary's neighboring anchors can identify an otherwise unnamed POI.
   category='camp' if '營地' in n['name'] else 'water' if n['name'] in ('水源','溪源','水池') else 'trailhead' if '登山口' in n['name'] else None
   if chosen is None and category and len(neighbors)==2 and neighbors[0][1]!=neighbors[1][1]:
    points=path(neighbors[0][1],neighbors[1][1])
    if points:
     matches=[]
     for i in points:
      t=context['tags'].get(ids[i],{})
      compatible=(category=='camp' and t.get('tourism')=='camp_site') or (category=='water' and (t.get('natural')=='spring' or t.get('amenity')=='drinking_water')) or (category=='trailhead' and t.get('highway')=='trailhead')
      if compatible and all(distance(coords[i],coords[p[1]])>40 for p in neighbors):matches.append(i)
     if len(matches)==1:chosen=matches[0];method='sole-compatible-osm-poi-between-reviewed-neighbors';evidence=[p[0] for p in neighbors]
   if chosen is not None:
    ref='osm-context:node/'+ids[chosen];coordinate=coords[chosen].tolist();refs[ref]={'id':ref,'source':'osm','name':context['tags'].get(ids[chosen],{}).get('name','未命名 OSM 步道點'),'coordinate':coordinate,'tags':context['tags'].get(ids[chosen],{}),'url':'https://www.openstreetmap.org/node/'+ids[chosen],'contextSourceSha256':context['sourceSha256'],'incidentOsmWays':sorted(incidents[chosen])}
    n.update(coordinate=coordinate,status='selected-planning-coordinate',selectionMethod=method,selectedSource=ref,sourceRefs=[ref],sourceCount=1,spreadMeters=0,contextNeighborIds=evidence);update_anchor(n);added+=1
  selected_count+=added
  if not added:break
 data['counts']=dict(collections.Counter(n['status'] for n in nodes));data['references']=list(refs.values());data['topologyContext']={'sourceSha256':context['sourceSha256'],'note':'OSM node identity connects edges; only unique existing intersections or compatible mapped POIs selected. No averaged or interpolated coordinates.'}
 print('context',len(ids),'nodes; inferred',selected_count,'points; counts',data['counts']);return data

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('context',type=Path);a=p.parse_args();file=ROOT/'data/geometry/all-route-coordinates-v1.json';data=json.loads(file.read_text())
 with gzip.open(a.context,'rt') as f:context=json.load(f)
 result=refine(data,context);file.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');write_report(result,ROOT/'docs/ALL_ROUTE_COORDINATE_RESOLUTION_20261102.md')
