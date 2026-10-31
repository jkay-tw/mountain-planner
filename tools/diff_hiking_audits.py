#!/usr/bin/env python3
"""Compare two normalized batch reports. Never edits/publishes route data."""
import argparse
import collections
import csv
import json
from pathlib import Path


def read_report(path):
    result = {}
    with Path(path).open(encoding='utf-8-sig', newline='') as fh:
        for row in csv.DictReader(fh):
            key = (row['group'], row['start'], row['end'])
            if key in result:
                raise ValueError('duplicate direction in report: ' + str(key))
            result[key] = row
    return result


def diff(old_csv, new_csv, out_json=None, out_csv=None):
    before = read_report(old_csv)
    after = read_report(new_csv)
    changes = []
    for key in sorted(set(before) | set(after)):
        left, right = before.get(key), after.get(key)
        if left is None:
            kind = 'added'
        elif right is None:
            kind = 'removed'
        elif left['minutes'] != right['minutes']:
            kind = 'minutes_changed'
        elif left['status'] != right['status']:
            kind = 'verification_status_changed'
        else:
            continue
        changes.append(dict(group=key[0],start=key[1],end=key[2],kind=kind,
            oldMinutes=left['minutes'] if left else '',
            newMinutes=right['minutes'] if right else '',
            oldStatus=left['status'] if left else '',
            newStatus=right['status'] if right else ''))
    counts=dict(sorted(collections.Counter(r['kind'] for r in changes).items()))
    summary=dict(schemaVersion=1,changeCount=len(changes),changeTypes=counts,
        publicationGate='review_every_minutes_changed_and_removed_edge_before_release',
        changes=changes)
    if out_json:
        path=Path(out_json);path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    if out_csv:
        path=Path(out_csv);path.parent.mkdir(parents=True,exist_ok=True)
        with path.open('w',encoding='utf-8-sig',newline='') as stream:
            fields=['group','start','end','kind','oldMinutes','newMinutes','oldStatus','newStatus']
            writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader();writer.writerows(changes)
    return summary


if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('previous_csv')
    p.add_argument('current_csv')
    p.add_argument('--json',default='audit/changes.json')
    p.add_argument('--csv',default='audit/changes.csv')
    a=p.parse_args()
    d=diff(a.previous_csv,a.current_csv,a.json,a.csv)
    print(json.dumps({k:v for k,v in d.items() if k!='changes'},ensure_ascii=False,indent=2))
