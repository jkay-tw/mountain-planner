"""Publish active planning labels while keeping the seven pilot anchors/spans intact."""
import copy,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def build(root=ROOT):
 pilot=json.loads((root/'data/geometry/xueshan-terrain-v1.json').read_text())
 selected=json.loads((root/'data/geometry/all-route-coordinates-v1.json').read_text())
 manifest=json.loads((root/'data/unified-editor-manifest.json').read_text())
 points={n['nodeId']:n for n in selected['nodes']};refs={p['id']:p for p in selected['references']}
 active={}
 for r in manifest['routes']:
  for n in json.loads((root/r['file'].split('?')[0]).read_text())['nodes']:active[n['id']]=n
 existing={n['nodeId']:copy.deepcopy(n) for n in pilot['nodes']};nodes=[]
 for nid,n in active.items():
  if nid in existing:nodes.append(existing[nid]);continue
  p=points.get(nid,{});ref=refs.get(p.get('selectedSource'),{})
  nodes.append({'nodeId':nid,'name':n['name'],'coordinate':p.get('coordinate'),'elevationMeters':p.get('reviewedElevationMeters'),
   'coordinateMethod':p.get('selectionMethod','pending-owner-coordinate'),'coordinateSource':{'id':ref.get('id'),'source':ref.get('source'),'url':ref.get('url')},
   'note':'' if p.get('coordinate') else '座標待補；不推估位置。'})
 result={**pilot,'id':'active-planning-labels-with-xueshan-pilot','nodes':nodes,'labelSources':selected['sourceCatalog'],
  'notes':[*pilot['notes'],'全圖節點座標為多來源規劃標示；只有既有雪山試點含已建線形，其他路段不以直線補接。'],
  'counts':{'activeNodes':len(nodes),'located':sum(bool(n['coordinate']) for n in nodes),'unlocated':sum(not n['coordinate'] for n in nodes)}}
 assert result['spans']==pilot['spans']
 assert all(existing[n['nodeId']]==n for n in nodes if n['nodeId'] in existing)
 return result

if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser(description='Build a pilot-only seed, not the full runtime dataset. Use build_full_terrain.py and apply_reference_routes.py for v0.8.')
 p.add_argument('--seed-output',type=Path,required=True)
 a=p.parse_args()
 if a.seed_output.resolve()==(ROOT/'data/geometry/planner-terrain-v1.json').resolve():p.error('Refusing to replace full-route runtime data with a pilot-only seed')
 d=build();a.seed_output.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');print(d['counts'])
