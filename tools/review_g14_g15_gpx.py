"""Build discussion-only GPX candidates. Never applies points or merges identities."""
import argparse
import hashlib
import itertools
import json
import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from node_coordinate_review import ROOT, twd97
from audit_node_coordinates import distance

# Explicit label hypotheses for discussion, not accepted physical identities.
ALIASES = {
 'G14': {
  '2863公尺峰':['2863峰'], '2780草原黑水塘':['2870草原水池'],
  '2897公尺峰':['2960峰'], '六順山':['六順山基石'],
  '台電高登連絡站':['台電招待所'], '林道入口':['丹大林道入口'],
  '林道舊登山口':['登山口'], '孫海橋':['孫安橋'],
 },
 'G15': {
  '東鑾/烏達佩岔路':['烏達佩山岔路'], '45.3K登山口':['45.3K 無雙山登山口'],
  '烏瓦拉鼻溪':['烏瓦拉鼻溪營地','屋瓦拉鼻西營地'],
  '東鞍營地':['崖邊營地','東鞍崖邊營地'], '最高峰':['無雙山最高峰','無雙最高峰'],
  '東北鞍營地':['北鞍營地','東郡北鞍營地'],
  '19.3K水泥橋':['19K 水泥橋'], '28K水泥工寮':['28K 工寮','28K工寮'],
  '32K水泥工寮':['32K 彈藥庫工寮','32K彈藥庫'], '34K登山口':['瑞隆林道34K'],
  '郡東營地':['郡東山西鞍營地','營地岔路'],
  '無雙部落址':['無雙社','無雙部落舊址'],
  '無雙山東峰':['無雙東峰'], '無雙山基點峰':['無雙山'],
  '14.6K水泥路止':['瑞穗林道14.6K行車終點','14.5K 瑞穗林道'],
  '天南可蘭/望崖岔路':['天南可蘭山岔路'],
 }
}


def normal(name):
    return re.sub(r'[\s｜/／·（）()\-_]', '',name).lower().replace('公尺','')


def ingest(paths):
    files=[];tracks={}
    for path in paths:
        raw=path.read_bytes()
        if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
            raise ValueError('GPX entity declarations are not accepted')
        root=ET.fromstring(raw)
        def label(e):return next((c.text or '' for c in e if c.tag.split('}')[-1]=='name'),'')
        waypoints=[];segments=[]
        for i,e in enumerate(x for x in root.iter() if x.tag.split('}')[-1]=='wpt'):
            c=[float(e.get('lon')),float(e.get('lat'))]
            if not all(math.isfinite(v) for v in c) or not (119<c[0]<123 and 21<c[1]<26):raise ValueError('Invalid Taiwan waypoint')
            waypoints.append({'index':i,'name':label(e),'coordinate':c})
        for e in (x for x in root.iter() if x.tag.split('}')[-1]=='trkseg'):
            points=[[float(x.get('lon')),float(x.get('lat'))] for x in e if x.tag.split('}')[-1]=='trkpt']
            segments.append(points)
        record={'file':path.name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
                'waypoints':waypoints,'trackPointCount':sum(map(len,segments)),
                'trackSegmentCount':len(segments),'links':[e.get('href') for e in root.iter()
                    if e.tag.split('}')[-1]=='link' and e.get('href')],
                'verification':'user-supplied; source independence not verified; no walking times inferred'}
        files.append(record);tracks[path.name]=segments
    return files,tracks


def nearest_track(coordinate,segments):
    best=(float('inf'),None,None)
    for i,segment in enumerate(segments):
        for j,c in enumerate(segment):
            d=distance(coordinate,c)
            if d<best[0]:best=(d,i,j)
    return {'distanceMeters':round(best[0],1),'segment':best[1],'pointIndex':best[2]} if best[1] is not None else None


def generate(paths,runtime_path,root=ROOT):
    files,tracks=ingest(paths)
    manifest=json.loads((root/'data/unified-editor-manifest.json').read_text(encoding='utf-8'))
    runtime=json.loads(runtime_path.read_text(encoding='utf-8'))
    runtime_nodes={n['nodeId']:n for n in runtime['nodes']}
    review=json.loads((root/'data/geometry/sources/owner-coordinate-overrides.json').read_text(encoding='utf-8'))
    owner={n['nodeId']:n for n in review['nodes']}
    nodes={};adj={}
    for entry in manifest['routes']:
        if entry['id'] not in ('G14','G15'):continue
        route=json.loads((root/entry['file'].split('?')[0]).read_text(encoding='utf-8'))
        for n in route['nodes']:
            target=nodes.setdefault(n['id'],{'name':n['name'],'groups':[],'aliases':set(n.get('aliases',[]))})
            target['groups'].append(entry['name']);target['aliases'].update(n.get('aliases',[]))
            adj.setdefault(n['id'],set())
        by={n['id']:n['name'] for n in route['nodes']}
        for e in route['segments']:
            adj[e['fromId']].add(by[e['toId']]);adj[e['toId']].add(by[e['fromId']])
    results=[];used=set()
    for nid,n in nodes.items():
        current=runtime_nodes.get(nid,{})
        manual=owner.get(nid,{})
        manual_coordinate=manual.get('coordinate') if manual.get('action')=='coordinate' else None
        coordinate=manual_coordinate or current.get('coordinate')
        labels={normal(n['name']),*[normal(a) for a in n['aliases']]}
        extra=set()
        for group in n['groups']:
            extra.update(normal(a) for a in ALIASES[group.split('｜')[0]].get(n['name'],[]))
        candidates=[]
        for f in files:
            occurrences={}
            for w in f['waypoints']:
                label=normal(w['name'])
                if label not in labels and label not in extra:continue
                key=(w['name'],tuple(w['coordinate']))
                occurrences.setdefault(key,[]).append(w['index'])
                used.add((f['file'],w['index']))
            for (name,c),indices in occurrences.items():
                i=indices[0];waypoints=f['waypoints']
                before=waypoints[i-1]['name'] if i else ''
                after=waypoints[i+1]['name'] if i+1<len(waypoints) else ''
                candidates.append({'file':f['file'],'fileSha256':f['sha256'],'waypointName':name,
                    'waypointIndices':indices,'coordinate':list(c),'twd97':twd97(c),
                    'matchBasis':'原名／既有別名吻合；仍是待確認候選' if normal(name) in labels else '明列異名／標示角色假說；需人工確認',
                    'previousWaypoint':before,'nextWaypoint':after,
                    'distanceFromCurrentMeters':round(distance(coordinate,c),1) if coordinate else None,
                    'nearestTrackSample':nearest_track(c,tracks[f['file']])})
        spread=max((distance(a['coordinate'],b['coordinate']) for a,b in itertools.combinations(candidates,2)),default=0)
        maximum_shift=max((c['distanceFromCurrentMeters'] for c in candidates
                           if c['distanceFromCurrentMeters'] is not None),default=None)
        if manual_coordinate:status='手填優先；GPX僅備註'
        elif current.get('coordinatePolicy') in ('ignored','vehicle-only'):status='依政策不定位；候選保留討論'
        elif not candidates:status='四檔未找到具名對應；不猜點'
        elif maximum_shift is not None and maximum_shift>1000:status='GPX距現值>1km；需優先核對'
        elif any(c['matchBasis'].startswith('明列') for c in candidates):status='異名／角色候選待確認'
        elif spread>200:status='GPX差異較大；需逐來源討論'
        else:status='具名候選待確認；尚未套用'
        note='\n'.join(f'{c["file"]}｜{c["waypointName"]}｜TWD97 {c["twd97"][0]}/{c["twd97"][1]}｜'+
                       (f'距目前值 {c["distanceFromCurrentMeters"]:.1f}m｜' if c['distanceFromCurrentMeters'] is not None else '目前未定位｜')+
                       '航點 '+','.join(str(i+1) for i in c['waypointIndices']) for c in candidates)
        results.append({'nodeId':nid,'name':n['name'],'groups':n['groups'],'coordinate':coordinate,
                        'currentTwd97':twd97(coordinate),'manualCoordinate':manual_coordinate,
                        'manualTwd97':twd97(manual_coordinate),'status':status,'candidates':candidates,
                        'candidateSpreadMeters':round(spread,1),'maximumShiftFromCurrentMeters':maximum_shift,
                        'neighbours':sorted(adj[nid]),'gpxNote':note})
    unmatched=[{'file':f['file'],'sha256':f['sha256'],**w} for f in files for w in f['waypoints'] if (f['file'],w['index']) not in used]
    return {'schemaVersion':1,'date':'2026-11-11','runtime':str(runtime_path.relative_to(root)) if runtime_path.is_relative_to(root) else str(runtime_path),
            'files':files,'nodes':results,'unmatchedWaypoints':unmatched,
            'policy':'Manual coordinates prevail. All GPX matches are discussion candidates, not accepted identities; no track time or straight-line geometry is imported.'}


def tables(report):
    summary=[['群組','節點名','討論狀態','目前 TWD97 X','目前 TWD97 Y','手填 X','手填 Y',
              'GPX座標備註（原檔值）','檔內／跨檔候選最大差m','專案相鄰節點','決策入口','Node ID']]
    detail=[['群組','節點名','來源GPX','GPX航點名','GPX TWD97 X','GPX TWD97 Y','距目前值m',
             '配對依據／限制','GPX前航點','GPX後航點','GPX航點序號（1起算）','最近軌跡採樣距離m','檔案SHA-256','Node ID']]
    for n in sorted(report['nodes'],key=lambda n:('；'.join(n['groups']),n['name'],n['nodeId'])):
        summary.append(['；'.join(n['groups']),n['name'],n['status'],*n['currentTwd97'],*n['manualTwd97'],
                        n['gpxNote'] or '無具名候選；不從軌跡任意取點',n['candidateSpreadMeters'],
                        '／'.join(n['neighbours']),'',n['nodeId']])
        for c in n['candidates']:
            detail.append(['；'.join(n['groups']),n['name'],c['file'],c['waypointName'],*c['twd97'],
                c['distanceFromCurrentMeters'],c['matchBasis'],c['previousWaypoint'],c['nextWaypoint'],
                ','.join(str(i+1) for i in c['waypointIndices']),
                (c.get('nearestTrackSample') or {}).get('distanceMeters'),c['fileSha256'],n['nodeId']])
    sources=[['來源GPX','SHA-256','大小bytes','具名航點數','軌跡點數','軌跡分段數','來源界線']]
    for f in report['files']:
        sources.append([f['file'],f['sha256'],f['bytes'],len(f['waypoints']),f['trackPointCount'],f['trackSegmentCount'],
                        '使用者提供；未獨立核實；同檔重複／不同檔不算獨立交叉證明；不採用時間'])
    unmatched=[['來源GPX','航點名','TWD97 X','TWD97 Y','檔內序號','說明']]
    for w in report['unmatchedWaypoints']:
        unmatched.append([w['file'],w['name'],*twd97(w['coordinate']),w['index']+1,'未與現行G14/G15節點建立對應，不自動新增節點'])
    return {'G14-G15座標討論':summary,'GPX候選明細':detail,'GPX來源檔案':sources,'GPX未對應航點':unmatched}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('gpx',nargs=4,type=Path)
    p.add_argument('--runtime',type=Path,default=ROOT/'preview/data/geometry/planner-terrain-v1.json')
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();report=generate(a.gpx,a.runtime)
    a.output.mkdir(parents=True,exist_ok=True)
    (a.output/'gpx-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    t=tables(report)
    (a.output/'gpx-tables.json').write_text(json.dumps(t,ensure_ascii=False),encoding='utf-8')
    print(json.dumps({'nodes':len(report['nodes']),'withCandidates':sum(bool(n['candidates']) for n in report['nodes']),
                      'manualPriority':sum(bool(n['manualCoordinate']) for n in report['nodes']),
                      'candidateRecords':sum(len(n['candidates']) for n in report['nodes']),
                      'unmatchedWaypointOccurrences':len(report['unmatchedWaypoints'])},ensure_ascii=False))


if __name__=='__main__':main()
