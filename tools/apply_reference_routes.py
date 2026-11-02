"""Supplement OSM gaps using provenance-pinned, continuous historical source clips."""
import argparse,hashlib,json,math
from pathlib import Path
from build_planner_geometry import ROOT
from build_full_terrain import profile
from build_xueshan_geometry import distance
from full_dem import Dem

def apply(data,clips,dem):
 by={n['nodeId']:n for n in data['nodes']};existing={s['id'] for s in data['spans']};sources=[s for s in data.get('additionalSources',[]) if s['id'] in existing];added=0
 for clip in clips['routes']:
  a,b=clip['fromId'],clip['toId'];gap=next((g for g in data['coverage']['routeDataGaps'] if {g['fromId'],g['toId']}=={a,b}),None)
  if gap is None:continue # OSM priority if a later snapshot supplies the route.
  if gap['reason']=='missing-coordinate':raise ValueError('A source clip cannot silently assign missing label coordinates')
  coords=clip['coordinates']
  if len(coords)<2 or any(len(p)!=2 or not all(math.isfinite(v) for v in p) for p in coords):raise ValueError('Invalid historical geometry')
  if max(distance(by[a]['coordinate'],coords[0]),distance(by[b]['coordinate'],coords[-1]))>120.1:raise ValueError('Historical anchor outside matching tolerance')
  if any(distance(x,y)>500 for x,y in zip(coords,coords[1:])):raise ValueError('Source track has a discontinuity')
  pr=profile(coords,dem);rid='reference-'+hashlib.sha256((a+'>'+b).encode()).hexdigest()[:16]
  data['spans'].append({'id':rid,'fromId':a,'toId':b,'fromAnchor':coords[0],'toAnchor':coords[-1],'coordinates':coords,'profile':pr,'distanceMeters':pr[-1][0],'reversible':True,'status':'historical-track-planning-reference','ownerConfirmed':gap['ownerConfirmed'],'groups':gap['groups'],'sourceName':clip['sourceName'],'sourceUrl':clip['sourceUrl'],'sourceFileSha256':clip['sourceFileSha256'],'referenceSourceId':rid,'routingMethod':'Continuous historical source track clipped at projected anchors; no label connectors or joins across track segments'})
  data['coverage']['routeDataGaps'].remove(gap);sources.append({'id':rid,'name':clip['sourceName'],'url':clip['sourceUrl'],'notice':clip['notice']});added+=1
 data['additionalSources']=sources;data['coverage']['historicalReferenceSpans']=sum(s.get('status')=='historical-track-planning-reference' for s in data['spans']);data['coverage']['positionedPairs']=sum(bool(by[g['fromId']]['coordinate']) and bool(by[g['toId']]['coordinate']) for g in data['coverage']['routeDataGaps'])+len(data['spans'])
 data['coverage']['coveredPairs']=len(data['spans']);data['coverage']['positionedRouteGaps']=sum(g['reason']!='missing-coordinate' for g in data['coverage']['routeDataGaps'])
 data['terrainSource']=dem.provenance() # Includes all tiles used for supplementary profiles too.
 note='另以具來源雜湊與剪取索引的歷史山友行跡補足少數OSM缺線；僅作規劃參考，不代表即時通行或官方實測。'
 if note not in data['notes']:data['notes'].append(note)
 return data
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('dem',type=Path);p.add_argument('--clips',type=Path,default=ROOT/'data/geometry/sources/reference-route-clips-v08.json');v=p.parse_args()
 target=ROOT/'data/geometry/planner-terrain-v1.json';d=json.loads(target.read_text());clips=json.loads(v.clips.read_text());dem=Dem(v.dem)
 # Seed provenance already includes tiles used by the OSM build.
 dem.hashes.update(d['terrainSource']['tileSha256'])
 d=apply(d,clips,dem);target.write_text(json.dumps(d,ensure_ascii=False,separators=(',',':'))+'\n');print({k:v for k,v in d['coverage'].items() if k!='routeDataGaps'})
