#!/usr/bin/env python3
"""Apply explicit user-reviewed corrections to *candidate* records, never publish.

Input records are directional pairs (group, from, to, go, back). They may
contain duplicate rows. Output candidate records with review provenance,
plus a per-direction audit table, keeping conditional slow/heavy values separate.
"""
import argparse
import collections
import csv
import json
from pathlib import Path

def load_ledger(file):
    data=json.loads(Path(file).read_text(encoding='utf-8-sig'))
    if data.get('schemaVersion')!=1 or not isinstance(data.get('entries'),list):
        raise ValueError('Unsupported manual review ledger')
    directions={}
    for rec in data['entries']:
        for direction,start,end,minutes in [('forward',rec['from'],rec['to'],rec['go']),
                                            ('reverse',rec['to'],rec['from'],rec['back'])]:
            key=(rec['group'],start,end)
            if type(minutes) not in (int,float) or not 0<minutes<=10080:
                raise ValueError('Invalid reviewed walking time: '+str(key))
            if key in directions:
                raise ValueError('Duplicate reviewed direction: '+str(key))
            alternate=rec.get('alternates',{}).get(direction)
            if alternate and (alternate.get('kind') not in ('slow','heavy_pack')
                              or type(alternate.get('minutes')) not in (int,float)
                              or alternate['minutes']<=0):
                raise ValueError('Invalid conditional time: '+str(key))
            directions[key]=dict(minutes=minutes,alternate=alternate,reviewStatus=rec.get('reviewStatus'),
                                 sourceReviewStatus=rec.get('sourceReviewStatus'),
                                 officialChartMapping=rec.get('officialChartMapping'))
    return directions

def apply(candidate_file,review_file,out_dir):
    src=json.loads(Path(candidate_file).read_text(encoding='utf-8-sig'))
    if not isinstance(src.get('segments'),list):raise ValueError('Missing candidate segments')
    reviews=load_ledger(review_file)
    values=collections.defaultdict(set)
    for record in src['segments']:
        values[(record['group'],record['from'],record['to'])].add(record['go'])
        values[(record['group'],record['to'],record['from'])].add(record['back'])
    matched={k for k in reviews if k in values}
    unmatched=set(reviews)-matched
    # A missing direction is a blocker, never invent an edge.
    if unmatched:
        raise ValueError('Reviewed directions absent from candidate source: '+str(sorted(unmatched)))
    updated=[]
    for record in src['segments']:
        line=dict(record)
        group,start,end=record['group'],record['from'],record['to']
        f=reviews.get((group,start,end));r=reviews.get((group,end,start))
        if f:line['go']=f['minutes']
        if r:line['back']=r['minutes']
        if f or r:
            line['reviewStatus']='user_confirmed_candidate_only'
            line['sourceVerification']='pending'
            line['routingEnabled']=False
        updated.append(line)
    summary=dict(sourceRows=len(src['segments']),reviewedDirectedKeys=len(reviews),
                 reviewedPairs=len(reviews)//2,changedValues=sum(
                     a.get(t)!=b.get(t) for a,b in zip(src['segments'],updated) for t in ('go','back')),
                 unresolvedReviewKeys=len(unmatched),published=False)
    folder=Path(out_dir);folder.mkdir(parents=True,exist_ok=True)
    (folder/'reviewed_candidates.json').write_text(
        json.dumps({**src,'segments':updated,'publicationEligible':False},ensure_ascii=False,indent=2)+'\n',
        encoding='utf-8')
    fields=['group','from','to','originalValues','reviewedMinutes','alternateKind','alternateMinutes',
            'sourceReviewStatus','officialChartMapping']
    with (folder/'reviewed_directed.csv').open('w',encoding='utf-8-sig',newline='') as file:
        writer=csv.DictWriter(file,fieldnames=fields);writer.writeheader()
        for (group,start,end),review in sorted(reviews.items()):
            alt=review['alternate'] or {}
            writer.writerow(dict(group=group,**{'from':start,'to':end},
                originalValues=' / '.join(map(str,sorted(values[(group,start,end)]))),
                reviewedMinutes=review['minutes'],alternateKind=alt.get('kind',''),
                alternateMinutes=alt.get('minutes',''),
                sourceReviewStatus=review['sourceReviewStatus'],
                officialChartMapping=review['officialChartMapping']))
    (folder/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return summary

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('candidate_file');p.add_argument('review_ledger')
    p.add_argument('--out',default='audit/reviewed')
    a=p.parse_args()
    print(json.dumps(apply(a.candidate_file,a.review_ledger,a.out),ensure_ascii=False,indent=2))
