#!/usr/bin/env python3
"""Controlled group mapping and alias normalization of candidate input.

Never edits the original JSON or publishes routes. Unknown groups fail closed.
"""
import argparse
import collections
import json
from pathlib import Path


def normalize(raw, mapping):
    if not isinstance(raw, dict) or not isinstance(raw.get('segments'), list):
        raise ValueError('Candidate input requires segments[]')
    if mapping.get('schemaVersion') != 1:
        raise ValueError('Unsupported group mapping')
    groups = {}
    for row in mapping['mapping']:
        name = row['candidateGroup']
        if name in groups:
            raise ValueError('Repeated group mapping: ' + name)
        groups[name] = row
    rename_map = {}
    for row in mapping['renames']:
        key = (row['group'], row['from'])
        if key in rename_map or row['from'] == row['to']:
            raise ValueError('Duplicate or invalid rename: ' + str(key))
        if row['group'] not in groups or not (row.get('userConfirmed') is True or row.get('sourceVerified') is True):
            raise ValueError('Unconfirmed display alias: ' + str(key))
        rename_map[key] = row['to']
    exclusions={}
    for row in mapping.get('excludedCandidateSegments',[]):
        key=(row.get('group'),row.get('from'),row.get('to'),row.get('go'),row.get('back'))
        if any(v is None for v in key) or row.get('sourceVerified') is not True:
            raise ValueError('Unsafe candidate exclusion: '+str(key))
        if key in exclusions:raise ValueError('Duplicate candidate exclusion: '+str(key))
        exclusions[key]=row
    changed = []
    excluded = []
    counts = collections.Counter()
    segments = []
    for number, row in enumerate(raw['segments'], 1):
        group = row['group']
        exact=(group,row.get('from'),row.get('to'),row.get('go'),row.get('back'))
        if exact in exclusions:
            excluded.append(dict(row=number,**exclusions[exact]))
            continue
        if group not in groups:
            raise ValueError('Unmapped candidate group '+group)
        counts[group] += 1
        copy = dict(row)
        for field in ('from', 'to'):
            key = (group, copy[field])
            if key in rename_map:
                original = copy[field]
                copy[field] = rename_map[key]
                changed.append(dict(row=number, group=group, field=field,
                                    previous=original, current=copy[field]))
        segments.append(copy)
    missing = sorted(set(groups) - set(counts))
    if missing:
        raise ValueError('Mapping includes groups missing from candidate input: '+str(missing))
    return {**raw, 'segments':segments, 'routingEnabled':False}, dict(
        inputSegments=len(segments), candidateGroups=len(counts),
        mappedOfficialCharts=sorted(set(row['officialChartId'] for row in groups.values() if row['officialChartId'])),
        unmappedSupplementalGroups=sorted(row['candidateGroup'] for row in groups.values() if not row['officialChartId']),
        displayRenames=changed, excludedCandidateSegments=excluded, publicationEligible=False)


def process(input_file, map_file, output_dir):
    raw=json.loads(Path(input_file).read_text(encoding='utf-8-sig'))
    mapping=json.loads(Path(map_file).read_text(encoding='utf-8-sig'))
    candidate, report=normalize(raw,mapping)
    out=Path(output_dir);out.mkdir(parents=True,exist_ok=True)
    (out/'normalized_candidate.json').write_text(json.dumps(candidate,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (out/'mapping_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('input');p.add_argument('--mapping',required=True);p.add_argument('--out',default='audit/mapping')
    args=p.parse_args()
    print(json.dumps(process(args.input,args.mapping,args.out),ensure_ascii=False,indent=2))
