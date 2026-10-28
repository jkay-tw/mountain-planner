#!/usr/bin/env python3
"""Emit reviewed walking datasets; vehicles remain separate reference metadata."""
import argparse
import copy
from collections import Counter
import hashlib
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def read(p):return json.loads(Path(p).read_text())
def write(p,d):
    p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
def export(graph,review,root=ROOT):
    if graph.get('routingEnabled') is not True:raise ValueError('Graph still has unresolved issues')
    if any(n['id'].startswith('unresolved:') for n in graph['nodes']):raise ValueError('Unresolved physical identity')
    if graph['sourceWorkbookSHA256']!=review['sourceWorkbookSHA256']:raise ValueError('Review version mismatch')
    inventory=read(root/'data/audits/main_step_chart_label_inventory_20261028.json')
    source_urls={c['chartId']:c['sourceURL'] for c in inventory['charts']}
    groups={r['originalGroup']:(r['group'],r['chartId']) for r in review['rows']}
    chart_counts=Counter(c for _,c in groups.values());manifest={'dataset_version':'v0.7.24-owner-reviewed-all-groups',
        'mode':'global-owner-reviewed-walking-scoped-node-browser-preview','routes':[],
        'legacyRoutes':read(root/'data/owner-review-base-catalog.json')['routes']}
    node_map={n['id']:n for n in graph['nodes']};total=0
    for original,(group,chart) in sorted(groups.items(),key=lambda x:(x[1][1],x[0])):
        rid=chart if chart_counts[chart]==1 else chart+'-'+hashlib.sha256(original.encode()).hexdigest()[:8]
        selected=[copy.deepcopy(e) for e in graph['segments'] if group in e['sourceGroups']]
        if any(e.get('routingEnabled') is False or e['travelMode']!='walking' or e['verificationStatus']!='verified' for e in selected):raise ValueError('Unsafe walking direction')
        nodes=[{**copy.deepcopy(n),'groups':[rid]} for n in graph['nodes'] if group in n['groups']]
        local={n['id'] for n in nodes}
        if any(e['fromId'] not in local or e['toId'] not in local for e in selected):raise ValueError('Missing local node')
        for e in selected:
            e['sourceGroupNames']=e['sourceGroups']
            e['source']=source_urls[chart];e['sourceChart']=chart
        src=source_urls[chart]
        path='data/routes/owner-reviewed/'+rid+'.json'
        route={'route_id':rid,'route_name':group,'status':'owner-reviewed-preview','sourceChartIds':[chart],
               'routingPolicy':'verified-walking-only','source':{'publisher':'上河文化','image_url':src,'revision':'owner workbook reviewed 2026-10-28; follow-ups recorded separately'},
               'reviewBasis':'owner_workbook_review','nodes':nodes,'segments':selected,
               'sourceWorkbookSHA256':graph['sourceWorkbookSHA256']}
        write(root/path,route)
        manifest['routes'].append({'id':rid,'name':chart+'｜'+group,'file':path+'?v=v0724',
                                   'status':'owner-reviewed-preview','source_url':src})
        total+=len(selected)
    write(root/'data/unified-editor-manifest.json',manifest)
    write(root/'data/transport-owner-reviewed.json',{'routingEnabled':False,'use':'Separate transport reference; never automatic walking edges or coefficient-scaled times',
          'sourceWorkbookSHA256':graph['sourceWorkbookSHA256'],'segments':graph['transportSegments']})
    # Only explicitly owner-reviewed display labels are added, preserving original chart inventory.
    inv=read(root/'data/audits/main_step_chart_label_inventory_20261028.json')
    charts={c['chartId']:c for c in inv['charts']}
    for r in manifest['routes']:
        route=read(root/r['file'].split('?')[0]);chart=charts[route['sourceChartIds'][0]]
        existing=set(chart['labels'])|set(chart.get('labelDifferences',{}))|{x['name'] for x in chart.get('ownerApprovedDisplayLabels',[])}
        for n in route['nodes']:
            if n['name'] not in existing:
                chart.setdefault('ownerApprovedDisplayLabels',[]).append({'name':n['name'],'confirmedBy':'owner',
                  'basis':'Owner-confirmed endpoint or existing reviewed canonical display alias; not a new claim about literal chart text',
                  'sourceWorkbookSHA256':graph['sourceWorkbookSHA256']});existing.add(n['name'])
    write(root/'data/audits/main_step_chart_label_inventory_20261028.json',inv)
    return {'datasets':len(manifest['routes']),'inputWalkingDirections':total,'uniqueWalkingDirections':len(graph['segments']),
            'physicalNodes':len(graph['nodes']),'transportDirections':len(graph['transportSegments'])}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('graph');p.add_argument('review');a=p.parse_args()
    print(json.dumps(export(read(a.graph),read(a.review)),ensure_ascii=False,indent=2))
