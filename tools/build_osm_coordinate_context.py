"""Extract public OSM walking topology for coordinate context (not auto-routing).
Usage: python tools/build_osm_coordinate_context.py TAIWAN_PBF OUTPUT_JSON_GZ
"""
import argparse,gzip,hashlib,json
from pathlib import Path

def build(pbf,output):
 import osmium
 ways=[];needed=set();coords={};tags={}
 class Ways(osmium.SimpleHandler):
  def way(self,w):
   if w.tags.get('highway') not in ('path','footway','track','steps','pedestrian'):return
   if w.tags.get('access') in ('no','private') or w.tags.get('foot') in ('no','private'):return
   refs=[n.ref for n in w.nodes];needed.update(refs);ways.append({'id':w.id,'version':w.version,'refs':refs})
 osmium.apply(str(pbf),osmium.filter.KeyFilter('highway'),Ways())
 class Nodes(osmium.SimpleHandler):
  def node(self,n):
   p=[n.location.lon,n.location.lat]
   if 120.4<=p[0]<=121.9 and 22.2<=p[1]<=24.8:
    coords[n.id]=p
    t=dict(n.tags)
    if t:tags[n.id]=t
 osmium.apply(str(pbf),osmium.filter.IdFilter(needed),Nodes())
 ways=[w for w in ways if all(r in coords for r in w['refs'])]
 used={r for w in ways for r in w['refs']}
 out={'source':'https://download.geofabrik.de/asia/taiwan-latest.osm.pbf','sourceSha256':hashlib.file_digest(pbf.open('rb'),'sha256').hexdigest(),'nodes':{r:coords[r] for r in used},'tags':{r:tags[r] for r in used if r in tags},'ways':ways}
 with gzip.open(output,'wt') as f:json.dump(out,f,separators=(',',':'))
 print('walking context nodes',len(used),'ways',len(ways))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('pbf',type=Path);p.add_argument('output',type=Path);a=p.parse_args();build(a.pbf,a.output)
