#!/usr/bin/env python3
"""Review-only cross-group candidate matcher. It never merges physical nodes."""
import argparse,collections,csv,itertools,json
from pathlib import Path

def build(input_file,out_dir):
    src=json.loads(Path(input_file).read_text(encoding='utf-8-sig'))
    neighbors=collections.defaultdict(lambda:collections.defaultdict(set))
    times=collections.defaultdict(set)
    for s in src['segments']:
        group,a,b=s['group'],s['from'],s['to']
        neighbors[a][group].add(b);neighbors[b][group].add(a)
        times[(group,a,b)].add(s['go'])
        times[(group,b,a)].add(s['back'])
    blocked_names={'三岔路口','四岔路口','水源','最低鞍部','岔路','岔路口',
                   '林道登山口','登山口','三叉營地','主北岔路','東北鞍營地'}
    rows=[]
    for name,groups in neighbors.items():
        if len(groups)<2:continue
        for ga,gb in itertools.combinations(sorted(groups),2):
            na,nb=groups[ga],groups[gb];shared=na&nb
            matches=conflicts=0
            for n in shared:
                for a,b in ((name,n),(n,name)):
                    ta,tb=times.get((ga,a,b),set()),times.get((gb,a,b),set())
                    if ta and tb:
                        if ta&tb:matches+=1
                        else:conflicts+=1
            if name in blocked_names:
                status='do_not_merge'
            elif len(shared)>=2 and matches>=2:
                status='high_priority_review'
            elif shared:status='review'
            else:status='unresolved'
            rows.append(dict(name=name,group_a=ga,group_b=gb,
                neighbor_a=' / '.join(sorted(na)),neighbor_b=' / '.join(sorted(nb)),
                shared_neighbors=' / '.join(sorted(shared)),shared_count=len(shared),
                matching_directed_times=matches,conflicting_directed_times=conflicts,
                status=status,user_decision='',user_note='',canonical_node_id='',reviewed_by='',evidence_url=''))
    priority={'do_not_merge':0,'high_priority_review':1,'review':2,'unresolved':3}
    rows.sort(key=lambda r:(priority[r['status']],-r['matching_directed_times'],-r['shared_count'],r['name']))
    out=Path(out_dir);out.mkdir(parents=True,exist_ok=True)
    with (out/'cross_group_node_review.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    counts=collections.Counter(r['status'] for r in rows)
    report=dict(segments=len(src['segments']),cross_group_names=sum(len(g)>1 for g in neighbors.values()),
                candidate_pairs=len(rows),status_counts=dict(counts),confirmed_merges=0)
    (out/'summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('input_json');p.add_argument('--out',default='audit/crosswalk')
    args=p.parse_args()
    print(json.dumps(build(args.input_json,args.out),ensure_ascii=False,indent=2))
