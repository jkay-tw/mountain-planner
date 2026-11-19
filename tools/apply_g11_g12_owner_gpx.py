"""Apply the explicitly approved Nov 19 GPX reference to Preview only.

Shared G09/G11/G12 node pairs use one geometry. Recorded endpoint offsets are
retained; separate GPX segments are joined only when endpoints are identical.
"""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

from build_full_terrain import profile
from build_planner_geometry import ROOT
from build_xueshan_geometry import distance
from full_dem import Dem

SHA = '84b1b819bf6e15880148172ae7ff01bbd0fa029d34f2cc8e516947438e45fc2b'
START, MIDDLE, END = 'shared:cw-v07-045', 'shared:cw-v07-075', 'shared:cw-v07-038'
SOURCE = 'g11-g12-tunyuan-tianchi-owner-20261119'


def parse_components(path):
    if hashlib.sha256(path.read_bytes()).hexdigest() != SHA:
        raise ValueError('GPX differs from the approved file')
    root = ET.parse(path).getroot()
    segments = [[[float(p.attrib['lon']), float(p.attrib['lat'])]
                 for p in s.findall('{*}trkpt')]
                for s in root.findall('.//{*}trkseg')]
    if len(segments) != 16 or any(len(s) < 2 for s in segments):
        raise ValueError('Unexpected GPX segment structure')
    if any(not all(math.isfinite(v) for v in p) for s in segments for p in s):
        raise ValueError('Invalid source point')
    first = list(segments[0])
    for segment in segments[1:15]:
        if first[-1] != segment[0]:
            raise ValueError('Cannot join disconnected source segments')
        first.extend(segment[1:])
    return [first, segments[15]], segments


def apply(data, gpx, dem, approve_connectors=False):
    components, raw = parse_components(gpx)
    if dem.sha256 != data['terrainSource']['zipSha256']:
        raise ValueError('DEM archive differs from the pinned runtime source')
    result = copy.deepcopy(data)
    nodes = {n['nodeId']: n for n in data['nodes']}
    report = {'date': '2026-11-19', 'sourceFile': str(gpx.name),
              'sourceFileSha256': SHA, 'sourceRole': 'user-provided-planning-reference-not-field-verified',
              'affectedGroups': ['G09-19d020e9', 'G11', 'G12'],
              'sharedGeometry': True, 'sourceSegmentPointCounts': [len(s) for s in raw],
              'boundaryGapMeters': round(distance(components[0][-1], components[1][0]), 3),
              'noGapConnector': not approve_connectors, 'straightConnectorsApproved': approve_connectors,
              'connectorAuthorization': '使用者明確指定補畫雲海／天池與GPX間直線並視為可通行' if approve_connectors else None,
              'userConnectors': [], 'previousSpans': [], 'updatedSpans': []}
    pairs = [(START, MIDDLE, components[0], list(range(15))),
             (MIDDLE, END, components[1], [15])]
    for a, b, points, indices in pairs:
        matches = [s for s in result['spans'] if {s['fromId'], s['toId']} == {a, b}]
        if len(matches) != 1:
            raise ValueError('Expected exactly one shared source span')
        span = matches[0]
        report['previousSpans'].append(copy.deepcopy(span))
        points = copy.deepcopy(points)
        if approve_connectors:
            for node_id, endpoint, at_start in [(a, points[0], True), (b, points[-1], False)]:
                coordinate = nodes[node_id]['coordinate']
                meters = distance(coordinate, endpoint)
                if meters > 0:
                    report['userConnectors'].append({'nodeId': node_id, 'nodeCoordinate': coordinate,
                        'gpxEndpoint': endpoint, 'distanceMeters': round(meters, 3),
                        'source': 'owner-explicit-straight-connector-not-GPX-or-official-survey',
                        'fromId': a, 'toId': b, 'atStart': at_start, 'ownerPassable': True})
                    if at_start: points.insert(0, coordinate)
                    else: points.append(coordinate)
        coords = points if span['fromId'] == a else list(reversed(points))
        offsets = [distance(nodes[span['fromId']]['coordinate'], coords[0]),
                   distance(nodes[span['toId']]['coordinate'], coords[-1])]
        if max(offsets) > 120:
            raise ValueError('GPX endpoint is outside existing anchor tolerance')
        pr = profile(coords, dem)
        span.pop('sourceWayIds', None)
        span.update(coordinates=coords, profile=pr, distanceMeters=pr[-1][0],
                    fromAnchor=coords[0], toAnchor=coords[-1],
                    status='user-track-planning-reference', sourceName='使用者提供屯原—雲海—天池 GPX'+('＋使用者指定直線連接' if approve_connectors else '')+'（規劃參考）',
                    sourceUrl='https://jkay-tw.github.io/mountain-planner/data/geometry/sources/'+SOURCE+'.gpx',
                    sourceFileSha256=SHA, referenceSourceId=SOURCE,
                    sourceSegmentIndices=indices,
                    anchorOffsetsMeters=[round(x, 3) for x in offsets],
                    routingMethod='Approved source GPX with explicitly owner-approved straight label connectors, not measured GPX geometry' if approve_connectors else 'Approved source GPX; exact shared endpoints only; no label connectors or inter-component gap bridge',
                    sourceBoundaryGapMeters=report['boundaryGapMeters'])
        span['userStraightConnectors'] = [c for c in report['userConnectors'] if {c['fromId'], c['toId']} == {a, b}]
        report['updatedSpans'].append({'id': span['id'], 'fromId': span['fromId'],
                                     'toId': span['toId'], 'distanceMeters': span['distanceMeters'],
                                     'anchorOffsetsMeters': span['anchorOffsetsMeters']})
    for key, value in data['terrainSource']['tileSha256'].items():
        if key in dem.hashes and dem.hashes[key] != value:
            raise ValueError('DEM tile differs from pinned provenance')
    result['terrainSource']['tileSha256'].update(dem.hashes)
    result['ownerGpxReference'] = {k: v for k, v in report.items() if k not in ('previousSpans',)}
    note = ('屯原—雲海—天池採使用者GPX參考；雲海約18m、天池約10m端點間隔依使用者明確指示補直線並視為可通行；補線不是GPX實測或官方核實。' if approve_connectors else '屯原—雲海—天池採使用者GPX參考；雲海路點與後段行跡錨點相隔約18m，未補連接線；')+'G09/G11/G12共用此線形，上河時間及節點位置不變。'
    if note not in result['notes']:
        result['notes'].append(note)
    changed = {s["id"] for s in report["previousSpans"]}
    report["baselineInvariants"] = {k: hashlib.sha256(json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest() for k, v in {"nodes": data["nodes"], "spanDependencies": data["spanDependencies"], "unaffectedSpans": [s for s in data["spans"] if s["id"] not in changed]}.items()}
    report["baselineRouteSha256"] = {name: hashlib.sha256((ROOT/f"data/routes/owner-reviewed/{name}.json").read_bytes().replace(b"\r\n", b"\n")).hexdigest() for name in report["affectedGroups"]}
    return result, report


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--gpx', type=Path, required=True)
    p.add_argument('--dem', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--report', type=Path, required=True)
    p.add_argument('--approve-connectors', action='store_true', help='Only with explicit owner authorization')
    args = p.parse_args()
    if not args.output.resolve().is_relative_to((ROOT/'preview').resolve()):
        raise ValueError('This approved operation is Preview-only')
    data = json.loads(args.output.read_text(encoding='utf-8'))
    if data.get('ownerGpxReference', {}).get('sourceFileSha256') == SHA:
        previous = json.loads(args.report.read_text(encoding='utf-8'))
        if not args.approve_connectors or previous.get('straightConnectorsApproved'):
            raise ValueError('Already applied; do not overwrite the original history')
        originals = {s['id']: s for s in previous['previousSpans']}
        data['spans'] = [originals.get(s['id'], s) for s in data['spans']]
        data['notes'] = [n for n in data['notes'] if not n.startswith('屯原—雲海—天池採使用者GPX參考；')]
        data.pop('ownerGpxReference', None)
    result, report = apply(data, args.gpx, Dem(args.dem), args.approve_connectors)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8', newline='\n')
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(json.dumps(report['updatedSpans'], ensure_ascii=False))


if __name__ == '__main__':
    main()
