"""Apply the explicitly archived 2026-11-11 review. No GPX auto-acceptance.

Coordinates are build inputs; the source-aware Preview rebuild is required next.
Old IDs, previous overrides and original affected directional edges are archived.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
from import_coordinate_review import twd97_to_wgs84
from node_coordinate_review import ROOT, build, digest

SNAPSHOT = 'data/geometry/sources/node-review-decisions-20261111.json'
REPORT = 'data/geometry/sources/node-review-application-20261111.json'
# Explicitly identified by the owner, NOT inferred from labels or proximity.
MERGES = {
    'node:1e33d65d02cee63e0cd4': 'shared:cw-v07-015',
    'node:351f4b260c8941f8d7e4': 'node:1670c3f1247b747ba02a',
    'node:c68a6096c4fde85a1b28': 'node:8426704609cea5d43db4',
}
RENAMES = {'node:43c9393ad0d04c1318ea': '3.1K登山口',
           'node:ea1afe9db60667f52737': '35K工寮岔路'}


def time_signature(routes):
    return digest([{'route':r['route_id'], 'segments':[{k:v for k,v in e.items()
                     if k not in ('from','to','fromId','toId')} for e in r['segments']],
                    'manual':[{k:v for k,v in e.items() if k not in ('from','to','fromId','toId')}
                              for e in r.get('manualConnections',[])]} for r in routes])


def prepare(root=ROOT):
    def read(p): return json.loads((root/p).read_text(encoding='utf-8'))
    snapshot=read(SNAPSHOT)
    amendments=snapshot.get('ownerAmendments', {})
    if amendments.get('17K水泥橋') != {'x':275885,'y':2590697} or amendments.get('杜鵑營地合併') != [
            'node:c68a6096c4fde85a1b28','node:8426704609cea5d43db4']:
        raise ValueError('Missing explicit owner correction/merge confirmation')
    live={r[1]:r for r in build(root=root)['tables']['審查與決策'][1:]}
    rows=snapshot['rows']
    for item in rows:
        row=item['values']
        if row[1] not in live or live[row[1]][4] != row[4]:
            raise ValueError('Stale review baseline: '+row[1])
    manifest=read('data/unified-editor-manifest.json')
    routes=[(r['file'].split('?')[0],read(r['file'].split('?')[0])) for r in manifest['routes']]
    before=time_signature([r for _,r in routes])
    all_nodes={n['id']:copy.deepcopy(n) for _,r in routes for n in r['nodes']}
    review=read('data/geometry/sources/owner-coordinate-overrides.json')
    by={n['nodeId']:n for n in review['nodes']}
    report={'sourceUrl':snapshot['sourceUrl'], 'snapshotSha256':hashlib.sha256((root/SNAPSHOT).read_bytes()).hexdigest(),
            'productionTerrainSha256':hashlib.sha256((root/'data/geometry/planner-terrain-v1.json').read_bytes()).hexdigest(),
            'date':'2026-11-11','ownerAmendments':amendments,'merges':[], 'renames':[],
            'coordinates':[], 'retainedDecisions':[], 'changedRoutes':[], 'timeSignatureBefore':before}
    original_runtime = {n['nodeId']:n for n in read('data/geometry/planner-terrain-v1.json')['nodes']}
    for old,target in MERGES.items():
        if old not in all_nodes or target not in all_nodes:raise ValueError('Unresolved explicit merge')
        report['merges'].append({'oldId':old,'canonicalId':target,'oldNode':all_nodes[old],
                                  'canonicalNode':all_nodes[target],
                                  'basis':'owner-explicit-sheet-and-chat-20261111',
                                  'previousRuntimeNode':original_runtime[old],
                                  'previousOverride':copy.deepcopy(by.get(old))})
        all_nodes[target]['aliases']=sorted(set(all_nodes[target].get('aliases',[])+
                                               all_nodes[old].get('aliases',[])+[all_nodes[old]['name']])-
                                           {all_nodes[target]['name']})
    for nid,name in RENAMES.items():
        n=all_nodes[nid]
        report['renames'].append({'nodeId':nid,'oldName':n['name'],'name':name})
        n['aliases']=sorted(set(n.get('aliases',[])+[n['name']])-{name})
        n['name']=name
    writes={}
    for path,route in routes:
        original=copy.deepcopy(route)
        transformed=[]
        for n in route['nodes']:
            target=MERGES.get(n['id'],n['id'])
            if n['id'] in MERGES or target in MERGES.values() or target in RENAMES:
                item=copy.deepcopy(all_nodes[target]);item['id']=target
                item['groups']=sorted(set(n.get('groups',[])+item.get('groups',[])))
                item['identityBasis']='owner-explicit-review-20261111' if n['id'] in MERGES else item.get('identityBasis','')
                transformed.append(item)
            else:transformed.append(n)
        if len({n['id'] for n in transformed}) != len(transformed):
            raise ValueError('Merge creates duplicate ID within route; requires explicit edge reconciliation')
        route['nodes']=transformed
        for e in route['segments']+route.get('manualConnections',[]):
            for side in ('from','to'):
                e[side+'Id']=MERGES.get(e[side+'Id'],e[side+'Id'])
                e[side]=all_nodes[e[side+'Id']]['name']
            if e['fromId']==e['toId']:raise ValueError('Merge would remove a directional edge')
        if route!=original:
            report['changedRoutes'].append({'file':path,'previousNodes':[n for n in original['nodes']
                if n['id'] in MERGES or n['id'] in RENAMES or n['id'] in MERGES.values()],
                'previousAffectedEdges':[e for e in original['segments']+original.get('manualConnections',[])
                if any(nid in MERGES or nid in RENAMES for nid in [e['fromId'],e['toId']])]})
            writes[path]=route;writes['preview/'+path]=route
    after=time_signature([r for _,r in routes])
    if after!=before:raise ValueError('Source directional time or metadata changed')
    report['timeSignatureAfter']=after
    # Refuse silently choosing between conflicting source times after an identity merge.
    edge_times={}
    for _,r in routes:
        for e in r['segments']:
            key=(e['fromId'],e['toId'])
            if key in edge_times and edge_times[key]!=e['minutes']:
                raise ValueError('Merged edge has conflicting source times')
            edge_times[key]=e['minutes']
    for item in rows:
        row=item['values']+['']*16
        nid,decision=row[1],row[8]
        if decision=='採用填入座標':
            x,y=float(row[9]),float(row[10])
            if nid=='node:cc65a12ba6bd7fa8e91b':x,y=275885,2590697
            coordinate=twd97_to_wgs84(x,y)
            if not (119<coordinate[0]<123 and 21<coordinate[1]<26):raise ValueError('Coordinate outside Taiwan')
            previous=copy.deepcopy(by.get(nid))
            target=by.get(nid)
            if target is None:
                target={'nodeId':nid};review['nodes'].append(target);by[nid]=target
            target.update(reviewId=row[0],name=all_nodes[nid]['name'],choice=decision,
                action='coordinate',coordinate=coordinate,originalCoordinate={'format':'TWD97','x':x,'y':y},
                source={'url':snapshot['sourceUrl'],'sheetId':105,'row':item['sheetRow'],
                        'snapshotSha256':report['snapshotSha256'],'verification':'user-supplied',
                        'supplementalSource':row[11],'ownerAmended':nid=='node:cc65a12ba6bd7fa8e91b'},
                note='使用者 2026-11-11 明確採用；'+str(row[11] or row[7] or ''),
                previousDecisions=[*(previous or {}).get('previousDecisions',[]),
                    {k:v for k,v in (previous or {}).items() if k!='previousDecisions'}] if previous else [])
            report['coordinates'].append({'nodeId':nid,'sheetRow':item['sheetRow'],'name':target['name'],
                'originalCoordinate':target['originalCoordinate'],'coordinate':coordinate,'previousOverride':previous})
        else:report['retainedDecisions'].append({'nodeId':nid,'sheetRow':item['sheetRow'],
                                                 'decision':decision,'instruction':row[7]})
    for nid,name in RENAMES.items():
        if nid in by:by[nid]['displayName']=name
    review['reviewDate']='2026-11-11'
    inventory_path='data/audits/main_step_chart_label_inventory_20261028.json'
    inventory=read(inventory_path)
    for chart,nid,name,row in [
        ('G02','shared:cw-v07-015','八通關山三岔路口',2),
        ('G05','node:43c9393ad0d04c1318ea','3.1K登山口',148),
        ('G15','node:1670c3f1247b747ba02a','下切溪床點',490),
        ('G16','node:ea1afe9db60667f52737','35K工寮岔路',582)]:
        c=next(c for c in inventory['charts'] if c['chartId']==chart)
        if not any(n['name']==name for n in c.get('ownerApprovedDisplayLabels',[])):
            c.setdefault('ownerApprovedDisplayLabels',[]).append({'nodeId':nid,'name':name,
                'confirmedBy':'owner','confirmedAt':'2026-11-11','sourceUrl':snapshot['sourceUrl'],
                'sheetRow':row,'basis':'使用者明確改名／合併決策；僅顯示名稱核准，不新增官方來源核實'})
    writes[inventory_path]=inventory
    writes['data/geometry/sources/owner-coordinate-overrides.json']=review
    writes[REPORT]=report
    return writes,report


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--apply',action='store_true')
    a=p.parse_args();writes,report=prepare()
    if a.apply:
        for path,value in writes.items():
            (ROOT/path).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'applied':a.apply,'coordinateDecisions':len(report['coordinates']),
                      'merges':len(report['merges']),'renames':len(report['renames']),
                      'directionalTimesPreserved':report['timeSignatureBefore']==report['timeSignatureAfter']},ensure_ascii=False))


if __name__=='__main__':main()
