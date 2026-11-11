"""Screen the owner Sheet proposals without mutating route or terrain inputs.

The output is a proposal audit, not a rebuilt runtime or source verification.
"""
import copy
import itertools
import json
import re
import sys
from pathlib import Path
from audit_node_coordinates import audit, distance
from full_dem import Dem
from import_coordinate_review import twd97_to_wgs84
from node_coordinate_review import ROOT, build, digest


def review(snapshot, dem_path):
    bridge = build()
    terrain = json.loads((ROOT/bridge['runtimePath']).read_text(encoding='utf-8'))
    baseline = digest(terrain)
    proposed = copy.deepcopy(terrain)
    nodes = {n['nodeId']: n for n in proposed['nodes']}
    catalog = {r[0]: r for r in bridge['tables']['節點總表'][1:]}
    decisions = {r[1]: r for r in snapshot['review'][1:]}
    dem = Dem(dem_path)
    changes, incomplete, policy_conflicts, renamed = [], [], [], []
    for row in snapshot['gpx'][1:]:
        nid, name, x, y = row[11], row[1], row[5], row[6]
        if snapshot.get('ownerAmendments', {}).get(nid, {}).get('action') == 'retain':
            continue
        if x == '' and y == '':
            continue
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (x, y)):
            incomplete.append({'nodeId': nid, 'name': name, 'x': x, 'y': y})
            continue
        coordinate = twd97_to_wgs84(x, y)
        n = nodes[nid]
        if not (119 < coordinate[0] < 123 and 21 < coordinate[1] < 26):
            raise ValueError('Outside Taiwan screening bounds: '+nid)
        previous = n.get('coordinate')
        changes.append({'nodeId': nid, 'name': name, 'x': x, 'y': y,
                        'coordinate': coordinate, 'previousCoordinate': previous,
                        'shiftMeters': round(distance(previous, coordinate), 1) if previous else None})
        if n.get('coordinatePolicy', 'active') != 'active':
            policy_conflicts.append({'nodeId': nid, 'name': name, 'policy': n['coordinatePolicy'],
                                     'note': 'Owner supplied a coordinate; existing display policy is preserved for this audit.'})
            continue
        n.update(coordinate=coordinate, elevationMeters=dem.sample(coordinate),
                 coordinateSource={'source': 'owner-review'}, coordinateMethod='owner-sheet-coordinate')
        catalog[nid][4:8] = [*coordinate, x, y]
        bridge['tables']['來源明細'].append(['proposed-'+nid, nid, '人工覆寫決策', '',
            json.dumps({'action': 'coordinate', 'coordinate': coordinate}), 'Sheet proposed F:G', '使用者指定；未新增來源核實'])
    for nid, row in decisions.items():
        text = row[7] if len(row) > 7 else ''
        match = re.fullmatch(r'改名為["「](.+?)["」]', text)
        if match and nid in nodes:
            name = match.group(1)
            renamed.append({'nodeId': nid, 'oldName': nodes[nid]['name'], 'name': name})
            nodes[nid]['name'] = name
            catalog[nid][2] = name
    changed = {c['nodeId'] for c in changes}
    # Stale geometries must never be used to score the proposed coordinates.
    proposed['routingAnchors'] = [a for a in proposed.get('routingAnchors', []) if a['nodeId'] not in changed]
    proposed['spans'] = [s for s in proposed.get('spans', [])
                         if not changed.intersection([s['fromId'], s['toId'], *s.get('viaNodeIds', [])])]
    selected = json.loads((ROOT/'data/geometry/all-route-coordinates-v1.json').read_text(encoding='utf-8'))
    result = audit(bridge, proposed, selected)
    pairs = []
    normalize = lambda text: re.sub(r'\s+', '', text).casefold()
    for a, b in itertools.combinations(nodes.values(), 2):
        if not a.get('coordinate') or not b.get('coordinate'):
            continue
        d = distance(a['coordinate'], b['coordinate'])
        if d <= 50:
            pairs.append({'a': a['nodeId'], 'aName': a['name'], 'b': b['nodeId'], 'bName': b['name'],
                          'meters': round(d, 2), 'sameNormalizedName': normalize(a['name']) == normalize(b['name'])})
    assert digest(terrain) == baseline
    return {'date': '2026-11-11', 'state': 'proposed-not-applied',
            'snapshotDigest': digest(snapshot), 'runtimePath': bridge['runtimePath'],
            'runtimeDigest': baseline, 'scope': '721 nodes; affected OSM/span checks require a source-aware rebuild',
            'coordinates': changes, 'incomplete': incomplete, 'policyConflicts': policy_conflicts,
            'renames': renamed, 'nearbyPairsWithin50m': pairs, 'proposedSpatialAudit': result,
            'demSource': dem.provenance()}


if __name__ == '__main__':
    source, dem_path, output = map(Path, sys.argv[1:])
    result = review(json.loads(source.read_text(encoding='utf-8')), dem_path)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({k: result[k] for k in ('state', 'incomplete', 'policyConflicts', 'renames')}, ensure_ascii=False))
    print(json.dumps(result['proposedSpatialAudit']['counts'], ensure_ascii=False))
    for n in result['proposedSpatialAudit']['nodes']:
        if n['status'] in ('優先確認', '建議複核'):
            print(json.dumps({k: n[k] for k in ('nodeId', 'name', 'groups', 'status', 'findings')}, ensure_ascii=False))
    print('nearbyPairsWithin50m', len(result['nearbyPairsWithin50m']))
