"""Extract a pinned OSM walking network. Raw country extract/cache stays outside Git."""
import argparse,gzip,hashlib,json
from pathlib import Path
ALLOWED={'path','footway','track','steps','pedestrian','service','unclassified','residential','living_street','tertiary','tertiary_link','secondary','secondary_link','primary','primary_link'}
def eligible(tags):
 if tags.get('highway') not in ALLOWED:return False
 if tags.get('foot') in ('no','private'):return False
 if tags.get('access') in ('no','private') and tags.get('foot') not in ('yes','designated','permissive'):return False
 if tags.get('construction') or tags.get('proposed'):return False
 if any(x in tags.get('foot:conditional','') for x in ('no','private')):return False
 if tags.get('area')=='yes' or tags.get('motorroad')=='yes':return False
 return True
def extract(pbf,dest):
 import osmium
 ways=[];needed=set();nodes={};blocked=set()
 class Ways(osmium.SimpleHandler):
  def way(self,w):
   if w.tags.get('highway') not in ALLOWED:return
   t=dict(w.tags)
   if not eligible(t):return
   refs=[n.ref for n in w.nodes]
   if len(refs)<2:return
   needed.update(refs);ways.append({'id':w.id,'version':w.version,'timestamp':str(w.timestamp),'refs':refs,'tags':t})
 Ways().apply_file(str(pbf));print('eligible ways',len(ways),'needed nodes',len(needed),flush=True)
 class Nodes(osmium.SimpleHandler):
  def node(self,n):
   if n.id not in needed:return
   lon,lat=n.location.lon,n.location.lat
   if not (120.3<=lon<=122 and 22.1<=lat<=25):return
   t=dict(n.tags)
   if t.get('access') in ('no','private') or t.get('foot') in ('no','private') or t.get('barrier') in ('wall','fence','block'):blocked.add(n.id)
   nodes[n.id]=[lon,lat]
 Nodes().apply_file(str(pbf))
 ways=[w for w in ways if all(i in nodes for i in w['refs'])]
 out={'schemaVersion':1,'source':{'name':'OpenStreetMap / Geofabrik Taiwan','url':'https://download.geofabrik.de/asia/taiwan-latest.osm.pbf','retrievedDate':'2026-11-03','sha256':hashlib.file_digest(pbf.open('rb'),'sha256').hexdigest(),'license':'ODbL 1.0','copyrightUrl':'https://www.openstreetmap.org/copyright'},'nodes':nodes,'blockedNodeIds':sorted(blocked),'ways':ways}
 with gzip.open(dest,'wt') as f:json.dump(out,f,separators=(',',':'))
 print('saved network',len(nodes),'nodes',len(ways),'ways',flush=True)
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('pbf',type=Path);a.add_argument('output',type=Path);v=a.parse_args();extract(v.pbf,v.output)
