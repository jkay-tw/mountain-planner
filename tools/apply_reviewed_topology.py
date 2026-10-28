#!/usr/bin/env python3
"""Apply exact, group-scoped owner topology decisions to PRIVATE candidates only."""
import argparse
import copy
import json
from pathlib import Path

KEYS=('group','from','to','go','back')
def key(row):return tuple(row.get(k) for k in KEYS)
def apply_review(raw,ledger):
    if ledger.get('schemaVersion')!=1 or not ledger.get('reviewId'):
        raise ValueError('Unsupported topology review ledger')
    if not isinstance(raw.get('segments'),list):raise ValueError('Missing segments')
    if raw.get('topologyReviewId')==ledger['reviewId']:
        return copy.deepcopy(raw),{'alreadyApplied':True,'inputRows':len(raw['segments']),'outputRows':len(raw['segments'])}
    decisions={}
    for d in ledger['entries']:
        k=key(d['match'])
        if k in decisions or d.get('confirmedBy')!='owner':raise ValueError('Duplicate or unconfirmed topology decision')
        if d['action'] not in ('confirm','replace','exclude'):raise ValueError('Invalid topology action')
        decisions[k]=d
    present={key(r) for r in raw['segments']}
    missing=set(decisions)-present
    if missing:raise ValueError('Reviewed records absent or changed: '+str(sorted(missing)))
    result=[];changes=[]
    for i,row in enumerate(raw['segments'],1):
        d=decisions.get(key(row));r=copy.deepcopy(row)
        if d:
            changes.append({'inputRow':i,'action':d['action'],'before':copy.deepcopy(row),
                            'reason':d['reason']})
            if d['action']=='exclude':continue
            if d['action']=='replace':r.update(d['replace'])
            if d.get('travelMode'):r['travelMode']=d['travelMode']
            r.update(reviewStatus='owner_confirmed_candidate',routingEnabled=False,
                     reviewId=ledger['reviewId'])
            changes[-1]['after']=copy.deepcopy(r)
        result.append(r)
    out={**copy.deepcopy(raw),'segments':result,'topologyReviewId':ledger['reviewId'],
         'routingEnabled':False,'publicationEligible':False}
    return out,{'inputRows':len(raw['segments']),'outputRows':len(result),
                'excludedRows':len(raw['segments'])-len(result),'decisions':changes,'publicationAllowed':False}

def process(candidate,review,out):
    raw=json.loads(Path(candidate).read_text(encoding='utf-8-sig'))
    ledger=json.loads(Path(review).read_text(encoding='utf-8-sig'))
    data,report=apply_review(raw,ledger);folder=Path(out);folder.mkdir(parents=True,exist_ok=True)
    (folder/'topology_reviewed_candidates.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    (folder/'topology_review_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    return report
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('input');p.add_argument('--review',required=True);p.add_argument('--out',required=True)
    a=p.parse_args();print(json.dumps(process(a.input,a.review,a.out),ensure_ascii=False,indent=2))
