#!/usr/bin/env python3
"""Check catalog labels against reviewed MAIN step diagrams. Never merge identities."""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def normalized_label(value):
    return re.sub(r'[\s.·／/（）()]', '', value).lower()

def check_route(route, inventory):
    charts = {x['chartId']: x for x in inventory['charts']}
    ids = ['G17', 'G18'] if route['route_id'] == 'G17G18-PREVIEW' else [route['route_id']]
    allowed = set()
    for chart in ids:
        if chart not in charts:
            raise ValueError('No main-step inventory for '+chart)
        source = charts[chart]
        # Existing documented display aliases prove label correspondence only, not identity.
        allowed.update(normalized_label(n) for n in source['labels'])
        allowed.update(normalized_label(n) for n in source.get('labelDifferences', {}))
        allowed.update(normalized_label(n['name']) for n in source.get('ownerApprovedDisplayLabels', [])
                       if n.get('confirmedBy')=='owner')
    return [dict(routeId=route['route_id'], nodeId=n['id'], name=n['name'])
            for n in route.get('nodes', []) if normalized_label(n['name']) not in allowed]

def check_catalog(root=ROOT):
    inventory=json.loads((root/'data/audits/main_step_chart_label_inventory_20261028.json').read_text())
    manifest=json.loads((root/'data/unified-editor-manifest.json').read_text())
    issues=[]
    for row in manifest['routes']:
        route=json.loads((root/row['file'].split('?')[0]).read_text())
        issues.extend(check_route(route,inventory))
    return issues

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=ROOT)
    args=parser.parse_args()
    found=check_catalog(args.root)
    print(json.dumps(dict(status='failed' if found else 'passed',unexpectedNodes=found,
                         limitation='Labels only; not identity, directional evidence, or walking safety.'),ensure_ascii=False,indent=2))
    raise SystemExit(1 if found else 0)
