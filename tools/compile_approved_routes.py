#!/usr/bin/env python3
"""Compile source-reviewed directional hiking segments into a CLOSED preview graph.

The compiler deliberately does not publish. It requires an explicit reviewer
approval per direction, matching a reviewed staging edge and a current source
URL, and rejects conflicting physical identities and directed times.
"""
import argparse
import collections
import hashlib
import json
from pathlib import Path

def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))

def identity_index(crosswalk):
    physical={}
    denied=[]
    for row in crosswalk['canonicalNodes']:
        cid=row['canonicalId']
        for member in row['members']:
            key=(member['group'],member['name'])
            if key in physical:
                raise ValueError('Duplicate physical-node membership '+str(key))
            physical[key]='shared:'+cid
    for row in crosswalk.get('deniedPairRecords',[]):
        a=physical.get((row['groupA'],row['name']))
        b=physical.get((row['groupB'],row['name']))
        if a and a==b:
            raise ValueError('Crosswalk contradicts explicit exclusion: '+row['name'])
        denied.append(row)
    return physical

def compile_graph(staging_dir,crosswalk_file,approval_file,group_map_file):
    physical=identity_index(load(crosswalk_file))
    approval=load(approval_file)
    if approval.get('schemaVersion')!=1:raise ValueError('Unsupported approval format')
    groups=load(group_map_file)
    official={r['candidateGroup']:r['officialChartId'] for r in groups['mapping']}
    if len(official)!=len(groups['mapping']):raise ValueError('Duplicate group mapping')
    accepted={}
    for item in approval.get('approvedDirectedEdges',[]):
        key=(item['group'],item['from'],item['to'])
        if key in accepted:raise ValueError('Duplicate approved direction '+str(key))
        if item.get('travelMode')!='walking' or item.get('minutes',0)<=0:
            raise ValueError('Approval is not a valid walking edge')
        if not item.get('reviewedBy') or not item.get('reviewedAt') or not item.get('evidenceNote'):
            raise ValueError('Missing independently checked evidence')
        if item.get('publicationPermission') not in ('written_permission','independently_licensed'):
            raise ValueError('Unapproved distribution rights on '+str(key))
        if not item.get('sourceURL','').startswith('https://www.sunriver.com.tw/'):
            raise ValueError('Missing official source URL')
        if official.get(item['group']) is None:
            raise ValueError('Unmapped or supplemental candidate group '+item['group'])
        accepted[key]=item
    nodes={}
    edge_by_direction={}
    covered=set()
    stage_files=sorted(Path(staging_dir).glob('*.json'))
    for path in stage_files:
        data=load(path)
        group=data['route_name']
        if group not in official or not official[group]:
            continue
        for entry in data.get('segments',[]):
            key=(group,entry['from'],entry['to'])
            if key not in accepted:
                continue
            approved=accepted[key]
            if entry.get('verificationStatus')!='verified' or entry.get('travelMode')!='walking':
                raise ValueError('Staging edge not verified walking '+str(key))
            if approved['minutes'] != entry['minutes']:
                raise ValueError('Approval disagrees with staged time '+str(key))
            if approved['sourceURL'] != entry.get('source'):
                raise ValueError('Approval source disagrees with staging '+str(key))
            ends=[]
            for name in (entry['from'],entry['to']):
                node_id=physical.get((group,name)) or 'local:'+official[group]+'::'+hashlib.sha256((group+'\0'+name).encode()).hexdigest()[:20]
                old=nodes.get(node_id)
                if old and old['name']!=name:
                    raise ValueError('Canonical physical ID has incompatible names '+str((old['name'],name)))
                if old:
                    if group not in old['groups']:old['groups'].append(group)
                else:
                    nodes[node_id]=dict(id=node_id,name=name,groups=[group])
                ends.append(node_id)
            pair=tuple(ends)
            if pair[0]==pair[1]:raise ValueError('Self-loop after physical identity merge')
            alt=approved.get('timeAlternatives',[])
            if not isinstance(alt,list) or any(a.get('kind') not in ('slow','heavy_pack') or type(a.get('minutes')) not in (float,int) or a['minutes']<=0 for a in alt):
                raise ValueError('Invalid conditional alternatives')
            edge=dict(fromId=pair[0],toId=pair[1],**{'from':entry['from'],'to':entry['to']},
                minutes=entry['minutes'],travelMode='walking',
                verificationStatus='verified',source=entry['source'],
                sourceGroups=[group],timeAlternatives=alt,
                evidence=dict(reviewedBy=approved['reviewedBy'],reviewedAt=approved['reviewedAt'],
                              evidenceNote=approved['evidenceNote']))
            if pair in edge_by_direction:
                previous=edge_by_direction[pair]
                if previous['minutes']!=edge['minutes']:
                    raise ValueError('Conflicting cross-chart directed time '+str(pair))
                if previous['timeAlternatives']!=alt and alt:
                    raise ValueError('Conflicting conditional alternatives '+str(pair))
                previous['sourceGroups'].append(group)
            else:
                edge_by_direction[pair]=edge
            covered.add(key)
    missing=set(accepted)-covered
    if missing:raise ValueError('Approved segments missing from staged input '+str(sorted(missing)[:5]))
    graph=dict(route_id='AUDITED-PRIVATE-PREVIEW',
        route_name='來源核對路段（內部測試）',routingPolicy='verified-walking-only',
        publicationEligible=False,routeStatus='requires-separate-release-approval',
        nodes=sorted(nodes.values(),key=lambda n:n['id']),
        segments=sorted(edge_by_direction.values(),key=lambda e:(e['fromId'],e['toId'])))
    return graph,dict(approvedDirections=len(accepted),compiledDirections=len(graph['segments']),
                      nodes=len(graph['nodes']),publicationEligible=False,unmatchedApprovals=0)

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--staging',default='data/staging')
    p.add_argument('--crosswalk',default='data/crosswalk-reviewed.json')
    p.add_argument('--mapping',default='data/candidate_group_mapping.json')
    p.add_argument('--approvals',required=True)
    p.add_argument('--out',default='audit/private_preview_compiled')
    args=p.parse_args()
    graph,summary=compile_graph(args.staging,args.crosswalk,args.approvals,args.mapping)
    output=Path(args.out);output.mkdir(parents=True,exist_ok=True)
    (output/'preview_graph.json').write_text(json.dumps(graph,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (output/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
