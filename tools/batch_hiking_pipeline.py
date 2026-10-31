#!/usr/bin/env python3
"""Fail-closed batch validation of user-provided hiking route candidates.

Never auto-promotes candidate agreement to official verification, never
writes to data/routes or the public manifest. Reports are deterministic.
"""
import argparse
import collections
import csv
import hashlib
import json
import math
from pathlib import Path


def write_json(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(content, ensure_ascii=False, sort_keys=True, indent=2) + '\n', encoding='utf-8')


def write_csv(path, fields, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(rows)


def valid_minutes(value):
    return type(value) in (int, float) and math.isfinite(value) and value > 0


def crosswalk_map(path):
    if not path:
        return {}, {'clusters': 0, 'denied': 0}
    data = json.loads(Path(path).read_text(encoding='utf-8-sig'))
    mapping = {}
    clusters = set()
    for cluster in data.get('canonicalNodes', []):
        ident = cluster['canonicalId']
        if ident in clusters:
            raise ValueError('Repeated canonical node ID ' + ident)
        clusters.add(ident)
        for member in cluster['members']:
            key = (member['group'], member['name'])
            if key in mapping:
                raise ValueError('Contradictory canonical node mapping: ' + str(key))
            mapping[key] = ident
    for excluded in data.get('deniedPairRecords', []):
        a = mapping.get((excluded['groupA'], excluded['name']))
        b = mapping.get((excluded['groupB'], excluded['name']))
        if a is not None and a == b:
            raise ValueError('Confirmed exclusion conflicts with approved identity: ' + str(excluded))
    return mapping, {'clusters': len(clusters), 'denied': len(data.get('deniedPairRecords', []))}


def reference_edges(folder):
    reference = collections.defaultdict(set)
    if not folder:
        return reference
    for file in sorted(Path(folder).glob('*.json')):
        src = json.loads(file.read_text(encoding='utf-8-sig'))
        for seg in src.get('segments', []):
            if seg.get('travelMode') == 'walking' and seg.get('verificationStatus') == 'verified':
                if not valid_minutes(seg.get('minutes')):
                    raise ValueError('Invalid staging time: ' + str(file))
                reference[(src['route_name'], seg['from'], seg['to'])].add(seg['minutes'])
    return reference


def read_approval(path):
    if not path:
        return {}
    obj = json.loads(Path(path).read_text(encoding='utf-8-sig'))
    if obj.get('schemaVersion') != 1:
        raise ValueError('Unsupported approval ledger')
    records = {}
    for entry in obj.get('approvedDirectedEdges', []):
        key = (entry.get('group'), entry.get('from'), entry.get('to'))
        if any(not isinstance(v, str) or not v.strip() for v in key):
            raise ValueError('Invalid approval identity')
        if not valid_minutes(entry.get('minutes')) or entry.get('travelMode') != 'walking':
            raise ValueError('Invalid approval minutes or travel mode')
        for field in ('sourceURL', 'reviewedBy', 'reviewedAt', 'evidenceNote'):
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                raise ValueError('Approval is missing ' + field)
        if not entry['sourceURL'].startswith('https://www.sunriver.com.tw/'):
            raise ValueError('Official source evidence required')
        if key in records:
            raise ValueError('Duplicate approval')
        records[key] = entry
    return records


def audit(input_json, out_dir, crosswalk=None, staging=None, approvals=None):
    raw = Path(input_json).read_bytes()
    document = json.loads(raw.decode('utf-8-sig'))
    if not isinstance(document, dict) or not isinstance(document.get('segments'), list):
        raise ValueError('Input must have segments[]')
    out = Path(out_dir)
    items = document['segments']
    memberships, membership_stats = crosswalk_map(crosswalk)
    staged = reference_edges(staging)
    approved = read_approval(approvals)
    directed = collections.defaultdict(list)
    structural = []
    groups = collections.Counter()

    for index, row in enumerate(items, 1):
        if not isinstance(row, dict):
            structural.append(dict(row=index, kind='invalid_row', detail='not an object'))
            continue
        names = [row.get(k) for k in ('group', 'from', 'to')]
        if any(not isinstance(x, str) or not x.strip() for x in names):
            structural.append(dict(row=index, kind='invalid_identity', detail=str(names)))
            continue
        group, start, end = names
        if start == end or any(x != x.strip() for x in names):
            structural.append(dict(row=index, kind='invalid_node_or_whitespace', detail=str(names)))
            continue
        if not valid_minutes(row.get('go')) or not valid_minutes(row.get('back')):
            structural.append(dict(row=index, kind='invalid_minutes', detail=str(names)))
            continue
        groups[group] += 1
        directed[(group, start, end)].append((row['go'], index))
        directed[(group, end, start)].append((row['back'], index))

    duplicates, rows = [], []
    for key in sorted(directed):
        observations = directed[key]
        vals = set(x[0] for x in observations)
        if len(observations) > 1:
            duplicates.append(dict(group=key[0], start=key[1], end=key[2],
                occurrences=len(observations), values=' / '.join(map(str, sorted(vals))),
                sourceRows=' / '.join(str(index) for _, index in observations),
                conflict=len(vals)>1))
        minute = next(iter(vals)) if len(vals)==1 else None
        stage = staged.get(key, set())
        signature = approved.get(key)
        if signature and (minute is None or signature['minutes'] != minute):
            structural.append(dict(row=observations[0][1], kind='approval_mismatch', detail=str(key)))
        if minute is None:
            status='candidate_conflict'
        elif len(stage)>1:
            status='staging_conflict'
        elif stage and minute not in stage:
            status='staging_mismatch'
        elif signature:
            status='approved_source_verified'
        elif stage:
            status='staging_match_not_independently_approved'
        else:
            status='candidate_unverified'
        rows.append(dict(group=key[0], start=key[1], end=key[2],
            minutes=minute if minute is not None else '',
            sourceRows=' / '.join(str(i) for _, i in observations),
            status=status, stagedMinutes=' / '.join(map(str,sorted(stage)))))

    # Compare only if BOTH endpoints have the same user-reviewed canonical ID
    # in both groups. Identical strings alone are not sufficient evidence.
    by_labels = collections.defaultdict(dict)
    for row in rows:
        if row['minutes'] != '':
            by_labels[(row['start'], row['end'])][row['group']] = row['minutes']
    overlap = []
    for (start, end), group_minutes in sorted(by_labels.items()):
        group_names = sorted(group_minutes)
        for i, ga in enumerate(group_names):
            for gb in group_names[i+1:]:
                aid=memberships.get((ga,start))
                bid=memberships.get((ga,end))
                if not aid or not bid:
                    continue
                if aid != memberships.get((gb,start)) or bid != memberships.get((gb,end)):
                    continue
                overlap.append(dict(groupA=ga, groupB=gb, start=start, end=end,
                    minutesA=group_minutes[ga], minutesB=group_minutes[gb],
                    status='match' if group_minutes[ga] == group_minutes[gb] else 'conflict'))

    # Candidate-only normalized import: local provisional IDs, non-routable.
    imports = collections.defaultdict(list)
    for row in rows:
        if row['minutes'] == '':
            continue
        group = row['group']
        node_id = lambda n: 'candidate:' + hashlib.sha256((group+'\0'+n).encode()).hexdigest()[:16]
        imports[group].append(dict(fromId=node_id(row['start']), toId=node_id(row['end']),
            fromName=row['start'], toName=row['end'], minutes=row['minutes'],
            travelMode='unknown', verificationStatus='candidate_unverified',
            importEligible=False))
    for group in sorted(imports):
        file_id=hashlib.sha256(group.encode()).hexdigest()[:12]
        write_json(out/'candidate_groups'/('group_'+file_id+'.json'),
            dict(group=group, routingEnabled=False, publicationEligible=False,
                 identityBasis='group-local provisional', segments=imports[group]))

    counts=collections.Counter(r['status'] for r in rows)
    report=dict(schemaVersion=1, status='candidate_consistency_only',
        sourceSHA256=hashlib.sha256(raw).hexdigest(), candidateRows=len(items),
        validRows=sum(groups.values()), groups=len(groups),
        groupCounts=dict(sorted(groups.items())), directedKeys=len(rows),
        duplicatedDirectedKeys=len(duplicates),
        conflictingDirectedKeys=sum(r['status']=='candidate_conflict' for r in rows),
        structuralIssues=len(structural),
        crossGroupChecked=len(overlap),
        crossGroupConflicts=sum(r['status']=='conflict' for r in overlap),
        confirmedIdentityReview=membership_stats,
        validationClasses=dict(counts),
        approvedEdges=sum(r['status']=='approved_source_verified' for r in rows),
        published=False,
        warning='Same-time comparisons and staged records are not independent official chart proof.')
    write_json(out/'summary.json',report)
    write_csv(out/'directed_candidates.csv',
        ['group','start','end','minutes','sourceRows','status','stagedMinutes'],rows)
    write_csv(out/'duplicate_directed.csv',
        ['group','start','end','occurrences','values','sourceRows','conflict'],duplicates)
    write_csv(out/'crossgroup_confirmed_nodes.csv',
        ['groupA','groupB','start','end','minutesA','minutesB','status'],overlap)
    write_csv(out/'structural_issues.csv',['row','kind','detail'],structural)
    write_json(out/'approval_template.json',dict(schemaVersion=1,
        approvedDirectedEdges=[],note='Require independent chart evidence and reviewer per direction.'))
    write_json(out/'manifest.json',dict(sourceSHA256=report['sourceSHA256'],
        generated='candidate_audit_only', changedProductionManifest=False,
        groups=sorted(groups), reviewRequired=True))
    return report


if __name__=='__main__':
    cli=argparse.ArgumentParser()
    cli.add_argument('input_json')
    cli.add_argument('--out',default='audit/batch')
    cli.add_argument('--crosswalk')
    cli.add_argument('--staging')
    cli.add_argument('--approvals')
    args=cli.parse_args()
    print(json.dumps(audit(args.input_json,args.out,args.crosswalk,args.staging,args.approvals),
                     ensure_ascii=False,indent=2))
