#!/usr/bin/env python3
"""Compare directional overlaps of two user-supplied candidate route groups.
This is a consistency check, NOT proof the values match official maps.
"""
import argparse,csv,json,collections
from pathlib import Path

def directional(rows,group):
    values=collections.defaultdict(set)
    for x in rows:
        if x.get('group')!=group:continue
        a,b=x.get('from'),x.get('to')
        for k,v in [((a,b),x.get('go')),((b,a),x.get('back'))]:
            if isinstance(v,(int,float)) and not isinstance(v,bool) and v>=0:
                values[k].add(v)
    return values

def compare(file,group_a,group_b,out):
    data=json.loads(Path(file).read_text(encoding='utf-8-sig'))
    if not isinstance(data,dict) or not isinstance(data.get('segments'),list):
        raise ValueError('Expected segments array')
    a=directional(data['segments'],group_a)
    b=directional(data['segments'],group_b)
    results=[]
    for start,end in sorted(a.keys()&b.keys()):
        va,vb=sorted(a[(start,end)]),sorted(b[(start,end)])
        results.append({'from':start,'to':end,'group_a':group_a,'group_a_minutes':'/'.join(map(str,va)),
                        'group_b':group_b,'group_b_minutes':'/'.join(map(str,vb)),
                        'status':'match' if set(va)&set(vb) else 'conflict',
                        'official_chart_verified':'no','review_note':''})
    path=Path(out);path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('w',encoding='utf-8-sig',newline='') as handle:
        writer=csv.DictWriter(handle,fieldnames=['from','to','group_a','group_a_minutes','group_b',
                           'group_b_minutes','status','official_chart_verified','review_note'])
        writer.writeheader();writer.writerows(results)
    return {'shared_directed_edges':len(results),
            'matching':sum(x['status']=='match' for x in results),
            'conflicting':sum(x['status']=='conflict' for x in results),
            'note':'Shared candidate values do not constitute source verification'}

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('input_json');parser.add_argument('group_a');parser.add_argument('group_b')
    parser.add_argument('--out',default='audit/overlap_comparison.csv')
    args=parser.parse_args()
    print(json.dumps(compare(args.input_json,args.group_a,args.group_b,args.out),
                     ensure_ascii=False,indent=2))
