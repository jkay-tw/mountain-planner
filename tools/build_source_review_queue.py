#!/usr/bin/env python3
"""Generate an official-source evidence work queue from PRIVATE normalized candidate data.

Does not download copyrighted charts or publish candidate route values.
"""
import argparse
import collections
import csv
import json
from pathlib import Path

FIELDS=['priority','chartId','chartGroup','from','to','candidateMinutes',
        'reverseCandidateMinutes','candidateGroup','sourceIndexURL',
        'sourceChartURL','sourceVerified','reviewedBy','reviewedAt',
        'evidenceNote','travelMode','publicationPermission','issueTags']

def build(candidate,mapping,output):
    raw=json.loads(Path(candidate).read_text(encoding='utf-8-sig'))
    conf=json.loads(Path(mapping).read_text(encoding='utf-8-sig'))
    source='https://www.sunriver.com.tw/step2020.htm'
    known={x['candidateGroup']:x for x in conf['mapping']}
    corrections=collections.defaultdict(set)
    for row in raw['segments']:
        group=row['group']
        if group not in known:raise ValueError('Unknown candidate group '+group)
        corrections[(group,row['from'],row['to'])].add(row['go'])
        corrections[(group,row['to'],row['from'])].add(row['back'])
    grouped=collections.defaultdict(list)
    for (group,start,end),times in sorted(corrections.items()):
        chart=known[group]['officialChartId']
        reverse=corrections.get((group,end,start),set())
        issues=[]
        if len(times)>1:issues.append('same_direction_conflict')
        if not reverse:issues.append('reverse_missing')
        if chart is None:issues.append('supplemental_group_unmapped')
        if start in ('登山口','三岔路口','四岔路口','水源','最低鞍部') or end in ('登山口','三岔路口','四岔路口','水源','最低鞍部'):
            issues.append('generic_node_needs_identity_review')
        priority='P0' if 'same_direction_conflict' in issues else 'P1' if issues else 'P2'
        record=dict(priority=priority,chartId=chart or '',chartGroup=group,**{'from':start,'to':end},
            candidateMinutes=' / '.join(map(str,sorted(times))),
            reverseCandidateMinutes=' / '.join(map(str,sorted(reverse))),
            candidateGroup=group,sourceIndexURL=source,sourceChartURL='',
            sourceVerified='pending',reviewedBy='',reviewedAt='',evidenceNote='',
            travelMode='needs_review',publicationPermission='pending',
            issueTags=' / '.join(issues))
        grouped[(chart or 'SUPPLEMENTAL',group)].append(record)
    folder=Path(output);folder.mkdir(parents=True,exist_ok=True)
    counts=collections.Counter()
    all_rows=[]
    for (chart,group),items in sorted(grouped.items()):
        counts[chart]+=len(items)
        all_rows.extend(items)
    with (folder/'source_review_queue.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=FIELDS);writer.writeheader()
        writer.writerows(sorted(all_rows,key=lambda x:(x['priority'],x['chartId'],x['candidateGroup'],x['from'],x['to'])))
    summary=dict(schemaVersion=1,status='candidate_source_review_pending',
        totalDirectedRows=len(all_rows),byOfficialChart=dict(sorted(counts.items())),
        sourceVerified=0,publicationEligible=False,
        reviewInstructions='Chart location and each directional time must be independently checked; blank source evidence and permission are NOT approvals.')
    (folder/'source_review_summary.json').write_text(
        json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return summary

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('private_normalized_json')
    p.add_argument('--mapping',default='data/candidate_group_mapping.json')
    p.add_argument('--out',default='audit/private_source_review')
    args=p.parse_args()
    print(json.dumps(build(args.private_normalized_json,args.mapping,args.out),ensure_ascii=False,indent=2))
