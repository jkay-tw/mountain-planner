#!/usr/bin/env python3
"""Inspect a GPX recording and extract a continuous, time-free track.

Coordinates are observations, not official trail geometry. This does not infer
walking routes or join track segments. Never auto-publish third-party tracks.
"""
import argparse
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

NS = 'http://www.topografix.com/GPX/1/1'
TAG = '{%s}' % NS
ET.register_namespace('', NS)


def distance(a, b):
    r = 6371000
    lat1, lat2 = math.radians(a['lat']), math.radians(b['lat'])
    dlat = lat2 - lat1
    dlon = math.radians(b['lon'] - a['lon'])
    h = math.sin(dlat / 2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2)**2
    return 2 * r * math.asin(min(1, math.sqrt(h)))


def parse_gpx(path):
    root = ET.parse(path).getroot()
    if root.tag != TAG + 'gpx':
        raise ValueError('Expected GPX 1.1')
    segments = []
    for seg in root.findall('.//' + TAG + 'trkseg'):
        points = []
        for point in seg.findall(TAG + 'trkpt'):
            lat, lon = float(point.attrib['lat']), float(point.attrib['lon'])
            if not math.isfinite(lat) or not math.isfinite(lon) or abs(lat) > 90 or abs(lon) > 180:
                raise ValueError('Invalid coordinate')
            ele = point.findtext(TAG + 'ele')
            altitude = float(ele) if ele is not None else None
            if altitude is not None and not math.isfinite(altitude):
                raise ValueError('Invalid elevation')
            points.append({'lat': lat, 'lon': lon, 'ele': altitude})
        if points:
            segments.append(points)
    if not segments:
        raise ValueError('GPX contains no recorded track points')
    return segments


def summarize(points):
    gaps = [distance(a, b) for a, b in zip(points, points[1:])]
    return {'points': len(points), 'distance_m': round(sum(gaps)),
            'maximum_gap_m': round(max(gaps, default=0), 1),
            'gaps_over_100m': sum(g > 100 for g in gaps)}


def nearest(points, lat, lon, count=5):
    target = {'lat': lat, 'lon': lon}
    return sorted(({'index': i, 'distance_m': round(distance(p, target), 1)}
                   for i, p in enumerate(points)), key=lambda x: x['distance_m'])[:count]


def export_gpx(points, output, label):
    if len(points) < 2:
        raise ValueError('At least two track points required')
    root = ET.Element(TAG + 'gpx', {'version': '1.1', 'creator': 'Mountain Planner GPX pilot'})
    trk = ET.SubElement(root, TAG + 'trk')
    ET.SubElement(trk, TAG + 'name').text = label
    seg = ET.SubElement(trk, TAG + 'trkseg')
    for p in points:
        item = ET.SubElement(seg, TAG + 'trkpt', {'lat': str(p['lat']), 'lon': str(p['lon'])})
        if p['ele'] is not None:
            ET.SubElement(item, TAG + 'ele').text = str(p['ele'])
    ET.ElementTree(root).write(output, encoding='utf-8', xml_declaration=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--segment', type=int, default=0, help='0-based recorded segment; never bridges segments')
    parser.add_argument('--nearest', nargs=2, type=float, metavar=('LAT', 'LON'))
    parser.add_argument('--start', type=int, default=0)
    parser.add_argument('--end', type=int, help='inclusive point index; defaults to final point')
    parser.add_argument('--output', type=Path, help='export selected continuous points without timestamps')
    parser.add_argument('--name', default='GPX 記錄摘錄')
    args = parser.parse_args()
    segments = parse_gpx(args.input)
    if args.segment < 0 or args.segment >= len(segments):
        parser.error('segment out of range')
    points = segments[args.segment]
    end = len(points) - 1 if args.end is None else args.end
    if not 0 <= args.start < end < len(points):
        parser.error('start/end must specify at least two points in ascending recorded order')
    chosen = points[args.start:end + 1]
    report = {'segments_in_source': len(segments), 'selected_segment': args.segment,
              'start_index': args.start, 'end_index': end, **summarize(chosen)}
    if args.nearest:
        report['nearest_source_points'] = nearest(points, *args.nearest)
    if args.output:
        export_gpx(chosen, args.output, args.name)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
