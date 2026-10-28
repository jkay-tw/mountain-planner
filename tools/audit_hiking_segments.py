#!/usr/bin/env python3
"""Offline, read-only quality scan of candidate hiking-segments JSON."""
import argparse
import collections
import csv
import json
from pathlib import Path


def write_csv(path, columns, rows):
    with path.open('w', encoding='utf-8-sig', newline='') as file:
        writer = csv.writer(file)
        writer.writerow(columns)
        writer.writerows(rows)


def audit(source, output):
    data = json.loads(Path(source).read_text(encoding='utf-8-sig'))
    if not isinstance(data, dict) or not isinstance(data.get('segments'), list):
        raise ValueError('Expected a hiking-segments object with segments[]')
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    memberships = collections.defaultdict(set)
    groups = collections.defaultdict(list)
    edges = collections.defaultdict(list)
    issues = []
    for number, item in enumerate(data['segments'], start=1):
        if not isinstance(item, dict):
            issues.append((number, 'invalid row'))
            continue
        group, start, end = (item.get(k) for k in ('group', 'from', 'to'))
        if any(not isinstance(v, str) or not v.strip() for v in (group, start, end)):
            issues.append((number, 'invalid group/from/to'))
            continue
        go, back = item.get('go'), item.get('back')
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or v <= 0 for v in (go, back)):
            issues.append((number, 'invalid go/back minutes'))
            continue
        if start == end:
            issues.append((number, 'self-loop'))
        memberships[start].add(group)
        memberships[end].add(group)
        groups[group].append((start, end))
        edges[(group, start, end)].append((number, go, back))
    shared = sorted(((n, len(gs), ' / '.join(sorted(gs))) for n, gs in memberships.items()
                     if len(gs) > 1), key=lambda r: (-r[1], r[0]))
    repeats = []
    conflicts = []
    for (group, start, end), records in sorted(edges.items()):
        if len(records) < 2:
            continue
        details = '; '.join(f'{i}:{go}/{back}' for i, go, back in records)
        repeats.append((group, start, end, len(records), details))
        if len({(go, back) for _, go, back in records}) > 1:
            conflicts.append((group, start, end, len(records), details))
    connectivity = []
    for group, segments in sorted(groups.items()):
        graph = collections.defaultdict(set)
        for start, end in segments:
            graph[start].add(end)
            graph[end].add(start)
        unseen = set(graph)
        sizes = []
        while unseen:
            stack = [unseen.pop()]
            size = 0
            while stack:
                size += 1
                for node in graph[stack.pop()] & unseen:
                    unseen.remove(node)
                    stack.append(node)
            sizes.append(size)
        connectivity.append((group, len(graph), len(sizes), '/'.join(map(str, sorted(sizes, reverse=True)))))
    write_csv(output / 'cross_group_names.csv', ['name', 'groups', 'group_names'], shared)
    write_csv(output / 'repeated_segments.csv', ['group', 'from', 'to', 'records', 'row:go/back'], repeats)
    write_csv(output / 'conflicting_segments.csv', ['group', 'from', 'to', 'records', 'row:go/back'], conflicts)
    write_csv(output / 'structural_issues.csv', ['row', 'issue'], issues)
    write_csv(output / 'group_connectivity.csv', ['group', 'nodes', 'components', 'sizes'], connectivity)
    summary = {'segments': len(data['segments']), 'groups': len(groups), 'cross_group_names': len(shared),
               'repeated_segments': len(repeats), 'conflicting_segments': len(conflicts),
               'structural_issues': len(issues),
               'disconnected_groups': sum(row[2] > 1 for row in connectivity)}
    (output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('input')
    parser.add_argument('--out', default='audit')
    args = parser.parse_args()
    print(json.dumps(audit(args.input, args.out), ensure_ascii=False, indent=2))
