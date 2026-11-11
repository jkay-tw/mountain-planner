"""Export an ID-based review bridge. Never writes runtime data or applies decisions."""
import argparse
import csv
import hashlib
import json
import math
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HUMAN_HEADERS = ['審查 ID', 'Node ID', '群組', '節點名', '基底指紋', '我的檢查', '證據摘要',
                 '你的問題／指示', '決策', '採用 TWD97 X', '採用 TWD97 Y', '補充來源',
                 '人工備註', '處理狀態', 'Codex 回覆', 'commit／PR']


def working_runtime(root=ROOT):
    config = root/'data/audits/node-coordinate-review-bridge.json'
    if config.exists():
        return json.loads(config.read_text(encoding='utf-8')).get('workingRuntimePath', 'data/geometry/planner-terrain-v1.json')
    return 'data/geometry/planner-terrain-v1.json'


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(',', ':')).encode()).hexdigest()


def twd97(coordinate):
    """WGS84 lon/lat to GRS80 TM2 zone 121 (EPSG:3826), rounded metres."""
    if not coordinate:
        return ['', '']
    lon, lat = map(math.radians, coordinate)
    a, b, k = 6378137., 6356752.314140356, .9999
    e = 1 - b*b/(a*a)
    ep = e/(1-e)
    n = a/math.sqrt(1-e*math.sin(lat)**2)
    t, c = math.tan(lat)**2, ep*math.cos(lat)**2
    q = math.cos(lat)*(lon-math.radians(121))
    m = a*((1-e/4-3*e**2/64-5*e**3/256)*lat
           -(3*e/8+3*e**2/32+45*e**3/1024)*math.sin(2*lat)
           +(15*e**2/256+45*e**3/1024)*math.sin(4*lat)
           -35*e**3/3072*math.sin(6*lat))
    return [round(250000+k*n*(q+(1-t+c)*q**3/6+(5-18*t+t*t+72*c-58*ep)*q**5/120)),
            round(k*(m+n*math.tan(lat)*(q*q/2+(5-t+9*c+4*c*c)*q**4/24
                         +(61-58*t+t*t+600*c-330*ep)*q**6/720)))]


def merge_decisions(fresh, previous):
    """Preserve entire previous rows, including deleted IDs and user fields.

    Refresh only generated A:G. Changed baselines retain the old row and become
    conflicts, so a previous decision can never silently target new input.
    """
    old = {}
    for row in previous:
        row = list(row) + [''] * (len(HUMAN_HEADERS)-len(row))
        if not row[0] or row[0] in old:
            raise ValueError('Missing or duplicate review ID')
        old[row[0]] = row
    result = []
    for row in fresh:
        prior = old.pop(row[0], None)
        if prior:
            if prior[1] != row[1]:
                raise ValueError('Review ID changed Node ID')
            if prior[4] != row[4]:
                prior[13] = '同步衝突：基底已變；保留原決策，請重新確認'
                prior[14] = '目前指紋：' + row[4]
                row = prior
            else:
                row = row[:7] + prior[7:]
        result.append(row)
    for row in old.values():
        row[13] = '不在現行清冊：保留歷史，禁止自動套用'
        result.append(row)
    return result


def decision_requests(fresh, live, sheet_id):
    """Patch generated A:G/N:P at live row positions; never write human H:M.

    Read live rows immediately before execution. Sorting/inserting rows requires
    a fresh snapshot and plan. This function only generates requests.
    """
    merged = merge_decisions(fresh, live)
    positions = {row[0]: i+1 for i, row in enumerate(live)}
    next_row = len(live)+1
    requests = []
    for row in merged:
        position = positions.get(row[0])
        if position is None:
            position, next_row = next_row, next_row+1
        for start, end in [(0, 7), (13, 16)]:
            values = [{'userEnteredValue': {'stringValue': '' if v is None else str(v)}}
                      for v in row[start:end]]
            requests.append({'updateCells': {'start': {'sheetId': sheet_id, 'rowIndex': position,
                                                       'columnIndex': start},
                                             'rows': [{'values': values}], 'fields': 'userEnteredValue'}})
    return requests


def build(root=ROOT, previous=None, spatial_audit=None, runtime_path=None):
    inputs = {}
    def read(path):
        raw = (root/path).read_bytes()
        inputs[path] = hashlib.sha256(raw.replace(b'\r\n', b'\n')).hexdigest()
        return json.loads(raw)
    manifest = read('data/unified-editor-manifest.json')
    runtime_path = runtime_path or working_runtime(root)
    terrain = read(runtime_path)
    selected = read('data/geometry/all-route-coordinates-v1.json')
    owner = read('data/geometry/sources/owner-coordinate-overrides.json')
    retired = read('data/geometry/sources/owner-topology-retirements-20261104.json')
    application_path = 'data/geometry/sources/node-review-application-20261111.json'
    application = read(application_path) if (root/application_path).exists() else {'merges': []}
    nov12_path = 'data/geometry/sources/sheet-review-application-20261112.json'
    nov12 = read(nov12_path) if (root/nov12_path).exists() else None
    catalog, edges = {}, []
    for entry in manifest['routes']:
        path = entry['file'].split('?')[0]
        route = read(path)
        for node in route['nodes']:
            item = catalog.setdefault(node['id'], {'names': set(), 'aliases': set(), 'groups': set()})
            item['names'].add(node['name'])
            item['aliases'].update(node.get('aliases', []))
            item['groups'].add(entry['name'])
        for kind in ('segments', 'manualConnections'):
            for edge in route.get(kind, []):
                edges.append((entry['name'], kind, edge, path))
    runtime = {n['nodeId']: n for n in terrain['nodes']}
    if set(catalog) != set(runtime):
        raise ValueError('Runtime/catalog Node ID mismatch')
    references = {r['id']: r for r in selected['references']}
    choices = {r['nodeId']: r for r in selected['nodes']}
    reviews = {r['nodeId']: r for r in owner['nodes']}
    corrections = []
    for path, key in [('data/geometry/sources/coordinate-corrections-v08.json', 'corrections'),
                      ('data/geometry/sources/owner-update-source-corrections.json', 'nodes')]:
        corrections.extend((path, n) for n in read(path)[key])
    sources = [['來源 ID', 'Node ID', '角色', '來源／網址', '來源座標／資料 JSON', '專案檔案', '核實界線']]
    source_ids = {nid: [] for nid in catalog}
    def source(nid, role, data, path):
        sid = 'S-'+digest([nid, role, data, path])[:20]
        source_ids[nid].append(sid)
        sources.append([sid, nid, role, data.get('url', data.get('sourceUrl', '')),
                        json.dumps(data, ensure_ascii=False, separators=(',', ':')), path,
                        '既有來源紀錄；本次未重新核實；多筆不代表獨立來源'])
    adjacency = [['關係 ID', '群組', '起點 ID', '起點名', '終點 ID', '終點名', '方向分鐘',
                  '類型', '來源與條件時間 JSON', '專案檔案']]
    neighbours = {nid: set() for nid in catalog}
    for group, kind, edge, path in edges:
        a, b = edge['fromId'], edge['toId']
        if a not in catalog or b not in catalog:
            raise ValueError('Dangling adjacency')
        neighbours[a].add(b)
        neighbours[b].add(a)
        adjacency.append(['E-'+digest([group, kind, edge])[:20], group, a, edge.get('from', ''),
                          b, edge.get('to', ''), edge.get('minutes'),
                          kind+'/'+edge.get('travelMode', 'walking'),
                          json.dumps(edge, ensure_ascii=False, separators=(',', ':')), path])
    nodes = [['Node ID', '群組', '節點名', '別名／其他圖名稱', '經度', '緯度', 'TWD97 X', 'TWD97 Y',
              '座標系統／方法', 'DEM 高程', '座標狀態', '相鄰節點名稱', '相鄰 Node ID',
              '來源 ID', '來源追溯狀態', '基底指紋']]
    decisions = []
    for nid, item in catalog.items():
        n, s, o = runtime[nid], choices.get(nid, {}), reviews.get(nid)
        source(nid, '目前執行期座標', {'coordinate': n.get('coordinate'),
               'method': n.get('coordinateMethod'), **n.get('coordinateSource', {})},
               runtime_path)
        for rid in sorted(set(s.get('candidateRefs', []) + s.get('sourceRefs', [])
                              + ([s['selectedSource']] if s.get('selectedSource') else []))):
            source(nid, '歷史候選／選用紀錄：'+rid,
                   references.get(rid, {'id': rid, 'missingReference': True}),
                   'data/geometry/all-route-coordinates-v1.json')
        if o:
            source(nid, '人工覆寫決策', {**o, 'workbookSourceUrl': owner.get('sourceUrl'),
                   'workbookSha256': owner.get('sourceFileSha256')},
                   'data/geometry/sources/owner-coordinate-overrides.json')
        for path, correction in corrections:
            if correction['nodeId'] == nid:
                source(nid, '歷史角色修正／撤銷', correction, path)
        for merged in application['merges']:
            if merged['canonicalId'] == nid:
                source(nid, '使用者明確合併／舊ID與原座標',
                       {**merged,'sourceUrl':application['sourceUrl']}, application_path)
                old = choices.get(merged['oldId'], {})
                for rid in sorted(set(old.get('candidateRefs', [])+old.get('sourceRefs', [])+
                                      ([old['selectedSource']] if old.get('selectedSource') else []))):
                    source(nid, '合併前節點 '+merged['oldId']+' 的來源：'+rid,
                           {**references.get(rid, {'id':rid,'missingReference':True}),
                            'previousNodeId':merged['oldId']}, 'data/geometry/all-route-coordinates-v1.json')
        coordinate = n.get('coordinate')
        x, y = twd97(coordinate)
        adjacent = sorted(neighbours[nid])
        # Includes all incoming/outgoing source records; direction times remain exact.
        fingerprint = digest([n, sorted(item['names']), sorted(item['aliases']),
                              sorted(item['groups']), [r for r in adjacency[1:] if nid in (r[2], r[4])],
                              [r for r in sources[1:] if r[1] == nid]])
        name = n['name']
        gaps = [r[2] for r in sources[1:] if r[1] == nid and '"missingReference":true' in r[4]]
        trace = '缺少來源引用明細' if gaps else '已匯出既有紀錄；未新增來源核實'
        nodes.append([nid, '；'.join(sorted(item['groups'])), name,
                      '；'.join(sorted(item['aliases'] | (item['names']-{name}))),
                      *(coordinate or ['', '']), x, y, 'EPSG:3826／由現行經緯度換算（非獨立來源）',
                      n.get('elevationMeters'), {'active': '步行點', 'ignored': '指定忽略', 'vehicle-only': '車行專用'}.get(n.get('coordinatePolicy'), n.get('coordinatePolicy', '')),
                      '；'.join(runtime[k]['name'] for k in adjacent), '；'.join(adjacent),
                      '；'.join(source_ids[nid]), trace, fingerprint])
        decisions.append(['R-'+hashlib.sha256(nid.encode()).hexdigest()[:20], nid, nodes[-1][1],
                          name, fingerprint, '尚未執行空間合理性檢查', trace] + ['']*9)
    if spatial_audit is not None:
        if spatial_audit['inputDigest'] != digest(inputs):
            raise ValueError('Spatial audit input is stale; recompute before synchronization')
        audited = {n['nodeId']: n for n in spatial_audit['nodes']}
        if set(audited) != set(catalog) or len(spatial_audit['nodes']) != len(catalog):
            raise ValueError('Spatial audit Node ID coverage mismatch')
        for row in decisions:
            n = audited[row[1]]
            row[5] = n['status']+'｜'+('；'.join(dict.fromkeys(f['code'] for f in n['findings'])) or n['status'])
            row[6] = ('現值 TWD97 '+str(n['twd97'][0])+'/'+str(n['twd97'][1])+'\n'+
                      ('\n'.join(f['evidence'] for f in n['findings']) or n['nextStep'])+
                      '\n相鄰：'+n['neighbours'])
    decisions = merge_decisions(decisions, previous or [])
    retired_rows = [['Node ID', '節點名', '別名', '原路線檔', '退休紀錄 JSON']]
    for change in retired['changes']:
        for n in change['removedNodes']:
            retired_rows.append([n['id'], n['name'], '；'.join(n.get('aliases', [])), change['file'],
                                 json.dumps(n, ensure_ascii=False)])
    for merged in application['merges']:
        n = merged['oldNode']
        retired_rows.append([merged['oldId'], n['name'], '；'.join(n.get('aliases', [])),
                             '已合併至 '+merged['canonicalId'], json.dumps(merged, ensure_ascii=False)])
    if nov12:
        retired = nov12['retirement']; n = retired['node']
        retired_rows.append([n['id'], n['name'], '；'.join(n.get('aliases', [])),
                             '2026-11-12使用者指定退休；未重接', json.dumps(retired, ensure_ascii=False)])
    base = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    tables = {
        '使用說明': [['項目', '內容'], ['基底 commit', base], ['同步輸入摘要', digest(inputs)],
                 ['用途', '你與 Codex 的審查／決策橋樑；不直接寫入 main 或執行期資料'],
                 ['你可填寫', '審查與決策 H:M：問題、決策、TWD97 X/Y、補充來源、人工備註'],
                 ['決策選項', '待查／採用填入座標／保留現值／忽略座標／提出其他修改；空白表示無新指示'],
                 ['定位', '用審查 ID 或 Node ID 指定工作；勿以列號或同名判定身分'],
                 ['同步', '先讀取既有審查列，再匯出並按審查 ID 合併；基底衝突保留原決策'],
                 ['來源', '目前與歷史候選均列出；不是全部都已核實；重複來源不算獨立交叉驗證'],
                 ['相鄰', '來源方向邊逐筆保存，含車行與手動連接；總表相鄰為雙向摘要'],
                 ['限制', '本批未進行全節點空間合理性判斷；路線草案未自動分類'],
                 ['更新', '確認決策→功能分支→局部重算→必要測試→PR→明確授權合併／發布']],
        '節點總表': nodes, '來源明細': sources, '相鄰關係': adjacency,
        '審查與決策': [HUMAN_HEADERS]+decisions,
        '路線草案': [['路線 ID', '名稱', '關聯群組', '變體 ID', '順序', 'Node ID', '方向路段 ID', '人工備註']],
        '退休節點': retired_rows,
        '更新紀錄': [['事件', '基底 commit', '說明'], ['建立橋樑', base, '未套用座標或修改時間；尚未合併發布']]}
    return {'schemaVersion': 1, 'baseCommit': base, 'runtimePath': runtime_path, 'inputs': inputs, 'tables': tables,
            'counts': {k: len(v)-1 for k, v in tables.items()}}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--previous-decisions', type=Path, help='JSON array of existing data rows, no header')
    p.add_argument('--decision-sheet-id', type=int, help='Export safe A:G/N:P requests; requires live snapshot')
    p.add_argument('--spatial-audit', type=Path, help='Optional current audit JSON; rejects stale source inputs')
    p.add_argument('--runtime', help='Explicit runtime path relative to repository; default uses bridge configuration')
    a = p.parse_args()
    if a.decision_sheet_id is not None and not a.previous_decisions:
        p.error('--decision-sheet-id requires --previous-decisions from a fresh live read')
    previous = json.loads(a.previous_decisions.read_text(encoding='utf-8')) if a.previous_decisions else None
    audit = json.loads(a.spatial_audit.read_text(encoding='utf-8')) if a.spatial_audit else None
    result = build(previous=previous, spatial_audit=audit, runtime_path=a.runtime)
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output/'bridge.json').write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    if a.decision_sheet_id is not None:
        fresh = build(spatial_audit=audit, runtime_path=a.runtime)['tables']['審查與決策'][1:]
        requests = decision_requests(fresh, previous, a.decision_sheet_id)
        (a.output/'decision-update-requests.json').write_text(
            json.dumps(requests, ensure_ascii=False), encoding='utf-8')
    for name, rows in result['tables'].items():
        with (a.output/(name+'.csv')).open('w', encoding='utf-8-sig', newline='') as f:
            # Escape Excel formulas in downloadable CSVs; native Sheets uses stringValue.
            csv.writer(f).writerows([("'"+v if isinstance(v, str) and v.startswith(('=', '+', '-', '@')) else v)
                                    for v in row] for row in rows)
    print(json.dumps({'baseCommit': result['baseCommit'], 'counts': result['counts']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
