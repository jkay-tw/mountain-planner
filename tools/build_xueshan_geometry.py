"""Rebuild the candidate corridor from a pinned OSM snapshot, without snapping ways.

Run: python3 tools/build_xueshan_geometry.py
OSM ways are selected explicitly after inspection. Only shared OSM node IDs
connect ways; proximity never creates an edge. Closed/private ways are rejected.
"""
import hashlib
import heapq
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data/geometry/sources/xueshan-osm-20261102.osm'
OUTPUT = ROOT / 'data/geometry/xueshan-osm-v1.json'
WAY_IDS = ('1308583311', '1308583312', '138516545', '1293296092',
           '1222030824', '1222030825', '464086142', '464085687',
           '464085679', '464086143')


def distance(a, b):
    lat1, lat2 = math.radians(a[1]), math.radians(b[1])
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(math.radians(b[0]-a[0])/2)**2
    return 12742000 * math.asin(min(1, math.sqrt(h)))


def tags(e):
    return {t.get('k'): t.get('v') for t in e.findall('tag')}


def build(source=SOURCE):
    root = ET.parse(source).getroot()
    nodes = {n.get('id'): n for n in root.findall('node')}
    ways = {w.get('id'): w for w in root.findall('way')}
    coord = lambda i: [float(nodes[i].get('lon')), float(nodes[i].get('lat'))]
    graph = {}
    for wid in WAY_IDS:
        w = ways[wid]
        t = tags(w)
        if t.get('highway') not in ('path', 'footway', 'steps', 'pedestrian') or any(t.get(k) in ('no', 'private') for k in ('access', 'foot')) or t.get('oneway:foot', 'no') != 'no':
            raise ValueError(f'Not an eligible walking way: {wid}')
        refs = [x.get('ref') for x in w.findall('nd')]
        for a, b in zip(refs, refs[1:]):
            length = distance(coord(a), coord(b))
            graph.setdefault(a, []).append((b, length, wid))
            if t.get('oneway:foot') != 'yes':
                graph.setdefault(b, []).append((a, length, wid))

    def path(start, end):
        queue, costs, previous = [(0, start)], {start: 0}, {}
        while queue:
            cost, a = heapq.heappop(queue)
            if cost != costs[a]:
                continue
            if a == end:
                break
            for b, length, wid in graph.get(a, []):
                if cost + length < costs.get(b, math.inf):
                    costs[b], previous[b] = cost + length, (a, wid)
                    heapq.heappush(queue, (cost + length, b))
        if end not in costs:
            raise ValueError(f'Disconnected OSM anchors: {start}, {end}')
        ids, edge_ways, a = [end], [], end
        while a != start:
            a, wid = previous[a]
            ids.append(a)
            edge_ways.append(wid)
        return list(reversed(ids)), list(reversed(edge_ways))

    # Explicit entity interpretation; these are candidate associations, not new
    # canonical identities. Hut footprints and route anchors remain separate.
    specs = [
        ('g04-045', '雪山登山口', 'node', '1525419883', '1525419883', ''),
        ('shared:cw-v07-003', '七卡山莊', 'way', '238820083', '2466185254', '步道錨點位於山莊旁主線；不畫直線連入建築。'),
        ('g04-027', '哭坡觀景台', 'node', '2302571433', '1518876609', '觀景台標記與步道錨點分開保存。'),
        ('g04-044', '雪山東峰', 'node', '12468291933', '2466185317', '使用峰頂標示牌作候選；與 OSM natural=peak 點分開。'),
        ('shared:cw-v07-004', '三六九山莊', 'way', '238470041', '6654653753', 'OSM 山屋標記為施工中、access=no；線形只經附近步道，不代表可入內或住宿。'),
        ('shared:cw-v07-074', '雪山主峰', 'node', '12468295331', '4592425592', '使用峰頂標示牌作候選；不把記錄高程當官方測量。'),
    ]
    candidates = []
    for node_id, name, typ, oid, anchor, note in specs:
        entity = nodes[oid] if typ == 'node' else ways[oid]
        if typ == 'node':
            point, method = coord(oid), 'OSM point'
        else:
            ring = [x.get('ref') for x in entity.findall('nd')][:-1]
            point = [sum(coord(i)[j] for i in ring)/len(ring) for j in (0, 1)]
            method = 'mean of OSM footprint vertices (label point only)'
        candidates.append({'nodeId': node_id, 'name': name, 'status': 'candidate',
                           'coordinate': point, 'coordinateMethod': method,
                           'osmRef': f'{typ}/{oid}', 'anchorOsmNodeId': anchor,
                           'anchor': coord(anchor), 'offsetMeters': round(distance(point, coord(anchor)), 1),
                           'note': note})
    candidates.append({'nodeId': 'g04-039', 'name': '圈谷底部', 'status': 'unresolved',
                       'coordinate': None, 'anchor': None,
                       'note': '先前候選 24.38857,121.23636 對應 OSM 圈谷氣象站，不能綁定圈谷底部。完整穿越三六九—主峰時可顯示整段候選線形，但不定位圈谷路點；以圈谷為起終點則缺少線形。'})
    spans = []
    for a, b in zip(candidates[:6], candidates[1:6]):
        ids, edge_ways = path(a['anchorOsmNodeId'], b['anchorOsmNodeId'])
        coordinates = [coord(i) for i in ids]
        via = ['g04-039'] if a['nodeId'] == 'shared:cw-v07-004' else []
        spans.append({'id': f'xueshan-{len(spans)+1}', 'fromId': a['nodeId'], 'toId': b['nodeId'],
                      'viaNodeIds': via, 'status': 'candidate', 'reversible': True,
                      'coordinates': coordinates, 'osmNodeIds': ids,
                      'edgeWayIds': edge_ways,
                      'distanceMeters': round(sum(distance(x,y) for x,y in zip(coordinates, coordinates[1:])), 2)})
    # Includes entity and alternative objects, to retain reasons for exclusion.
    records = []
    for e in list(root.findall('node')) + list(root.findall('way')):
        if e.tag == 'way' or tags(e):
            records.append({'type': e.tag, 'id': e.get('id'), 'version': int(e.get('version')),
                            'timestamp': e.get('timestamp'), 'changeset': e.get('changeset'), 'tags': tags(e)})
    return {'schemaVersion': 1, 'id': 'xueshan-osm-20261102',
            'status': 'candidate-not-field-verified',
            'source': {'name': 'OpenStreetMap', 'retrievedDate': '2026-11-02',
                       'url': 'https://api.openstreetmap.org/api/0.6/map?bbox=121.225,24.38,121.302,24.4',
                       'bbox': [121.225,24.38,121.302,24.4],
                       'license': 'ODbL 1.0', 'attribution': '© OpenStreetMap contributors',
                       'copyrightUrl': 'https://www.openstreetmap.org/copyright',
                       'snapshot': 'sources/xueshan-osm-20261102.osm',
                       'snapshotSha256': hashlib.sha256(source.read_bytes()).hexdigest()},
            'nodes': candidates, 'spans': spans, 'osmObjects': records,
            'notes': ['僅 OSM 候選線形，未經現地核實；線形距離不等於官方里程。',
                      '禁止／私人路段排除；採用 OSM 臨時步道，資料日期不代表現時開放。',
                      '圈谷底部未定位；不提供假座標或海拔插值。']}


if __name__ == '__main__':
    result = build()
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print(f'{len(result["nodes"])} candidate records, {len(result["spans"])} spans -> {OUTPUT}')
