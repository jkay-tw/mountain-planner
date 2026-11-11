"""Apply the archived owner coordinates and explicit display-name decisions.

Dry run by default. Does not merge identities or publish production terrain.
"""
import argparse
import copy
import hashlib
import json
import re
from apply_node_review_decisions import time_signature
from import_coordinate_review import twd97_to_wgs84
from node_coordinate_review import ROOT, build

SNAPSHOT = 'data/geometry/sources/g14-g15-decisions-synced-round2-20261111.json'
REPORT = 'data/geometry/sources/owner-coordinate-round2-application-20261111.json'


def prepare():
    read = lambda p: json.loads((ROOT/p).read_text(encoding='utf-8'))
    snap = read(SNAPSHOT)
    live = {r[1]: r for r in build()['tables']['審查與決策'][1:]}
    decisions = {r[1]: r for r in snap['review'][1:]}
    for row in snap['gpx'][1:]:
        if live[row[11]][4] != decisions[row[11]][4]:
            raise ValueError('Stale review baseline: '+row[11])
    paths = [r['file'].split('?')[0] for r in read('data/unified-editor-manifest.json')['routes']]
    routes = {p: read(p) for p in paths}
    before = time_signature(list(routes.values()))
    owner = read('data/geometry/sources/owner-coordinate-overrides.json')
    choices = {n['nodeId']: n for n in owner['nodes']}
    sha = hashlib.sha256((ROOT/SNAPSHOT).read_bytes()).hexdigest()
    report = {'date': '2026-11-11', 'sourceUrl': snap['sourceUrl'], 'snapshotSha256': sha,
              'ownerAmendments': snap['ownerAmendments'], 'coordinates': [], 'renames': [], 'aliases': [],
              'merges': [], 'timeSignatureBefore': before, 'changedRoutes': [], 'state': 'feature-inputs-applied'}
    for row in snap['gpx'][1:]:
        nid, name, x, y = row[11], row[1], row[5], row[6]
        if snap['ownerAmendments'].get(nid, {}).get('action') == 'retain':
            continue
        if x == '' and y == '':
            continue
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (x, y)):
            raise ValueError('Incomplete coordinate: '+nid)
        coordinate = twd97_to_wgs84(x, y)
        if not (119 < coordinate[0] < 123 and 21 < coordinate[1] < 26):
            raise ValueError('Outside Taiwan: '+nid)
        decision = decisions[nid]
        if decision[8:11] != ['採用填入座標', x, y]:
            raise ValueError('Sheet decision differs from supplied coordinate')
        previous = copy.deepcopy(choices.get(nid))
        target = choices.get(nid)
        if target is None:
            target = {'nodeId': nid}; owner['nodes'].append(target); choices[nid] = target
        target.update(reviewId=decision[0], name=name, choice='採用填入座標', action='coordinate',
                      coordinate=coordinate, originalCoordinate={'format': 'TWD97', 'x': x, 'y': y},
                      source={'url': snap['sourceUrl'], 'sheetId': 112,
                              'row': snap['gpx'].index(row)+1, 'snapshotSha256': sha,
                              'verification': 'user-supplied', 'supplementalSource': decision[11] if len(decision)>11 else ''},
                      note='使用者2026-11-11第二輪明確採用；'+str(decision[12] if len(decision)>12 else ''),
                      previousDecisions=[*(previous or {}).get('previousDecisions', []),
                        {k: v for k, v in (previous or {}).items() if k != 'previousDecisions'}] if previous else [])
        report['coordinates'].append({'nodeId': nid, 'name': name, 'coordinate': coordinate,
                                      'twd97': [x,y], 'previousOverride': previous})
    renames, aliases = {}, {}
    for nid, row in decisions.items():
        m = re.fullmatch(r'改名為["「](.+?)["」]', row[7] if len(row)>7 else '')
        if m:
            renames[nid] = m.group(1)
        m = re.fullmatch(r'又稱["「](.+?)["」]', row[12] if len(row)>12 else '')
        if m:
            aliases[nid] = m.group(1)
    writes = {}
    for path, route in routes.items():
        previous = copy.deepcopy(route)
        for n in route['nodes']:
            nid = n['id']
            if nid in renames:
                name = renames[nid]
                item = {'nodeId': nid, 'oldName': n['name'], 'name': name}
                if item not in report['renames']: report['renames'].append(item)
                n['aliases'] = sorted(set(n.get('aliases', [])+[n['name']])-{name})
                n['name'] = name
                if nid in choices: choices[nid].update(name=name, displayName=name)
            if nid in aliases:
                n['aliases'] = sorted(set(n.get('aliases', [])+[aliases[nid]])-{n['name']})
                item = {'nodeId': nid, 'alias': aliases[nid]}
                if item not in report['aliases']: report['aliases'].append(item)
        by = {n['id']: n for n in route['nodes']}
        for edge in route['segments']+route.get('manualConnections', []):
            for side in ('from', 'to'):
                edge[side] = by[edge[side+'Id']]['name']
        if route != previous:
            writes[path] = route; writes['preview/'+path] = route
            report['changedRoutes'].append({'file': path, 'previousNodes': [n for n in previous['nodes']
                if n['id'] in renames or n['id'] in aliases]})
    report['timeSignatureAfter'] = time_signature(list(routes.values()))
    if report['timeSignatureAfter'] != before:
        raise ValueError('Directional minutes or source metadata changed')
    inventory_path = 'data/audits/main_step_chart_label_inventory_20261028.json'
    inventory = read(inventory_path)
    for nid, name in renames.items():
        chart = next(c for c in inventory['charts'] if c['chartId']=='G15')
        chart.setdefault('ownerApprovedDisplayLabels', []).append({'nodeId': nid, 'name': name,
            'confirmedBy': 'owner', 'confirmedAt': '2026-11-11', 'sourceUrl': snap['sourceUrl'],
            'basis': '審查頁明確改名；顯示名稱核准，不新增官方來源核實'})
    owner['reviewDate'] = '2026-11-11'
    writes['data/geometry/sources/owner-coordinate-overrides.json'] = owner
    writes[inventory_path] = inventory
    writes[REPORT] = report
    return writes, report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if args.apply and (ROOT/REPORT).exists():
        raise ValueError('Round already applied; do not duplicate history')
    writes, report = prepare()
    if args.apply:
        for p, data in writes.items():
            (ROOT/p).write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'apply': args.apply, 'coordinates': len(report['coordinates']),
                      'renames': report['renames'], 'aliases': report['aliases'],
                      'timeSignatureUnchanged': report['timeSignatureBefore']==report['timeSignatureAfter']}, ensure_ascii=False))
