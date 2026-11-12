"""Read-only whole-catalog spatial screening; heuristic flags are not verification."""
import argparse
import collections
import itertools
import json
import math
from pathlib import Path
from node_coordinate_review import ROOT, build, digest

RULES = [
    ['格式／範圍', '有限數值、經緯度順序；台灣規劃範圍 119–123E / 21–26N', '優先確認', '區域範圍是本專案篩檢界線，不是行政邊界'],
    ['缺座標', 'active 節點沒有座標', '待補座標', 'ignored／vehicle-only 無座標為既有顯示政策'],
    ['來源不一致', '目前 coordinateSource.id 的同 ID 參考點距離 >100m，且沒有後續覆寫／角色修正', '優先確認', '只比較明確來源 ID，不以同名配對'],
    ['歷史來源差距', '與既有關聯候選距離 >1000m', '參考提醒', '歷史候選可能已排除；有人工覆寫不表示現值錯誤'],
    ['相鄰長距離', '唯一可尋路步行相鄰直線距離 >10km', '建議複核', '可能是來源長路段；不以車行或手動連接計算'],
    ['距離／時間', '直線距離 >1km 且來源方向分鐘隱含速度 >6km/h', '建議複核', '只是下限速度提示；不修改任何方向時間'],
    ['二跳折返', '步行度數=2，兩鄰點皆距本點>300m，夾角<20°且兩腿和／鄰點距離>4', '建議複核', '可能是合理折返／支線；僅提示，不要求節點沿直線排序'],
    ['多條件位置離群', '上述折返條件且兩側相鄰距離均>15km', '優先確認', '多條件同時命中；仍須查來源，不能推定應移動哪一點'],
    ['相同座標', '不同 Node ID 相距 <1m', '參考提醒', '可能是不同標示角色，禁止自動合併'],
    ['OSM 錨點', '既有 routingAnchor.offsetMeters >300m', '建議複核', '不重新抓 OSM；錨點政策／原圖標示位置可能不同'],
    ['高程', '定位點無有限 DEM 高程或高程不在 -100～4100m', '建議複核', 'DEM 估計值，不是實測高程'],
    ['線形端點', '線形與明確 fromAnchor/toAnchor 或節點位置差 >5m；>100m列複核', '參考提醒／建議複核', '小偏移可能來自既有錨點／投影；不是來源核實'],
    ['相鄰覆蓋', '已定位節點沒有可定位的步行相鄰點', '參考提醒', '檢查受限，不表示錯誤或資料完整'],
]
ORDER = {'優先確認': 0, '建議複核': 1, '待補座標': 2, '參考提醒': 3,
         '未發現規則異常': 4, '依政策不定位': 5}
METHOD_LABELS = {
    'unique-osm-junction-of-three-reviewed-branches': '依三條已審分支的 OSM 唯一交會點選用',
    'named-source-with-route-context': '依具名來源與路線相鄰情境選用',
    'source-agreement-and-neighbor-context': '依來源相近及相鄰情境選用（未重新核實）',
    'nearby-source-cluster': '依附近來源群聚選用',
    'happyman-similar-name-with-reviewed-route-context': '依 Happyman 近似名稱與已審路線情境選用',
    'owner-workbook-coordinate': '使用者 Excel 覆核座標',
    'owner-sheet-coordinate': '使用者 Google Sheet 覆核座標',
    'owner-chat-coordinate': '使用者對話指定座標',
    'named-feature-supported-by-osm-walking-topology': '依具名地物與 OSM 步行連通情境選用',
    'physical-landform-source-priority': '依地形角色選用來源',
    'OSM point': 'OSM 地物點',
    'pending-owner-coordinate': '待使用者補充座標',
    'mean of OSM footprint vertices (label point only)': 'OSM 建物範圍頂點平均（僅標示點）',
    'happyman-explicit-peak-role-review': 'Happyman 山峰角色覆核紀錄',
    'source-role-correction-v08': 'v0.8 來源角色修正',
    'source-role-correction-20261104': '2026-11-04 來源角色修正',
}


def method_label(method):
    if (method or '').startswith('User TWD97'):
        return '使用者指定 TWD97 座標（原值與日期見來源）'
    return METHOD_LABELS.get(method, '既有選用方法（技術原文見來源紀錄）' if method else '未記錄選用方法')


def valid(c):
    return isinstance(c, (list, tuple)) and len(c) == 2 and all(
        isinstance(v, (int, float)) and math.isfinite(v) for v in c)


def distance(a, b):
    lon1, lat1, lon2, lat2 = map(math.radians, [*a, *b])
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 6371008.8*2*math.asin(min(1, math.sqrt(h)))


def bearing(a, b):
    lo1, la1, lo2, la2 = map(math.radians, [*a, *b])
    return (math.degrees(math.atan2(math.sin(lo2-lo1)*math.cos(la2),
            math.cos(la1)*math.sin(la2)-math.sin(la1)*math.cos(la2)*math.cos(lo2-lo1)))+360)%360


def audit(bridge, terrain, selected):
    nodes = {n['nodeId']: n for n in terrain['nodes']}
    catalog = {r[0]: r for r in bridge['tables']['節點總表'][1:]}
    refs = {r['id']: r for r in selected['references']}
    choices = {n['nodeId']: n for n in selected['nodes']}
    sources = collections.defaultdict(list)
    for row in bridge['tables']['來源明細'][1:]:
        sources[row[1]].append((row[2], json.loads(row[4])))
    adj, outgoing = collections.defaultdict(set), collections.defaultdict(list)
    for row in bridge['tables']['相鄰關係'][1:]:
        edge = json.loads(row[8])
        if row[7] != 'segments/walking' or not edge.get('routingEnabled', True):
            continue
        a, b = row[2], row[4]
        adj[a].add(b)
        adj[b].add(a)
        if (b, row[6]) not in outgoing[a]:
            outgoing[a].append((b, row[6]))
    flags = collections.defaultdict(list)
    def flag(nid, code, level, evidence, related=None):
        item = {'code': code, 'level': level, 'evidence': evidence, 'relatedNodeIds': related or []}
        if item not in flags[nid]:
            flags[nid].append(item)
    located = {nid: n['coordinate'] for nid, n in nodes.items() if valid(n.get('coordinate'))}
    for a, b in itertools.combinations(located, 2):
        if distance(located[a], located[b]) < 1:
            for x, y in [(a, b), (b, a)]:
                flag(x, '相同座標', '參考提醒', f'與 {nodes[y]["name"]} 相距不足1m；可能不同角色，勿合併', [y])
    for anchor in terrain.get('routingAnchors', []):
        if anchor.get('offsetMeters', 0) > 300:
            flag(anchor['nodeId'], 'OSM錨點偏移', '建議複核',
                 f'既有OSM錨點距標示點 {anchor["offsetMeters"]:.0f}m，way {anchor.get("wayId")}')
    for span in terrain.get('spans', []):
        coords = span.get('coordinates', [])
        if not coords:
            continue
        for side, index in [('from', 0), ('to', -1)]:
            nid = span[side+'Id']
            anchor = span.get(side+'Anchor') or located.get(nid)
            if valid(anchor) and distance(anchor, coords[index]) > 5:
                offset = distance(anchor, coords[index])
                flag(nid, '線形端點偏移', '建議複核' if offset > 100 else '參考提醒',
                     f'{span["id"]} 的{side}端距標示／明確錨點 {offset:.1f}m；可能是既有投影差')
    results = []
    for nid, n in nodes.items():
        c = n.get('coordinate')
        policy = n.get('coordinatePolicy', 'active')
        if c is not None and (not valid(c) or not (119 < c[0] < 123 and 21 < c[1] < 26)):
            flag(nid, '座標格式或範圍', '優先確認', '座標非有限數值、順序錯誤或超出本專案台灣篩檢範圍')
        if policy != 'active':
            if c is not None:
                flag(nid, '顯示政策不一致', '優先確認', f'{policy} 節點仍有執行期座標')
        elif c is None:
            flag(nid, '缺座標', '待補座標', '步行標示點未定位；不能進行位置、方位與高程判斷')
        neighbour_text, two_hop = [], set()
        for other in adj[nid]:
            two_hop.update(adj[other])
            if nid in located and other in located:
                d = distance(located[nid], located[other])
                neighbour_text.append(f'{nodes[other]["name"]} {d/1000:.2f}km／{bearing(located[nid],located[other]):.0f}°')
                if d > 10000:
                    flag(nid, '相鄰長距離', '建議複核', f'至 {nodes[other]["name"]} 直線 {d/1000:.2f}km', [other])
        two_hop.discard(nid)
        for other, minutes in outgoing[nid]:
            if nid in located and other in located and isinstance(minutes, (int, float)) and minutes > 0:
                d = distance(located[nid], located[other])
                if d > 1000 and d/1000/(minutes/60) > 6:
                    flag(nid, '距離時間提示', '建議複核',
                         f'至 {nodes[other]["name"]}：直線 {d/1000:.2f}km／來源 {minutes}分鐘，下限速度 {d/1000/(minutes/60):.1f}km/h', [other])
        if nid in located:
            if not neighbour_text:
                flag(nid, '相鄰定位不足', '參考提醒', '沒有可定位的步行相鄰點；位置關係檢查受限')
            elevation = n.get('elevationMeters')
            if not isinstance(elevation, (int, float)) or not math.isfinite(elevation) or not -100 <= elevation <= 4100:
                flag(nid, '高程缺漏或範圍', '建議複核', f'DEM 高程 {elevation}；需來源複核')
            if len(adj[nid]) == 2 and all(k in located for k in adj[nid]):
                a, b = sorted(adj[nid])
                da, db = distance(c, located[a]), distance(c, located[b])
                delta = abs(bearing(c, located[a])-bearing(c, located[b]))
                angle = min(delta, 360-delta)
                ratio = (da+db)/max(1, distance(located[a], located[b]))
                if min(da, db) > 300 and angle < 20 and ratio > 4:
                    flag(nid, '二跳折返提示', '建議複核',
                         f'{nodes[a]["name"]}→本點→{nodes[b]["name"]}：夾角 {angle:.1f}°、距離比 {ratio:.1f}；可能合理折返', [a, b])
                    if min(da, db) > 15000:
                        flag(nid, '多條件位置離群', '優先確認',
                             f'兩鄰點距本點 {da/1000:.2f}/{db/1000:.2f}km 且同方向（{angle:.1f}°）；優先核對本點與鄰點來源，勿直接移點', [a, b])
            overridden = any((role == '人工覆寫決策' and data.get('action') == 'coordinate')
                             or role == '歷史角色修正／撤銷' for role, data in sources[nid])
            source_id = n.get('coordinateSource', {}).get('id')
            ref = refs.get(source_id, {})
            if valid(ref.get('coordinate')) and not overridden and distance(c, ref['coordinate']) > 100:
                flag(nid, '目前來源不一致', '優先確認',
                     f'同來源ID {source_id} 與現值相距 {distance(c,ref["coordinate"]):.0f}m')
            s = choices.get(nid, {})
            candidates = sorted(set(s.get('candidateRefs', [])+s.get('sourceRefs', [])))
            far = [(rid, distance(c, refs[rid]['coordinate'])) for rid in candidates
                   if rid in refs and valid(refs[rid].get('coordinate'))
                   and distance(c, refs[rid]['coordinate']) > 1000]
            if far:
                rid, d = max(far, key=lambda r:r[1])
                flag(nid, '歷史候選差距', '參考提醒',
                     f'關聯歷史候選最大差 {d/1000:.2f}km（{rid}）；'+
                     ('已有人工覆寫／角色修正，不據此否定現值' if overridden else
                      f'既有選用方式：{method_label(s.get("selectionMethod"))}；需查原始理由'))
        findings = flags[nid]
        status = min((f['level'] for f in findings), key=ORDER.get) if findings else (
            '依政策不定位' if policy != 'active' else '未發現規則異常')
        node_row = catalog[nid]
        next_step = {'優先確認': '先查同ID來源／標示角色，確認後才提修正',
                     '建議複核': '對照相鄰點、原圖／行跡；可能合理繞行，不直接移點',
                     '待補座標': '補具來源座標；保留缺口，不猜位置',
                     '參考提醒': '查看歷史決策／標示角色；無需僅因提示改值',
                     '未發現規則異常': '可先保留；規則通過不代表來源已核實',
                     '依政策不定位': '保留既有忽略／車行政策；有新需求再討論'}[status]
        results.append({'nodeId': nid, 'name': n['name'], 'groups': node_row[1],
                        'status': status, 'findings': findings, 'nextStep': next_step,
                        'coordinate': c, 'twd97': node_row[6:8], 'policy': policy,
                        'neighbours': '；'.join(sorted(neighbour_text)) or '無可比較定位鄰點',
                        'twoHopCount': len(two_hop), 'locatedTwoHopCount': sum(k in located for k in two_hop),
                        'sourceSummary': {'owner-review':'使用者覆核', 'osm':'OpenStreetMap', 'twmap':'TWMap興趣點',
                                          'happyman':'Happyman航點', 'community-gpx':'山友歷史GPX'}.get(
                                              n.get('coordinateSource', {}).get('source'), '既有來源')+'；'+method_label(n.get('coordinateMethod')),
                        'reviewId': 'R-'+__import__('hashlib').sha256(nid.encode()).hexdigest()[:20]})
    return {'schemaVersion': 1, 'ruleVersion': 'spatial-screen-v1', 'baseCommit': bridge['baseCommit'],
            'inputDigest': digest(bridge['inputs']), 'rules': RULES,
            'counts': dict(collections.Counter(r['status'] for r in results)),
            'flagCounts': dict(collections.Counter(f['code'] for r in results for f in r['findings'])),
            'nodes': results}


def presentation(report, bridge):
    rows = [['優先順序', '群組', '節點名', '目前 TWD97 X', '目前 TWD97 Y', '檢查發現（供討論）',
             '建議下一步', '檢查證據', '相鄰距離／方位（正北0°）', '目前來源摘要',
             '定位狀態', '二跳可定位／全部', '填寫決策', '查看地圖', '審查 ID', 'Node ID']]
    decisions = {r[1]: i+2 for i, r in enumerate(bridge['tables']['審查與決策'][1:])}
    details = [['疑點 ID', '優先順序', '群組', '節點名', '檢查項目', '具體證據', '建議下一步', 'Node ID', '關聯 Node ID']]
    for n in sorted(report['nodes'], key=lambda n:(ORDER[n['status']], n['groups'], n['name'], n['nodeId'])):
        findings = n['findings']
        rows.append([n['status'], n['groups'], n['name'], *n['twd97'],
                     '；'.join(dict.fromkeys(f['code'] for f in findings)) or n['status'],
                     n['nextStep'], '\n'.join(f['evidence'] for f in findings) or '本次已執行適用規則；不是外部來源核實',
                     n['neighbours'], n['sourceSummary'],
                     {'active':'步行點','ignored':'指定忽略','vehicle-only':'車行專用'}.get(n['policy'],n['policy']),
                     f'{n["locatedTwoHopCount"]}/{n["twoHopCount"]}',
                     f'#gid=105&range=H{decisions[n["nodeId"]]}:M{decisions[n["nodeId"]]}',
                     f'https://www.openstreetmap.org/?mlat={n["coordinate"][1]}&mlon={n["coordinate"][0]}#map=15/{n["coordinate"][1]}/{n["coordinate"][0]}' if valid(n['coordinate']) else '',
                     n['reviewId'], n['nodeId']])
        for f in findings:
            details.append(['F-'+digest([n['nodeId'], f])[:16], f['level'], n['groups'], n['name'],
                            f['code'], f['evidence'], n['nextStep'], n['nodeId'], '；'.join(f['relatedNodeIds'])])
    return {'檢閱總覽': rows, '疑點明細': details,
            '檢查規則': [['項目', '篩檢規則', '分類', '解讀限制']]+report['rules']}


def readable_sources(bridge):
    """Human-readable append-only source columns; raw evidence stays intact."""
    catalog = {r[0]: r for r in bridge['tables']['節點總表'][1:]}
    from node_coordinate_review import twd97
    rows = [['節點名', '群組', '來源經度', '來源緯度', '來源 TWD97 X', '來源 TWD97 Y',
             '來源原名／選用說明', '來源角色（未重新核實）', '來源連結']]
    for row in bridge['tables']['來源明細'][1:]:
        d = json.loads(row[4])
        c = d.get('coordinate') or d.get('previousRuntimeNode',{}).get('coordinate')
        c = c if valid(c) else None
        nested = d.get('source') if isinstance(d.get('source'), dict) else {}
        link = d.get('url') or d.get('sourceUrl') or nested.get('url')
        link = link or d.get('workbookSourceUrl') or ''
        role = ('合併前舊ID座標／來源，非現值' if row[2].startswith('使用者明確合併') else
                '目前採用紀錄' if row[2] == '目前執行期座標' else
                '歷史修正／撤銷，保留差異' if row[2] == '歷史角色修正／撤銷' else
                '人工決策紀錄' if row[2] == '人工覆寫決策' else '歷史關聯候選／選用，請對照現值')
        rows.append([catalog[row[1]][2], catalog[row[1]][1], *(c or ['', '']), *twd97(c),
                     d.get('name') or d.get('rawName') or d.get('oldNode',{}).get('name') or method_label(d.get('method')), role, link])
    return rows


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--runtime', help='Runtime path relative to repository; otherwise use bridge configuration')
    a = p.parse_args()
    bridge = build(runtime_path=a.runtime)
    report = audit(bridge, json.loads((ROOT/bridge['runtimePath']).read_text(encoding='utf-8')),
                   json.loads((ROOT/'data/geometry/all-route-coordinates-v1.json').read_text(encoding='utf-8')))
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output/'spatial-audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    (a.output/'audit-tables.json').write_text(json.dumps(presentation(report, bridge), ensure_ascii=False), encoding='utf-8')
    (a.output/'bridge.json').write_text(json.dumps(bridge, ensure_ascii=False), encoding='utf-8')
    (a.output/'readable-sources.json').write_text(json.dumps(readable_sources(bridge), ensure_ascii=False), encoding='utf-8')
    print(json.dumps({'counts':report['counts'], 'flagCounts':report['flagCounts']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
