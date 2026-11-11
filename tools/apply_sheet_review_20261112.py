"""Apply the archived Nov 12 owner decisions; default is a read-only dry run."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
from import_coordinate_review import twd97_to_wgs84
from node_coordinate_review import ROOT, build, digest

SNAPSHOT='data/geometry/sources/sheet-review-20261112.json'
REPORT='data/geometry/sources/sheet-review-application-20261112.json'
RETIRED='node:413453c06804769a3470'
VEHICLE={'node:68ed9d0821e485e82f8f','node:bca4509332fbaaf5f94e'}


def prepare():
    read=lambda p:json.loads((ROOT/p).read_text(encoding='utf-8'))
    snapshot=read(SNAPSHOT)
    current={r[1]:r for r in build()['tables']['審查與決策'][1:]}
    rows={r[1]:r for r in snapshot['rows'][1:]}
    for item in snapshot['changedRows']:
        nid=item['nodeId']
        if current[nid][4]!=rows[nid][4]:raise ValueError('Stale baseline: '+nid)
    manifest=read('data/unified-editor-manifest.json')
    routes={e['file'].split('?')[0]:read(e['file'].split('?')[0]) for e in manifest['routes']}
    owner=read('data/geometry/sources/owner-coordinate-overrides.json')
    by={n['nodeId']:n for n in owner['nodes']}
    source_sha=hashlib.sha256((ROOT/SNAPSHOT).read_bytes().replace(b'\r\n',b'\n')).hexdigest()
    report={'date':'2026-11-12','sourceUrl':snapshot['sourceUrl'],'snapshotSha256':source_sha,
            'coordinates':[],'retirement':None,'vehicleCorrections':[],'merges':[],
            'confirmedDistinctPairs':17,'keptSourceGapHistory':read('data/geometry/sources/owner-coordinate-round2-terrain-20261111.json')['unrepresentedPairs'],
            'nodeAnnotations':[{'nodeId':'node:1bafd281610a4bf66a4b','text':'北鞍營地；北鞍三叉避難小屋',
                                'sourceInstruction':rows['node:1bafd281610a4bf66a4b'][7],
                                'presentation':'source record only; display preference not yet applied'}]}
    for item in snapshot['changedRows']:
        row=rows[item['nodeId']]
        if row[8]!='採用填入座標':continue
        if not any(c['column'] in ('I','J','K') for c in item['changes']):continue
        x,y=row[9:11]
        if not all(isinstance(v,(int,float)) and not isinstance(v,bool) for v in (x,y)):raise ValueError('Incomplete TWD97')
        coordinate=twd97_to_wgs84(x,y)
        if not(119<coordinate[0]<123 and 21<coordinate[1]<26):raise ValueError('Outside screening bounds')
        previous=copy.deepcopy(by.get(item['nodeId']))
        n=by.get(item['nodeId'])
        if n is None:n={'nodeId':item['nodeId']};owner['nodes'].append(n);by[n['nodeId']]=n
        n.update(reviewId=row[0],name=row[3],choice=row[8],action='coordinate',coordinate=coordinate,
                 originalCoordinate={'format':'TWD97','x':x,'y':y},
                 source={'url':snapshot['sourceUrl'],'sheetId':105,'row':item['row'],'snapshotSha256':source_sha,'verification':'user-supplied'},
                 note='使用者2026-11-12指定；'+str(row[7] or row[12] or ''),
                 previousDecisions=[*(previous or {}).get('previousDecisions',[]),
                    {k:v for k,v in (previous or {}).items() if k!='previousDecisions'}] if previous else [])
        report['coordinates'].append({'nodeId':n['nodeId'],'name':n['name'],'coordinate':coordinate,'twd97':[x,y],'previousOverride':previous})
    if rows[RETIRED][7]!='已不存在，刪除該節點':raise ValueError('Missing explicit retirement instruction')
    if not all('車行時間' in rows[nid][7] for nid in VEHICLE):raise ValueError('Missing explicit travel-mode correction')
    def signatures(routes):
        result=[]
        for path,route in routes.items():
            for kind in ('segments','manualConnections'):
                for edge in route.get(kind,[]):
                    if RETIRED in (edge['fromId'],edge['toId']):continue
                    item=copy.deepcopy(edge)
                    if {item['fromId'],item['toId']}==VEHICLE:
                        for key in ('travelMode','routingEnabled','ownerModeCorrection'):item.pop(key,None)
                    result.append([path,kind,item])
        return digest(result)
    report['directionalSignatureBefore']=signatures(routes)
    transport=read('data/transport-owner-reviewed.json')
    writes={}
    for path,r in routes.items():
        before=copy.deepcopy(r)
        node=next((n for n in r['nodes'] if n['id']==RETIRED),None)
        if node:
            removed=[e for e in r['segments'] if RETIRED in (e['fromId'],e['toId'])]
            neighbours={e['fromId'] if e['toId']==RETIRED else e['toId'] for e in removed}
            if len(neighbours)!=1:raise ValueError('Not a terminal branch; explicit reconnection review required')
            report['retirement']={'file':path,'node':node,'originalSegments':removed,
                                  'nodeIndex':r['nodes'].index(node),'segmentIndices':[r['segments'].index(e) for e in removed],
                                  'reason':rows[RETIRED][7],'previousOverride':copy.deepcopy(by.get(RETIRED))}
            r['nodes']=[n for n in r['nodes'] if n['id']!=RETIRED]
            r['segments']=[e for e in r['segments'] if RETIRED not in (e['fromId'],e['toId'])]
            if any(RETIRED in (e['fromId'],e['toId']) for e in r.get('manualConnections',[])):raise ValueError('Unexpected manual edge')
        for e in r['segments']:
            if {e['fromId'],e['toId']}==VEHICLE:
                original=copy.deepcopy(e)
                if original['minutes']!=20:raise ValueError('Unexpected directional time')
                e.update(travelMode='vehicle',routingEnabled=False,
                         ownerModeCorrection={'date':'2026-11-12','sourceUrl':snapshot['sourceUrl'],'basis':'使用者明確確認20分鐘為車行，不參與步行計算'})
                report['vehicleCorrections'].append({'file':path,'original':original,'current':copy.deepcopy(e)})
                if any((s['fromId'],s['toId'])==(e['fromId'],e['toId']) for s in transport['segments']):raise ValueError('Transport record already exists')
                transport['segments'].append(copy.deepcopy(e))
        if r!=before:
            writes[path]=r;writes['preview/'+path]=r
    if len(report['vehicleCorrections'])!=2 or report['retirement'] is None:raise ValueError('Explicit changes unresolved')
    report['directionalSignatureAfter']=signatures(routes)
    if report['directionalSignatureBefore']!=report['directionalSignatureAfter']:raise ValueError('Source minutes or metadata changed')
    retired=by[RETIRED]
    retired.update(action='delete',choice='使用者指定退休',note='2026-11-12使用者確認已不存在；原節點與兩方向35分鐘完整封存於'+REPORT)
    owner['reviewDate']='2026-11-12'
    writes['data/geometry/sources/owner-coordinate-overrides.json']=owner
    writes['data/transport-owner-reviewed.json']=transport
    writes['preview/data/transport-owner-reviewed.json']=transport
    writes[REPORT]=report
    return writes,report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--apply',action='store_true');a=p.parse_args()
    if (ROOT/REPORT).exists():raise ValueError('Already applied; do not duplicate history')
    writes,report=prepare()
    if a.apply:
        for path,data in writes.items():(ROOT/path).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({'apply':a.apply,'coordinates':len(report['coordinates']),'retired':report['retirement']['node']['name'],
                      'vehicleDirections':len(report['vehicleCorrections']),'merges':0},ensure_ascii=False))
