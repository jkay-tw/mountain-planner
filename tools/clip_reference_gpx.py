"""Clip a continuous public GPX segment between projections of two known labels.
No interpolation between separate tracks, gaps, or the labels and track anchors.
"""
import argparse,hashlib,json,math,xml.etree.ElementTree as ET
from pathlib import Path
from build_planner_geometry import ROOT
from build_xueshan_geometry import distance
from build_xueshan_terrain import project

def clip(path,a,b,max_distance):
 root=ET.parse(path).getroot();best=None
 segments=root.findall('.//{*}trkseg')
 for si,segment in enumerate(segments):
  points=[[float(p.attrib['lon']),float(p.attrib['lat'])] for p in segment.findall('{*}trkpt')]
  if len(points)<2 or any(not all(math.isfinite(v) for v in q) or abs(q[0])>180 or abs(q[1])>90 for q in points):continue
  cumulative=[0]
  for x,y in zip(points,points[1:]):cumulative.append(cumulative[-1]+distance(x,y))
  bad=[0]
  for x,y in zip(points,points[1:]):bad.append(bad[-1]+int(distance(x,y)>500))
  options=[]
  for p in [a,b]:
   near=[]
   for i,(x,y) in enumerate(zip(points,points[1:])):
    if min(distance(p,x),distance(p,y))>distance(x,y)+120:continue
    _,_,f,q=project(p,[x,y]);off=distance(p,q)
    if off<=120:near.append((off,i,f,[round(v,7) for v in q],cumulative[i]+distance(x,q)))
   options.append(near)
  for start in options[0]:
   for end in options[1]:
    ao,ai,af,ap,ad=start;bo,bi,bf,bp,bd=end;total=abs(ad-bd)
    if total<1 or total>max_distance:continue
    lo,hi=sorted((ai,bi))
    if bad[hi+1]!=bad[lo]:continue
    score=ao+bo
    # Preserve the recorded outbound section if equally good return anchors exist.
    key=(round(score,3),round(total,3),si,min(ai,bi))
    if best and key>=best[0]:continue
    if ad<bd:coords=[ap,*points[ai+1:bi+1],bp]
    else:coords=[ap,*reversed(points[bi+1:ai+1]),bp]
    coords=[[round(v,7) for v in p] for p in coords];coords=[p for i,p in enumerate(coords) if not i or p!=coords[i-1]]
    if len(coords)<2:continue
    best=(key,{'coordinates':coords,'anchorOffsetsMeters':[round(ao,2),round(bo,2)],'sourceSegmentIndex':si,'sourceStartEdgeIndex':ai,'sourceEndEdgeIndex':bi,'sourceStartFraction':af,'sourceEndFraction':bf})
 if not best:raise ValueError('No continuous source segment within 120m of both endpoints and route-distance bounds')
 return best[1]
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('gpx',type=Path);p.add_argument('from_id');p.add_argument('to_id');p.add_argument('--source-name',required=True);p.add_argument('--source-url',required=True);p.add_argument('--output',type=Path,required=True);v=p.parse_args()
 data=json.loads((ROOT/'data/geometry/planner-terrain-v1.json').read_text());by={n['nodeId']:n for n in data['nodes']};a,b=by[v.from_id],by[v.to_id]
 gap=next(g for g in data['coverage']['routeDataGaps'] if {g['fromId'],g['toId']}=={v.from_id,v.to_id})
 limit=max(2000,6*distance(a['coordinate'],b['coordinate'])+300)
 if gap['minutes']:limit=min(limit,1000+gap['minutes']*100)
 r=clip(v.gpx,a['coordinate'],b['coordinate'],limit)
 r.update(fromId=v.from_id,toId=v.to_id,sourceName=v.source_name,sourceUrl=v.source_url,sourceFileSha256=hashlib.sha256(v.gpx.read_bytes()).hexdigest(),groups=gap['groups'],ownerConfirmed=gap['ownerConfirmed'],notice='公開山友歷史行跡，僅作規劃參考，不代表目前開放或官方實測；未使用來源記錄時間代替上河時間。')
 v.output.write_text(json.dumps(r,ensure_ascii=False,separators=(',',':'))+'\n');print(a['name'],b['name'],len(r['coordinates']),'vertices',r['anchorOffsetsMeters'])
