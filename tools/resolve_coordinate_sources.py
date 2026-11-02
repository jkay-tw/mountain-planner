"""Select practical planning label coordinates with explicit source provenance.
Never merges Node IDs or invents connecting route geometry.
Usage: python tools/resolve_coordinate_sources.py REFERENCE_JSON
"""
import argparse,collections,json,math,re
from pathlib import Path
from build_coordinate_inventory import normalize,search_names as inventory_search_names,load_nodes
ROOT=Path(__file__).resolve().parents[1]
GENERIC=re.compile(r'^(?:水源|停車場|營地|第[一二三四五]營地|岔路|叉路|岔路口|叉路口|登山口(?:[（(].*[）)])?|展望點|風口|上稜點|下切點|溪源|木屋|工寮|獵寮|瀑布|崩壁|鞍部|獵寮營地|水池|三岔路口|四岔路口)$')
GENERIC=re.compile('^(?:'+GENERIC.pattern[4:-2]+r'|(?:主?[東西南北中]+峰?)(?:岔路口|叉路口|岔路|叉路|岔口|叉口|營地|前營地|登山口)|森林營地|松林營地|溪床營地|水池營地|最低鞍部|最後農家|最後水源|廢棄工寮|第[一二三四五]獵寮)$')

def search_names(node):
 exact,variants=inventory_search_names(node)
 extra=[]
 for name in [*exact,*variants]:
  # Preserve the itinerary's kilometre label. Search only the named feature
  # after it; a bare kilometre marker is never turned into a generic point.
  m=re.match(r'^\d+(?:\.\d+)?\s*[kK]\s+(.+)$',name)
  if m:extra.append(m[1])
  m=re.match(r'^(.{2,})山([東西南北]+峰)$',name)
  if m:extra.append(m[1]+m[2])
 return exact,sorted(set(variants+extra))

def distance(a,b):
 x=math.radians(b[1]-a[1]);y=math.radians(b[0]-a[0]);h=math.sin(x/2)**2+math.cos(math.radians(a[1]))*math.cos(math.radians(b[1]))*math.sin(y/2)**2
 return 12742000*math.asin(min(1,math.sqrt(h)))

def key(s):
 s=re.sub(r'[·－\-\s]','',normalize(s).replace('．','.')).casefold().replace('叉','岔').replace('啞口','埡口').replace('峯','峰')
 s=re.sub(r'岔(?:路口|路|口)?(?=登山口|$)','岔',s)
 s=re.sub(r'(?:匯流處|匯流點|合流處|合流點)$','合流',s)
 s=re.sub(r'(上稜|下切)點$',r'\1',s)
 return s

def compatible(name,c):
 t=c.get('tags',{});kind=c.get('category','')
 if c.get('source') in ('official','community-gpx','happyman'):return True
 if re.search(r'(山|峰)(東峰|西峰|南峰|北峰|主峰)?$',name):return kind=='peak' or t.get('natural')=='peak' or t.get('information')=='board' or t.get('summit')=='yes'
 if name.endswith(('山莊','山屋')):return kind=='hut' or t.get('tourism') in ('alpine_hut','wilderness_hut') or t.get('building') in ('hut','cabin','yes') or t.get('amenity')=='shelter'
 if name.endswith('宮'):return t.get('amenity')=='place_of_worship' or kind=='temple'
 return t.get('highway') not in ('bus_stop','residential','primary','secondary','tertiary') and t.get('public_transport') not in ('platform','stop_position')

def cluster_points(candidates,limit):
 clusters=[]
 for c in sorted(candidates,key=lambda c:c['id']):
  group=next((g for g in clusters if all(distance(c['coordinate'],p['coordinate'])<=limit for p in g)),None)
  if group is None:clusters.append([c])
  else:group.append(c)
 return clusters

def preferred(cluster):
 def rank(c):
  src=c['source'];t=c.get('tags',{})
  support=len({x['source'] for x in cluster if distance(c['coordinate'],x['coordinate'])<=30})
  return (-support,0 if src=='official' else 1 if src=='twmap' and c.get('checked') else 2 if src=='osm' and t.get('natural')=='peak' else 3 if src=='twmap' else 4 if c.get('coordinateMethod')=='OSM point' else 5, sum(distance(c['coordinate'],x['coordinate']) for x in cluster),c['id'])
 return min(cluster,key=rank)

def physical_landform_support(cluster):
 peaks=[c for c in cluster if c.get('tags',{}).get('natural')=='peak']
 checked=[c for c in cluster if c['source']=='twmap' and c.get('checked')]
 if any(distance(a['coordinate'],b['coordinate'])<=30 for a in peaks for b in checked):return 2
 if any(c.get('tags',{}).get('mountain_pass')=='yes' or c.get('tags',{}).get('natural')=='saddle' for c in cluster):return 1
 return 0

def coherent_anchor_points(points):
 unique=[]
 for p in points:
  if not any(distance(p,q)<100 for q in unique):unique.append(p)
 if len(unique)<3:return unique
 remaining=set(range(len(unique)));components=[]
 while remaining:
  group={remaining.pop()};queue=list(group)
  while queue:
   a=queue.pop();near={i for i in remaining if distance(unique[a],unique[i])<=25000}
   remaining-=near;group|=near;queue.extend(near)
  components.append(group)
 biggest=max(components,key=len)
 return [unique[i] for i in sorted(biggest)]

def resolve(inventory,reference):
 records=inventory['nodes'];by_id={n['nodeId']:n for n in records};objects={c['id']:c for c in reference['points']}
 for n in records:
  for c in [*n['candidates'],*n.get('rejectedCandidates',[])]:
   objects.setdefault('osm:'+c['osmRef'],{**c,'id':'osm:'+c['osmRef'],'source':'osm','name':c['tags'].get('name',n['name']),'aliases':[],'url':'https://www.openstreetmap.org/'+c['osmRef']})
 lookup=collections.defaultdict(dict)
 for c in objects.values():
  for label in [c['name'],*c.get('aliases',[])]:lookup[key(label)][c['id']]=c
 anchors=collections.defaultdict(list)
 for n in records:
  if n['status']=='available':
   for g in n['groups']:anchors[g].append(n['coordinate'])
  elif n['neighbors'] and n['status']=='single-candidate' and n['candidates'][0].get('tags',{}).get('natural')=='peak':
   for g in n['groups']:anchors[g].append(n['candidates'][0]['coordinate'])
 for group,points in anchors.items():anchors[group]=coherent_anchor_points(points)
 def in_region(n,c):
  boxes=[]
  for g in n['groups']:
   pts=anchors[g]
   if len(pts)>=1:boxes.append((min(p[0] for p in pts)-.16,min(p[1] for p in pts)-.16,max(p[0] for p in pts)+.16,max(p[1] for p in pts)+.16))
  return not boxes or any(a<=c['coordinate'][0]<=b and d<=c['coordinate'][1]<=e for a,d,b,e in boxes)
 candidates={};selected={};reasons={}
 for n in records:
  if n['status']=='available':
   selected[n['nodeId']]={'nodeId':n['nodeId'],'name':n['name'],'coordinate':n['coordinate'],'selectionMethod':'existing-user-reviewed-pilot','sourceRefs':[],'sourceCount':1,'spreadMeters':0};continue
  choices={}
  for labels in search_names(n):
   for label in labels:choices.update(lookup.get(key(label),{}))
  for label in (n['name'],*n.get('aliases',[])):
   variants=[]
   if '岔路登山口' in label:variants.append(label.replace('岔路登山口','登山口'))
   if label.endswith('毀損'):variants.extend((label[:-2]+'遺址',label[:-2]+'舊址'))
   for variant in variants:choices.update(lookup.get(key(variant),{}))
  for c in list(choices.values()):
   if c['source'] in ('twmap','official'):
    for label in c.get('aliases',[]):choices.update(lookup.get(key(label),{}))
  if not GENERIC.fullmatch(n['name']):
   for labels in search_names(n):
    for label in labels:
     target=key(label)
     if len(target)<2:continue
     for external,cs in lookup.items():
      prefix=external[:-len(target)] if external.endswith(target) else None
      suffix=external[len(target):] if external.startswith(target) else None
      # Administrative/route prefixes are search evidence, but directional
      # summit prefixes or an added hut/peak/trailhead suffix denote other POIs.
      qualified=(prefix is not None and prefix and prefix[-1] not in '東西南北大小中前後上下') or suffix in ('駐在所','駐在所遺址','遺址')
      if qualified:
       for i,c in cs.items():choices.setdefault(i,c)
  candidates[n['nodeId']]=[c for c in choices.values() if (compatible(n['name'],c) or (not n['neighbors'] and c.get('tags',{}).get('place') in ('city','town','village','hamlet'))) and in_region(n,c) and (n['neighbors'] or (c.get('category')!='peak' and c.get('tags',{}).get('natural')!='peak'))]
 # Use reviewed walking times only to reject implausible locations, not to infer coordinates.
 _,nodes=load_nodes();limits={}
 manifest=json.loads((ROOT/'data/unified-editor-manifest.json').read_text())
 for route in manifest['routes']:
  r=json.loads((ROOT/route['file'].split('?')[0]).read_text())
  for s in r['segments']:
   if s.get('travelMode')=='walking' and s.get('routingEnabled') is not False:
    k=(s['fromId'],s['toId']);value=1000+float(s['minutes'])*100
    limits[k]=max(limits.get(k,0),value);limits[k[::-1]]=max(limits.get(k[::-1],0),value)
 def context(n,cluster):
  pts=[]
  for other in n['neighbors']:
   if other['nodeId'] in selected:
    p=selected[other['nodeId']]['coordinate'];limit=limits.get((n['nodeId'],other['nodeId']),30000)
    pts.append((p,limit))
  distinct=[]
  for p,limit in pts:
   if not any(distance(p,q)<100 for q,_ in distinct):distinct.append((p,limit))
  if any(all(distance(c['coordinate'],p)>limit for c in cluster) for p,limit in distinct):return None
  score=sum(min(distance(c['coordinate'],p) for c in cluster)/limit for p,limit in distinct)/max(1,len(distinct))
  return len(distinct),score
 for iteration in range(5):
  added=0
  for n in records:
   nid=n['nodeId']
   if nid in selected:continue
   choices=candidates[nid];limit=150 if re.search(r'(山|峰)$',n['name']) else 80
   clusters=cluster_points(choices,limit);valid=[]
   for cluster in clusters:
    ctx=context(n,cluster)
    if ctx is not None:valid.append((cluster,ctx))
   generic=bool(GENERIC.fullmatch(n['name']));winner=None;method=None
   if len(valid)==1 and (not generic or valid[0][1][0]>=2):
    winner=valid[0][0];method='nearby-source-cluster' if len(winner)>1 else 'named-source-with-route-context'
    if not generic and valid[0][1][0]==0 and len(anchors[n['groups'][0]])<1 and len({c['source'] for c in winner})<2 and not any(c['source']=='official' for c in winner):winner=None
   elif len(valid)>1:
    ordered=sorted(valid,key=lambda x:(-len({c['source'] for c in x[0]}),x[1][1]))
    a,b=ordered[:2];sources_a=len({c['source'] for c in a[0]});sources_b=len({c['source'] for c in b[0]})
    if (not generic and sources_a>=2 and sources_a>sources_b) or (a[1][0]>=2 and a[1][1]<.5*b[1][1]):
     winner=a[0];method='source-agreement-and-neighbor-context'
    if winner is None and not generic:
     landforms=sorted(valid,key=lambda x:-physical_landform_support(x[0]))
     if physical_landform_support(landforms[0][0])>physical_landform_support(landforms[1][0]):
      winner=landforms[0][0];method='physical-landform-source-priority'
   if winner:
    c=preferred(winner);spread=max((distance(a['coordinate'],b['coordinate']) for a in winner for b in winner),default=0)
    selected[nid]={'nodeId':nid,'name':n['name'],'coordinate':c['coordinate'],'selectionMethod':method,'selectedSource':c['id'],'sourceRefs':[p['id'] for p in winner],'sourceCount':len({p['source'] for p in winner}),'spreadMeters':round(spread,1)};added+=1
    if re.search(r'(山|峰)$',n['name']) and not GENERIC.fullmatch(n['name']):
     for group in n['groups']:
      if not any(distance(c['coordinate'],p)<100 for p in anchors[group]):anchors[group].append(c['coordinate'])
   else:reasons[nid]='no-compatible-source' if not choices else 'generic-name-needs-neighbor-evidence' if generic else 'separated-source-clusters-or-route-conflict'
  if not added:break
 # Revalidate early selections after neighboring anchors become available.
 # A globally unique name can still be a different mountain (e.g. 新山).
 for iteration in range(4):
  remove=set()
  for (a,b),limit in limits.items():
   if a>=b or a not in selected or b not in selected:continue
   ca,cb=selected[a],selected[b]
   if distance(ca['coordinate'],cb['coordinate'])<=limit:continue
   def strength(c):return 100 if c['selectionMethod']=='existing-user-reviewed-pilot' else c['sourceCount']
   sa,sb=strength(ca),strength(cb)
   if sa<sb:remove.add(a)
   elif sb<sa:remove.add(b)
   else:
    if sa<100:remove.update((a,b))
  if not remove:break
  for nid in remove:selected.pop(nid);reasons[nid]='conflicting-neighbor-locations'
 output=[]
 for n in records:
  if n['nodeId'] in selected:output.append({**selected[n['nodeId']],'groups':n['groups'],'status':'selected-planning-coordinate'})
  else:output.append({'nodeId':n['nodeId'],'name':n['name'],'groups':n['groups'],'coordinate':None,'status':'unresolved','reason':reasons[n['nodeId']],'candidateRefs':[c['id'] for c in candidates[n['nodeId']]],'neighbors':n['neighbors']})
 used={ref for n in output for ref in [*n.get('sourceRefs',[]),*n.get('candidateRefs',[])]}
 considered=sorted({c['id'] for choices in candidates.values() for c in choices})
 return {'schemaVersion':1,'date':'2026-11-02','coordinateSystem':'WGS84 lon,lat','purpose':'Planning label points; not verified trail anchors or routing edges','policy':{'peakClusterMeters':150,'otherClusterMeters':80,'note':'Distances are cluster diameters, never chained proximity; selected points are source coordinates, not averages. Existing seven pilot points preserved.'},'counts':dict(collections.Counter(n['status'] for n in output)),'sourceCatalog':reference['sources'],'consideredReferenceIds':considered,'nodes':output,'references':[objects[i] for i in sorted(used)]}

def write_report(data,path):
 nodes=data['nodes'];chosen=[n for n in nodes if n['coordinate']];unresolved=[n for n in nodes if not n['coordinate']];multi=sum(n.get('sourceCount',0)>1 for n in chosen)
 refs={r['id']:r for r in data['references']};safe=lambda s:str(s).replace('|','／').replace('\n',' ')
 lines=['# 全路線多來源座標選定與剩餘缺失','',f'共 {len(nodes)} 個節點；已選定規劃點位 {len(chosen)} 點（其中多來源相符 {multi} 點），剩餘 {len(unresolved)} 點。既有雪山 7 點保持不變。','',
 '使用者已授權近距離候選直接選取較可靠來源。山峰候選直徑不超過 150m、其他具名點不超過 80m 時可選實際來源代表點，不平均出新座標；同名泛稱仍需相鄰路線證據。先考量來源在 30m 內的相互支持，再比較官方、TWMap 已檢查點、OSM 地物等來源；不因標示官方就盲目採用偏移點。這些是行程標示規劃點位，未宣稱官方核實，也未當作步道錨點或新增路線。','',
 '來源間可能共用上游資料，多來源相符不等於多份獨立實測。山屋、舊址、營地與停機坪維持不同實體；不因接近就更改 Node ID。','',
 '## 剩餘缺失','','|圖組|Node ID|地點|相鄰節點|待處理原因|','|---|---|---|---|---|']
 reasons={'no-compatible-source':'尚缺相容的具名來源','generic-name-needs-neighbor-evidence':'泛稱地點，支路證據不足','separated-source-clusters-or-route-conflict':'來源分離或相鄰路線不一致','conflicting-neighbor-locations':'與已定位的相鄰路段距離不符','unconnected-single-source-needs-route-evidence':'無步行鄰點且僅單一來源，需核對接駁位置'}
 for n in unresolved:lines.append('|'+ '|'.join(map(safe,['、'.join(n['groups']),n['nodeId'],n['name'],'、'.join(x['name'] for x in n['neighbors']),reasons.get(n['reason'],n['reason'])]))+'|')
 lines+=['','## 已選定點位','','|圖組|Node ID|地點|WGS84 緯度,經度|採用來源|選定方式|同組來源最大差距 m|','|---|---|---|---|---|---|---:|']
 methods={'existing-user-reviewed-pilot':'既有雪山已確認點','nearby-source-cluster':'近距離來源群代表點','named-source-with-route-context':'具名來源及圖組位置','source-agreement-and-neighbor-context':'來源相符及相鄰節點比對','physical-landform-source-priority':'較可靠的峰頂／鞍部地物來源','happyman-explicit-peak-role-review':'Happyman 最高峰／基點峰分別核對','named-feature-supported-by-osm-walking-topology':'具名地物較符合 OSM 步道','unique-osm-junction-of-three-reviewed-branches':'三支路唯一交會點（推定）','sole-compatible-osm-poi-between-reviewed-neighbors':'鄰點間唯一相容地物（推定）'}
 for n in chosen:
  c=refs.get(n.get('selectedSource'));src='既有雪山已確認點' if not c else f"[{c['source']}：{c['name']}]({c['url']})"
  lines.append('|'+ '|'.join(map(safe,['、'.join(n['groups']),n['nodeId'],n['name'],f"{n['coordinate'][1]:.7f}, {n['coordinate'][0]:.7f}",src,methods.get(n['selectionMethod'],n['selectionMethod']),n.get('spreadMeters',0)]))+'|')
 lines+=['','## 來源','','']
 for s in data['sourceCatalog']:lines.append(f"- [{s['title']}]({s['url']})；取得日期 {s['retrievedDate']}。")
 if data.get('recheck'):lines[4:4]=['[Happyman 複核結果及志佳陽兩峰修正](HAPPYMAN_COORDINATE_RECHECK_20261102.md)。','']
 path.write_text('\n'.join(lines)+'\n')

def main():
 p=argparse.ArgumentParser();p.add_argument('reference',type=Path);a=p.parse_args()
 inventory=json.loads((ROOT/'data/audits/all-route-coordinate-inventory-20261102.json').read_text());reference=json.loads(a.reference.read_text())
 data=resolve(inventory,reference);dest=ROOT/'data/geometry/all-route-coordinates-v1.json';dest.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');write_report(data,ROOT/'docs/ALL_ROUTE_COORDINATE_RESOLUTION_20261102.md');print(data['counts'])
if __name__=='__main__':main()
