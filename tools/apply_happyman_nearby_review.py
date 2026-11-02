"""Apply explicit per-node nearby-name review; search scores never select points.
Usage: BASELINE DISCOVERY REVIEW_CHOICES; preserve accepted records and route data.
"""
import argparse,collections,copy,json
from pathlib import Path
from resolve_coordinate_sources import ROOT,distance,write_report

def graph():
 adj=collections.defaultdict(dict)
 for route in json.loads((ROOT/'data/unified-editor-manifest.json').read_text())['routes']:
  for leg in json.loads((ROOT/route['file'].split('?')[0]).read_text())['segments']:
   if leg.get('travelMode')!='walking' or leg.get('routingEnabled') is False:continue
   a,b=leg['fromId'],leg['toId'];minutes=float(leg['minutes'])
   adj[a][b]=max(adj[a].get(b,0),minutes);adj[b][a]=max(adj[b].get(a,0),minutes)
 return adj

def valid_anchor_path(nid,a,adj):
 branch=a['branch']
 if branch not in adj.get(nid,{}):return False
 queue=[(branch,1,adj[nid][branch],{nid,branch})]
 while queue:
  current,hops,minutes,seen=queue.pop()
  if current==a['nodeId'] and hops==a['hops'] and abs(minutes-a['minutes'])<1e-6:return True
  if hops>=min(4,a['hops']):continue
  for other,m in adj.get(current,{}).items():
   if other not in seen:queue.append((other,hops+1,minutes+m,seen|{other}))
 return False

def apply_review(baseline,discovery,choices,graph_override=None):
 adj=graph() if graph_override is None else graph_override
 result=copy.deepcopy(baseline);nodes={n['nodeId']:n for n in result['nodes']};candidates={n['nodeId']:n for n in discovery['nodes']};points={p['id']:p for p in discovery['points']};seen=set();selected=[]
 sha=next(s['sha256'] for s in result['sourceCatalog'] if s['id']=='happyman')
 for choice in choices:
  nid=choice['nodeId'];n=nodes[nid]
  if nid in seen or n['coordinate'] is not None:raise ValueError('Duplicate review or attempt to relocate accepted node: '+nid)
  seen.add(nid)
  if n['name']!=choice['expectedName']:raise ValueError('Node name changed')
  p=points[choice['sourceId']];search=candidates[nid]
  if search['groups']!=n['groups']:raise ValueError('Node groups changed')
  if p['rawName']!=choice['expectedRawName'] or p['sourceFileSha256']!=sha:raise ValueError('Source identity changed')
  if not any(c['sourceId']==p['id'] and c['coordinate']==p['coordinate'] for c in search['candidates']):raise ValueError('Chosen point absent from discovery audit')
  if not search['anchors'] or not choice['rationale'].strip():raise ValueError('Review needs a route anchor and rationale')
  context=[]
  for a in search['anchors']:
   if not valid_anchor_path(nid,a,adj):raise ValueError('Anchor path is not in reviewed walking graph')
   if nodes[a['nodeId']]['coordinate']!=a['coordinate']:raise ValueError('Anchor not yet accepted / changed')
   d=distance(p['coordinate'],a['coordinate'])
   if d>600+85*a['minutes']:raise ValueError('Outside walking-time rejection bound')
   context.append({**a,'distanceMeters':round(d,1)})
  n.clear();n.update(nodeId=nid,name=choice['expectedName'],groups=search['groups'],coordinate=p['coordinate'],status='selected-planning-coordinate',selectedSource=p['id'],sourceRefs=[p['id']],sourceCount=1,spreadMeters=0,selectionMethod='happyman-similar-name-with-reviewed-route-context',confidence='probable-planning-location',nameReview={'sourceRawName':p['rawName'],'rationale':choice['rationale'],'auditFile':'data/audits/happyman-nearby-review-20261102.json'},routeContext=context)
  selected.append(p)
 objects={p['id']:p for p in baseline['references']}
 for p in selected:objects.setdefault(p['id'],p)
 result['references']=[objects[k] for k in sorted(objects)]
 result['counts']=dict(collections.Counter(n['status'] for n in result['nodes']))
 result['nearbyRecheck']={'baselineCommit':'543a8aaf73679e6ddbe41eee29c51db0de89b459','beforeSelected':baseline['counts']['selected-planning-coordinate'],'beforeUnresolved':baseline['counts']['unresolved'],'addedCount':len(choices),'afterSelected':result['counts']['selected-planning-coordinate'],'afterUnresolved':result['counts'].get('unresolved',0),'policy':'Explicit per-node review of source labels and route neighbors. No automatic fuzzy-name identity merge, midpoint, new routing edge or relocation of accepted nodes.'}
 audit={k:v for k,v in discovery.items() if k!='points'};audit['reviews']=choices;audit['counts']=result['nearbyRecheck']
 return result,audit,{'schemaVersion':1,'sourceId':'happyman','sourceFileSha256':sha,'points':selected}

def report(data,audit,path):
 nodes={n['nodeId']:n for n in data['nodes']};m=data['nearbyRecheck'];safe=lambda s:str(s).replace('|','／').replace('\n',' ')
 lines=['# Happyman 鄰近路線與相似名稱複核','',f"基準版本 {m['baselineCommit'][:7]}：原已定位 {m['beforeSelected']}、待查 {m['beforeUnresolved']}；本次新增 **{m['addedCount']} 點**，現已定位 **{m['afterSelected']}／729**，剩餘 **{m['afterUnresolved']} 點**。",'', '先用路線連通的已定位鄰點找出搜尋範圍，再比對原始航點標名、同義詞、字形差異、數字峰標高、岔路與地物類型。搜尋分數只用來列候選；每一筆採用均在 review manifest 指定 Node ID、來源 ID、原始標名與採用理由。','', '直接鄰點尚未定位時，沿每一支路最多走四段，取第一個已定位節點；不將這些節點之間畫成新路線。步行時間僅以 600m＋85m／分鐘作排除遠點的寬鬆上限，不用來推算座標，也不是行走時間或安全性的保證。部分節點只有單側具名路線可對照，於下表明列。','', '採用座標均為原始 Happyman 記錄點，沒有平均或插值；保持原有節點名稱、Node ID、方向時間、路線與已定位座標。這是規劃標示點位的合理定位，不標記為官方實測核實，亦尚未當作全路線步道錨點。','', '兩輪搜尋：第一輪採用82點，第二輪利用新增鄰點再採用18點。第一輪審核證據使用原461點，第二輪使用第一輪完成後的點位；套用時逐段核對路徑確實存在於步行圖，拒絕未定位鄰點或無法重現的路線依據。','', '## 本次採用','','|圖組／Node ID|行程節點|Happyman 原標名|緯度,經度 WGS84|路線對照|採用理由|','|---|---|---|---|---|---|']
 for c in audit['reviews']:
  n=nodes[c['nodeId']];p=n['coordinate'];ctx='；'.join(f"{a['name']}（{a['distanceMeters']:.0f}m，{a['hops']}段）" for a in n['routeContext'])
  lines.append('|'+ '|'.join(map(safe,['、'.join(n['groups'])+'／'+n['nodeId'],n['name'],c['expectedRawName'],f'{p[1]:.7f}, {p[0]:.7f}',ctx,c['rationale']]))+'|')
 lines+=['','## 仍待查','','|圖組|節點|附近相似標記（候選，未採用）|保留原因|','|---|---|---|---|']
 for n in audit['nodes']:
  if nodes[n['nodeId']]['coordinate']:continue
  cs=n['candidates'];description='；'.join(c['rawName'] for c in cs[:3]) or '未找到相容候選'
  why='無已定位的步行鄰點，難以限定位置' if not n['anchors'] else '缺少具名航點或地物類型不符' if not cs else '多個合理候選、里程／方向不同，或無法確認地物位置'
  lines.append('|'+ '|'.join(map(safe,['、'.join(n['groups']),n['name'],description,why]))+'|')
 lines+=['','## 已排除的常見誤判','', '- 屏風新路登與大禹嶺舊屏風登山口分開；石山秀湖採湖畔標記，不採湖名指示牌。','- 山屋不拿同名山峰替代；審馬登山口不拿審馬陣山峰頂替代。','- 里程數不同不直接當作誤差。例如28.5K／26.5K、27.5K／25.5K仍待查。','- 一般水源、營地、岔路若有多處相似記錄，保留待查；松針營地等不同群不強行挑一點。','- 數字峰／鞍部的少量標高差，僅在具名路段及相鄰節點吻合時採為規劃點，差異逐筆保留。','', '## 來源與重現','', 'Happyman.map（2024-08-13，原圖 SHA256 `2fd98c7a9de74afafe628c08f5a59ba3a027b995f05a3fa2394a0d59cd425de5`）。航點標名及 GPS 高度並非獨立實測或設施現況的保證；原始圖與全圖 POI dump 不放入專案。','', '重現套用：先以 `git show 543a8aa:data/geometry/all-route-coordinates-v1.json` 取出基準 JSON，再讀入候選審核 JSON，將其 `points` 設為本次採用航點檔的 `points`，並以審核 JSON 的 `reviews` 呼叫 `apply_review`。這些已提交檔案即可完整重現本次結果，無須全圖資料庫。','', '`tools/find_happyman_nearby.py` 需 numpy/scipy，只負責離線列候選。`tools/apply_happyman_nearby_review.py` 只用標準庫套用明確審核清單，檢查來源標名、座標、雜湊及路線鄰點；不得以相似度分數直接定位。','', '[本次候選與採用依據 JSON](../data/audits/happyman-nearby-review-20261102.json)；[本次採用航點](../data/geometry/sources/happyman-nearby-selected-20240813.json)；[全部已定位及剩餘缺失清單](ALL_ROUTE_COORDINATE_RESOLUTION_20261102.md)。']
 path.write_text('\n'.join(lines)+'\n')

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('baseline',type=Path);p.add_argument('discovery',type=Path);p.add_argument('choices',type=Path);a=p.parse_args();data,audit,source=apply_review(json.loads(a.baseline.read_text()),json.loads(a.discovery.read_text()),json.loads(a.choices.read_text()))
 (ROOT/'data/geometry/all-route-coordinates-v1.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
 (ROOT/'data/audits/happyman-nearby-review-20261102.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
 (ROOT/'data/geometry/sources/happyman-nearby-selected-20240813.json').write_text(json.dumps(source,ensure_ascii=False,indent=2)+'\n')
 write_report(data,ROOT/'docs/ALL_ROUTE_COORDINATE_RESOLUTION_20261102.md');report(data,audit,ROOT/'docs/HAPPYMAN_NEARBY_RECHECK_20261102.md');print(data['nearbyRecheck'])
