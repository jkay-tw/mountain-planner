"""Merge explicit decisions from an archived Google Sheets review; blanks preserve prior decisions."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from import_coordinate_review import twd97_to_wgs84

ROOT = Path(__file__).resolve().parents[1]


def apply(snapshot_path):
    snapshot = json.loads(snapshot_path.read_text())
    digest = hashlib.sha256(snapshot_path.read_bytes()).hexdigest()
    manifest = json.loads((ROOT / 'data/unified-editor-manifest.json').read_text())
    routes = {entry['file'].split('?')[0]: json.loads((ROOT / entry['file'].split('?')[0]).read_text())
              for entry in manifest['routes']}
    signature = [{'id':r['route_id'],'nodes':[n['id'] for n in r['nodes']],
                  'segments':[{k:v for k,v in s.items() if k not in ('from','to')} for s in r['segments']],
                  'manualConnections':[{k:v for k,v in s.items() if k not in ('from','to')} for s in r.get('manualConnections',[])]}
                 for r in routes.values()]
    topology_sha = hashlib.sha256(json.dumps(signature,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
    nodes = {n['id']: n for route in routes.values() for n in route['nodes']}
    review_path = ROOT / 'data/geometry/sources/owner-coordinate-overrides.json'
    review = json.loads(review_path.read_text())
    by = {n['nodeId']: n for n in review['nodes']}
    # Explicit, reviewed identity resolutions for the only two rows missing IDs.
    missing = {
        ('G19｜南一段', '溪南山登山口'): ('node:2fc23a0b794f59ec7196', {'石山西鞍'}),
        ('G19｜南一段', '林道鞍部'): ('node:16d0ce554a26b76bdaa8', {'石瀑區', '新舊路岔路'}),
    }
    decisions = []
    for row_number, values in enumerate(snapshot['values'], 7):
        row = (values + [None] * 13)[:13]
        if not row[0] or row[5] is None or row[6] is None:
            continue
        review_id, group, name, choice, fmt, x, y, note = row[:8]
        node_id = row[12]
        if not node_id:
            node_id, expected_neighbours = missing[(group, name)]
            adjacent = {nodes[s['toId'] if s['fromId'] == node_id else s['fromId']]['name']
                        for route in routes.values() for s in route['segments']
                        if node_id in (s['fromId'], s['toId'])}
            assert expected_neighbours <= adjacent, (name, adjacent)
            review_id = f'SHEET-20261107-R{row_number}'
        assert node_id in nodes and name in [nodes[node_id]['name'], *nodes[node_id].get('aliases', [])], (node_id, name)
        assert fmt in ('TWD97', 'WGS84'), fmt
        coordinate = twd97_to_wgs84(float(x), float(y)) if fmt == 'TWD97' else [float(x), float(y)]
        assert 119 < coordinate[0] < 123 and 21 < coordinate[1] < 26, (name, coordinate)
        prior = by.get(node_id)
        same = prior and prior.get('action') == 'coordinate' and prior.get('coordinate') == coordinate
        if not same:
            replacement = dict(prior or {}, reviewId=review_id, nodeId=node_id, name=name,
                               choice=choice or '自行補座標', note=note or '', action='coordinate',
                               coordinate=coordinate, originalCoordinate={'format':fmt,'x':x,'y':y},
                               source={'url':snapshot['sourceUrl'],'sheetId':snapshot['sheetId'],
                                       'row':row_number,'snapshotSha256':digest,'verification':'user-supplied'})
            if prior:
                review['nodes'][review['nodes'].index(prior)] = replacement
            else:
                review['nodes'].append(replacement)
            by[node_id] = replacement
        decisions.append({'row':row_number,'reviewId':review_id,'nodeId':node_id,'name':name,
                          'coordinate':coordinate,'changed':not bool(same)})
        if note == '改名稱為"特生中心"':
            by[node_id]['displayName'] = '特生中心'
            for path, route in routes.items():
                target = next((n for n in route['nodes'] if n['id'] == node_id), None)
                if target:
                    if name not in target['aliases']:
                        target['aliases'].append(name)
                    target['name'] = '特生中心'
                    for segment in route['segments'] + route.get('manualConnections', []):
                        for side in ('from', 'to'):
                            if segment[side+'Id'] == node_id:
                                segment[side] = '特生中心'
                    content = json.dumps(route, ensure_ascii=False, indent=2) + '\n'
                    (ROOT / path).write_text(content)
                    (ROOT / 'preview' / path).write_text(content)
    review_path.write_text(json.dumps(review, ensure_ascii=False, indent=2) + '\n')
    inventory_path = ROOT / 'data/audits/main_step_chart_label_inventory_20261028.json'
    inventory = json.loads(inventory_path.read_text())
    chart = next(c for c in inventory['charts'] if c['chartId'] == 'G19')
    if not any(n['name'] == '特生中心' for n in chart.get('ownerApprovedDisplayLabels', [])):
        chart.setdefault('ownerApprovedDisplayLabels', []).append({
            'name':'特生中心','confirmedBy':'owner','confirmedAt':snapshot['retrievedDate'],
            'nodeId':'node:9a67a747c35d44edc6e7','previousName':'石山林道登山口',
            'basis':'使用者 Google Sheet 第61列 Q156 指定改名；保留原 Node ID 與舊名別名。',
            'sourceUrl':snapshot['sourceUrl']})
        inventory_path.write_text(json.dumps(inventory,ensure_ascii=False,indent=2)+'\n')
    report = {'sourceUrl':snapshot['sourceUrl'],'snapshotSha256':digest,'decisions':decisions,
              'baseCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
              'topologyTimeSha256':topology_sha,
              'note':'Blank/pending rows preserve existing decisions. Existing ignored/deleted nodes are not restored.'}
    output = ROOT / 'data/geometry/sources/sheet-coordinate-import-20261107.json'
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'coordinateRows':len(decisions),'changed':sum(n['changed'] for n in decisions)},ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    apply(parser.parse_args().snapshot)
