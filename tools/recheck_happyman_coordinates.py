"""Recheck missing nodes only; preserve accepted coordinates except reviewed peak roles.
Supply the pre-recheck baseline explicitly (Git commit 9077ba5). Raw .map stays external.
"""
import argparse,collections,copy,json,re
from pathlib import Path
from resolve_coordinate_sources import ROOT,resolve,distance,write_report
HIGH='node:847092e10ea33bbd9eeb'
BASE='node:94e1beaedf30d622dec0'
OFFICIAL='https://www.taiwan.nps.gov.tw/home/zh-tw/trails/21230'
OSM_HIGH={'id':'osm:node/12031256402','source':'osm','name':'志佳陽大山','aliases':[], 'coordinate':[121.2481508,24.359968],'category':'peak','elevationMeters':3346,'tags':{'natural':'peak','name':'志佳陽大山','ele':'3346'},'osmVersion':2,'osmTimestamp':'2024-10-16T00:37:38Z','url':'https://www.openstreetmap.org/node/12031256402'}

def peak_roles(points):
 high=[p for p in points if '志佳陽' in p.get('rawName','') and re.search(r'最高|主峰',p['rawName']) and distance(p['coordinate'],OSM_HIGH['coordinate'])<150]
 base=[p for p in points if '志佳陽' in p.get('rawName','') and '基點' in p['rawName'] and distance(p['coordinate'],[121.25133,24.35779])<150]
 if not high or not base:raise ValueError('Missing explicitly named peak-role evidence')
 medoid=lambda ps:min(ps,key=lambda p:(sum(distance(p['coordinate'],q['coordinate']) for q in ps),p['id']))
 return high,base,medoid(base)

def recheck(baseline,happyman):
 inventory=json.loads((ROOT/'data/audits/all-route-coordinate-inventory-20261102.json').read_text())
 reference=json.loads((ROOT/'data/geometry/sources/coordinate-reference-points-20261102.json').read_text())
 old={n['nodeId']:n for n in baseline['nodes']};high,base,basepoint=peak_roles(happyman['points'])
 reviewed={}
 for nid,point,elevation,group in [(HIGH,OSM_HIGH,3345,high),(BASE,basepoint,3289,base)]:
  previous=old[nid];refs=[point,*group];refs={p['id']:p for p in refs}
  reviewed[nid]={'nodeId':nid,'name':previous['name'],'groups':previous['groups'],'status':'selected-planning-coordinate','coordinate':point['coordinate'],'selectedSource':point['id'],'sourceRefs':sorted(refs),'sourceCount':len({p['source'] for p in refs.values()}),'spreadMeters':round(max(distance(a['coordinate'],b['coordinate']) for a in refs.values() for b in refs.values()),1),'selectionMethod':'happyman-explicit-peak-role-review','reviewedElevationMeters':elevation,'roleReview':{'officialDescriptionUrl':OFFICIAL,'previousCoordinate':previous['coordinate'],'previousDisplacementMeters':round(distance(previous['coordinate'],point['coordinate']),1) if previous['coordinate'] else None,'nearestHappymanMeters':round(min(distance(point['coordinate'],p['coordinate']) for p in group),1),'note':'Highest summit and southeast triangulation summit are distinct physical locations; raw GPX elevation does not set nominal elevation.'}}
 for n in inventory['nodes']:
  fixed=reviewed.get(n['nodeId']) or old[n['nodeId']]
  if fixed['coordinate']:n.update(status='available',coordinate=fixed['coordinate'])
 reference['sources'].append(happyman['source'])
 reference['points']+=happyman['points']+[OSM_HIGH]
 result=resolve(inventory,reference)
 inv_byid={n['nodeId']:n for n in inventory['nodes']}
 for i,n in enumerate(result['nodes']):
  if n['coordinate'] and not old[n['nodeId']]['coordinate'] and not inv_byid[n['nodeId']]['neighbors'] and n.get('sourceCount',0)<2:
   result['nodes'][i]={'nodeId':n['nodeId'],'name':n['name'],'groups':n['groups'],'status':'unresolved','coordinate':None,'candidateRefs':n.get('sourceRefs',[]),'reason':'unconnected-single-source-needs-route-evidence','neighbors':[]}
 # The resolver uses seeds as context only. Restore original provenance in full.
 for i,n in enumerate(result['nodes']):
  if n['nodeId'] in reviewed:result['nodes'][i]=reviewed[n['nodeId']]
  elif old[n['nodeId']]['coordinate']:result['nodes'][i]=copy.deepcopy(old[n['nodeId']])
  elif 'candidateRefs' in n:n['candidateRefs']=sorted(n['candidateRefs'])
 objects={r['id']:r for r in [*reference['points'],*baseline['references'],*result['references']]}
 used={r for n in result['nodes'] for r in [*n.get('sourceRefs',[]),*n.get('candidateRefs',[])]}
 result['references']=[objects[r] for r in sorted(used)]
 result['counts']=dict(collections.Counter(n['status'] for n in result['nodes']))
 added=[n for n in result['nodes'] if n['coordinate'] and not old[n['nodeId']]['coordinate']]
 result['recheck']={'source':'Happyman.map 20240813_155542','baselineCommit':'9077ba58c84bf6fc8409880fc00ad5bce572fc69','beforeSelected':366,'beforeUnresolved':363,'addedCount':len(added),'correctedNodeIds':[HIGH],'roleReviewedNodeIds':[HIGH,BASE],'preservedAcceptedCount':sum(bool(n['coordinate']) for nid,n in old.items() if nid!=HIGH),'note':'All pre-existing accepted coordinates preserved except explicitly reviewed highest summit. No Node IDs, travel times or runtime routes changed.'}
 considered=set(result['consideredReferenceIds'])|used
 subset={**happyman,'points':[p for p in happyman['points'] if p['id'] in considered]}
 return result,subset

def report(data,baseline,path):
 old={n['nodeId']:n for n in baseline['nodes']};nodes=data['nodes'];refs={r['id']:r for r in data['references']};meta=data['recheck']
 lines=['# Happyman 座標複核（2026-11-02）','',f"729 個節點：原已定位 366、缺少 363；本次新增 {meta['addedCount']} 點，另修正志佳陽最高峰 1 點。現已定位 {data['counts']['selected-planning-coordinate']}、剩餘 {data['counts']['unresolved']}。",'', '## 志佳陽兩個實體','',f'[國家公園志佳陽線說明]({OFFICIAL})明載最高峰 3345m，基點位於東南的 3289m 峰。原「志佳陽大山」座標落在基點峰附近；不能因 TWMap 與 GPX 的同名點相近，就認為是最高峰。','', '|節點|WGS84 緯度,經度|標稱海拔|與明確標名 Happyman 最近距離|原座標位移|','|---|---|---:|---:|---:|']
 for n in nodes:
  if n['nodeId'] not in (HIGH,BASE):continue
  r=n['roleReview'];p=n['coordinate'];lines.append(f"|{n['name']}|{p[1]:.7f}, {p[0]:.7f}|{n['reviewedElevationMeters']}m|{r['nearestHappymanMeters']}m|{r['previousDisplacementMeters'] if r['previousCoordinate'] else '原未定位'}|")
 high=next(n for n in nodes if n['nodeId']==HIGH);base=next(n for n in nodes if n['nodeId']==BASE)
 lines += ['',f"兩點直線相距 {distance(high['coordinate'],base['coordinate']):.1f}m。最高峰在西北、基點峰在東南。保留各自 Node ID。最高峰採 OSM 實際峰頂點，基點峰採 Happyman 明確標名群的實際代表點；不是平均座標。高度採官方敘述，沒有將 GPX 瞬時高度直接當作標稱海拔。",'', '## 本次新增點位','','|圖組|節點|WGS84 緯度,經度|採用來源原名|來源群最大差距 m|','|---|---|---|---|---:|']
 for n in nodes:
  if not n['coordinate'] or old[n['nodeId']]['coordinate']:continue
  p=n['coordinate'];src=refs[n['selectedSource']];name=src.get('rawName',src['name']).replace('|','／');lines.append(f"|{'、'.join(n['groups'])}|{n['name']}|{p[1]:.7f}, {p[0]:.7f}|{src['source']}：{name}|{n['spreadMeters']}|")
 lines+=['','## 複核方法與保留項目','', '以官方 Mapsforge 0.25.0 reader 讀取使用者提供的二進位圖層，篩出與缺失節點名稱相關的 GPX 航點。只清除航點序號、時間及高度附記，不將山屋、營地、最高峰、基點峰合併。既有已選定點位作為相鄰路線比對依據；跨圖共用 Node ID 保持原樣。','', '具名山峰候選群直徑上限 150m，其他具名點 80m；泛稱營地／岔路／最低鞍部仍需至少兩個相鄰定位點；無步行鄰點且只有單一來源的接駁地點保留待查。用既有步行時間排除明顯不合理的遠點，不反推或插值座標。不同群仍有衝突時保留缺失。新增點是規劃標示座標，尚非全路線步道線形或 DEM 成果。','', 'Happyman 來源可能與既有 GPX 共用上游資料；來源數不等同獨立實測數。圖層日期為 2024-08-13，未據此推定設施現況。原始 .map 與全圖 POI 資料庫不納入專案，僅保留必要的匹配來源與原標名。','',f"MD5：`{data['sourceCatalog'][-1]['md5']}`（與附件校驗檔一致）。",f"SHA256：`{data['sourceCatalog'][-1]['sha256']}`。",'', '[所有剩餘缺失及來源明細](ALL_ROUTE_COORDINATE_RESOLUTION_20261102.md)。','', '## 重現','', 'Java 17 以上，classpath 包含 Maven Central 的 org.mapsforge:mapsforge-core、mapsforge-map、mapsforge-map-reader 0.25.0。','', '```sh', "java -Xmx2g --class-path '/path/to/jars/*' tools/ExtractHappyman.java Happyman.map all-pois.ndjson 22.0 120.0 25.4 122.1",'git show 9077ba5:data/geometry/all-route-coordinates-v1.json > baseline.json','python tools/import_happyman_points.py Happyman.map all-pois.ndjson matched-points.json --baseline baseline.json','python tools/recheck_happyman_coordinates.py baseline.json matched-points.json','```','', '匯入階段請使用該基準版本的缺失清單；提交的來源子集可直接用於重跑 recheck，無須散布全圖。']
 path.write_text('\n'.join(lines)+'\n')

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('baseline',type=Path);p.add_argument('happyman',type=Path);a=p.parse_args()
 baseline=json.loads(a.baseline.read_text());happyman=json.loads(a.happyman.read_text());data,subset=recheck(baseline,happyman)
 (ROOT/'data/geometry/all-route-coordinates-v1.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
 (ROOT/'data/geometry/sources/happyman-coordinate-reference-20240813.json').write_text(json.dumps(subset,ensure_ascii=False,separators=(',',':'))+'\n')
 write_report(data,ROOT/'docs/ALL_ROUTE_COORDINATE_RESOLUTION_20261102.md');report(data,baseline,ROOT/'docs/HAPPYMAN_COORDINATE_RECHECK_20261102.md');print(data['counts'],data['recheck'])
