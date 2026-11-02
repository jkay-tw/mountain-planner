"""Inventory all reviewed Node IDs against OSM, without assigning identities.

Usage: python tools/build_coordinate_inventory.py /path/to/taiwan.osm.pbf
Requires pyosmium for reading the public extract; production code has no new dependency.
All name matches are candidates. Only existing reviewed geometry is usable.
"""
import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAME_KEYS = ('name', 'name:zh', 'name:zh-Hant', 'official_name', 'alt_name', 'old_name', 'short_name')


def normalize(name):
    # Orthography only: never equate huts, summits, forks or numbered camps.
    return re.sub(r'\s+', '', name).replace('臺', '台')


def search_names(node):
    # Search hints only. These never become aliases or physical identities.
    exact=[node['name'],*node.get('aliases',[])]
    variants=set()
    for name in exact:
        stripped=re.sub(r'[（(][^）)]*[）)]','',name)
        if stripped!=name and stripped:variants.add(stripped)
        for value in (name,stripped):
            if value.endswith('主峰') and len(value)>3:variants.add(value[:-2])
            if value.endswith('山莊'):variants.add(value[:-2]+'山屋')
            if value.endswith('山屋'):variants.add(value[:-2]+'山莊')
            if '岔' in value:variants.add(value.replace('岔','叉'))
            if '叉' in value:variants.add(value.replace('叉','岔'))
    return exact,sorted(variants-set(exact))


def load_nodes(root=ROOT):
    manifest = json.loads((root/'data/unified-editor-manifest.json').read_text())
    nodes = {}
    for group in manifest['routes']:
        route = json.loads((root/group['file'].split('?')[0]).read_text())
        by_id = {n['id']: n for n in route['nodes']}
        for n in route['nodes']:
            record = nodes.setdefault(n['id'], {'nodeId': n['id'], 'name': n['name'], 'aliases': n.get('aliases', []), 'groups': [], 'neighbors': []})
            if record['name'] != n['name']:
                raise ValueError('Conflicting reviewed Node ID '+n['id'])
            record['aliases'] = sorted(set(record['aliases']) | set(n.get('aliases', [])))
            if group['name'] not in record['groups']:
                record['groups'].append(group['name'])
        for s in route['segments']:
            if s.get('travelMode') != 'walking' or s.get('verificationStatus') != 'verified' or s.get('routingEnabled') is False:
                continue
            for a,b in [(s['fromId'],s['toId']),(s['toId'],s['fromId'])]:
                if b not in [x['nodeId'] for x in nodes[a]['neighbors']]:
                    nodes[a]['neighbors'].append({'nodeId':b,'name':by_id[b]['name']})
    return manifest, nodes


def match_candidates(nodes, objects, existing):
    lookup = {}
    for obj in objects:
        for key in NAME_KEYS:
            for name in obj['tags'].get(key, '').split(';'):
                if name:
                    lookup.setdefault(normalize(name), {})[obj['osmRef']] = obj
    records = []
    for n in nodes.values():
        choices = {}
        exact,variants=search_names(n)
        for name in exact:
            choices.update({ref:{**c,'matchBasis':'名稱或既有別名'} for ref,c in lookup.get(normalize(name), {}).items()})
        for name in variants:
            for ref,c in lookup.get(normalize(name),{}).items():
                choices.setdefault(ref,{**c,'matchBasis':'名稱變體搜尋，非已確認別名'})
        old = existing.get(n['nodeId'])
        status = 'available' if old and old.get('coordinate') else ('multiple-candidates' if len(choices)>1 else 'single-candidate' if choices else 'no-candidate')
        record = {**n, 'status': status, 'coordinate': old.get('coordinate') if old else None,
                  'candidates': sorted(choices.values(), key=lambda o:o['osmRef'])}
        if old:
            record['existingGeometry'] = {k:old[k] for k in ('coordinateMethod','osmRef','elevationMeters') if k in old}
        records.append(record)
    return records


def refine_candidates(records):
    """Prioritize compatible landforms and regional context; never bind a node.

    Preserve rejected name matches for audit. A single remaining candidate is
    still unconfirmed, including when it happens to be the only one in Taiwan.
    """
    for n in records:
        choices=n['candidates']
        name=n['name']
        compatible=[]
        if re.search(r'(山|峰)(東峰|西峰|南峰|北峰|主峰)?$',name):
            compatible=[c for c in choices if c['tags'].get('natural')=='peak']
        elif re.search(r'(山屋|山莊)$',name):
            compatible=[c for c in choices if c['tags'].get('tourism') in ('alpine_hut','wilderness_hut') or c['tags'].get('building') in ('hut','cabin')]
        elif name.endswith(('鞍部','山口')) and not name.endswith('登山口'):
            compatible=[c for c in choices if c['tags'].get('natural')=='saddle' or c['tags'].get('mountain_pass')=='yes']
        elif name.endswith(('營地','營地(水)')):
            compatible=[c for c in choices if c['tags'].get('tourism')=='camp_site']
        if compatible:
            n['candidates']=compatible
            n['rejectedCandidates']=[{**c,'reason':'同名但地物類型非優先候選'} for c in choices if c not in compatible]
    anchors={}
    for n in records:
        c=n['candidates']
        if len(c)==1 and c[0]['tags'].get('natural')=='peak':
            for group in n['groups']:anchors.setdefault(group,[]).append(c[0]['coordinate'])
    for n in records:
        envelopes=[]
        for group in n['groups']:
            points=anchors.get(group,[])
            if len(points)>=3:
                envelopes.append((min(p[0] for p in points)-.18,min(p[1] for p in points)-.18,max(p[0] for p in points)+.18,max(p[1] for p in points)+.18))
        choices=n['candidates']
        if envelopes:
            nearby=[c for c in choices if any(a<=c['coordinate'][0]<=b and d<=c['coordinate'][1]<=e for a,d,b,e in envelopes)]
            n.setdefault('rejectedCandidates',[]).extend({**c,'reason':'在所屬圖組山峰候選範圍外（含約20公里緩衝）'} for c in choices if c not in nearby)
            n['candidates']=nearby
        if n['status']!='available':
            n['status']='multiple-candidates' if len(n['candidates'])>1 else 'single-candidate' if n['candidates'] else 'no-candidate'
    return records


def extract(pbf, nodes, partial=False):
    import osmium
    requested = {normalize(name) for n in nodes.values() for names in search_names(n) for name in names}
    generic={'水源','營地','風口','鞍部','工寮','木屋','溪源','瀑布','新山','展望點','停車場','岔路','叉路','岔路口','叉路口','登山口'}
    pattern=re.compile('|'.join(re.escape(s) for s in sorted(requested,key=len,reverse=True) if len(s)>=2 and s not in generic)) if partial else None
    objects, ways, needed = [], [], set()
    def relevant(tags):
        names=[normalize(name) for k in NAME_KEYS for name in tags.get(k,'').split(';') if name]
        return any(name in requested or (pattern and pattern.search(name)) for name in names)
    class Names(osmium.SimpleHandler):
        def node(self,n):
            if not len(n.tags):
                return
            t = dict(n.tags)
            if relevant(t):
                objects.append({'osmRef':f'node/{n.id}', 'version':n.version, 'timestamp':str(n.timestamp), 'coordinate':[n.location.lon,n.location.lat], 'coordinateMethod':'OSM point', 'tags':t})
        def way(self,w):
            t=dict(w.tags)
            if relevant(t):
                refs=[n.ref for n in w.nodes];needed.update(refs)
                ways.append({'osmRef':f'way/{w.id}','version':w.version,'timestamp':str(w.timestamp),'nodeRefs':refs,'tags':t})
    # Filter in C++ before Python callbacks: unnamed shape nodes cannot match.
    osmium.apply(str(pbf), osmium.filter.KeyFilter(*NAME_KEYS), Names())
    coordinates={}
    class Locations(osmium.SimpleHandler):
        def node(self,n):
            if n.id in needed:coordinates[n.id]=[n.location.lon,n.location.lat]
    osmium.apply(str(pbf), osmium.filter.IdFilter(needed), Locations())
    for w in ways:
        points=[coordinates[i] for i in w.pop('nodeRefs') if i in coordinates]
        if points:
            if points[0]==points[-1]:points=points[:-1]
            w['coordinate']=[sum(p[j] for p in points)/len(points) for j in (0,1)]
            w['coordinateMethod']='mean of OSM way vertices (candidate label only; not trail anchor)'
            objects.append(w)
    return objects


def report(inventory, path):
    records=inventory['nodes'];counts=Counter(n['status'] for n in records)
    lines=['# 全路線座標盤點｜2026-11-02','',
           f"24 個圖組，{len(records)} 個不同 Node ID。已有可用座標 {counts['available']} 點；單一候選 {counts['single-candidate']} 點；多候選 {counts['multiple-candidates']} 點；未取得合適候選 {counts['no-candidate']} 點。",'',
           '目前完成全路線第一階段盤點，尚未完成全部路線的線形／DEM／GPX 擴充。既有雪山與 v0.7.32 版面維持；使用者已完成中視窗排列驗收。後續先處理單一候選的相鄰路段／錨點比對，再處理多候選與缺失點；不要求使用者重新核對已驗收功能。','',
           '「候選」來自 OSM node／way 名稱、既有別名或標示清楚的名稱變體搜尋，再優先保留相容地物類型及所屬圖組區域，尚未確認是上河同一實體，不寫入正式路網或行程。被篩除的同名物件仍保存於 JSON。山屋建築中心、道路中點與步道錨點不同。未找到適合候選也不代表 OSM 沒有該地點，可能未命名、名稱不同或採 relation 表示；本批未解析 relation 幾何。', '',
           '優先補充下列未找到候選的地點。可提供 TWD97、WGS84、地圖連結或明確的 OSM 物件；毋須重新提供雪山已確認點。前後節點是路網相鄰關係，不是固定登山方向。','',
           '## 各圖組摘要','','跨圖同一 Node ID 在各自圖組均列入；下表不可直接加總為獨立節點數。','','|圖組|已有座標|單一候選|多候選|未取得合適候選|','|---|---:|---:|---:|---:|']
    for group in dict.fromkeys(g for n in records for g in n['groups']):
        c=Counter(n['status'] for n in records if group in n['groups'])
        lines.append('|'+group+'|'+ '|'.join(str(c[k]) for k in ('available','single-candidate','multiple-candidates','no-candidate'))+'|')
    lines+=['','## 未取得合適候選（需補定位線索）','','|圖組|Node ID|地點|相鄰節點|','|---|---|---|---|']
    safe=lambda s:str(s).replace('|','／').replace('\n',' ')
    for n in records:
        if n['status']=='no-candidate':lines.append('|'+ '|'.join(map(safe,['、'.join(n['groups']),n['nodeId'],n['name'],'、'.join(x['name'] for x in n['neighbors'])]))+'|')
    lines+=['','## 多候選（需區分實體）','','|圖組|Node ID|地點|候選物件及位置（WGS84 緯度,經度）|','|---|---|---|---|']
    for n in records:
        if n['status']=='multiple-candidates':
            choices='<br>'.join(f"[{c['tags'].get('name',c['osmRef'])}](https://www.openstreetmap.org/{c['osmRef']}) ({c['coordinate'][1]:.7f}, {c['coordinate'][0]:.7f})" for c in n['candidates'])
            lines.append('|'+ '|'.join(map(safe,['、'.join(n['groups']),n['nodeId'],n['name'],choices]))+'|')
    lines+=['','## 單一候選（先做路線／錨點比對，暫不需使用者逐點補座標）','','|圖組|Node ID|地點|候選物件|比對方式|','|---|---|---|---|---|']
    for n in records:
        if n['status']=='single-candidate':
            c=n['candidates'][0];lines.append('|'+ '|'.join(map(safe,['、'.join(n['groups']),n['nodeId'],n['name'],f"[OSM {c['osmRef']}](https://www.openstreetmap.org/{c['osmRef']})",c.get('matchBasis','名稱／別名')]))+'|')
    lines+=['','來源：© OpenStreetMap contributors，ODbL 1.0；Geofabrik 台灣區域擷取，'+inventory['source']['url']+'。PBF SHA-256：`'+inventory['source']['sha256']+'`。','',
            '既有正式時間、Node ID 與跨圖核對結果不變。後續需完成地點與步道錨點對應、指定路線走廊、缺口檢查，才可計算該段距離／升降及匯出 GPX；不能以端點直線或不受限制的最短路徑代替上河路線。']
    path.write_text('\n'.join(lines)+'\n')


def main():
    parser=argparse.ArgumentParser();parser.add_argument('pbf',type=Path);args=parser.parse_args()
    manifest,nodes=load_nodes();existing={n['nodeId']:n for n in json.loads((ROOT/'data/geometry/xueshan-terrain-v1.json').read_text())['nodes']}
    objects=extract(args.pbf,nodes)
    records=refine_candidates(match_candidates(nodes,objects,existing))
    digest=hashlib.file_digest(args.pbf.open('rb'),'sha256').hexdigest()
    import osmium
    reader=osmium.io.Reader(str(args.pbf));timestamp=reader.header().get('osmosis_replication_timestamp');reader.close()
    inventory={'schemaVersion':1,'date':'2026-11-02','source':{'url':'https://download.geofabrik.de/asia/taiwan-latest.osm.pbf','sha256':digest,'osmTimestamp':timestamp,'license':'ODbL-1.0','attribution':'© OpenStreetMap contributors'},'counts':dict(Counter(n['status'] for n in records)),'nodes':records}
    out=ROOT/'data/audits/all-route-coordinate-inventory-20261102.json';out.write_text(json.dumps(inventory,ensure_ascii=False,indent=2)+'\n')
    report(inventory,ROOT/'docs/ALL_ROUTE_COORDINATE_GAPS_20261102.md')
    print(json.dumps({'nodes':len(records),'osmObjects':len(objects),'counts':inventory['counts']},ensure_ascii=False))

if __name__=='__main__':main()
