"""Recover and verify the pinned v0.9.0 terrain build inputs (not runtime data)."""
import argparse
import gzip
import hashlib
import json
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PBF_CANDIDATES = [
    'https://download.geofabrik.de/asia/taiwan-261101.osm.pbf',
    'https://download.geofabrik.de/asia/taiwan-261103.osm.pbf',
]
# The earlier trial of taiwan-261102.osm.pbf finished downloading but did
# not match the pinned SHA. It must not be treated as the original extract.
DEM_URL = 'https://rudymap.tw/v1/hgtmix.zip'
EXPECTED_PBF = '72e6ec59e0b015aa52fd26b0240dc4155beca04a3071b0d07878eef6f02ba2b6'
EXPECTED_DEM = '5965dab6fd19ca1b1ecb077b0219fe4e932b599dd985fa96266d383e166594a0'


def sha(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def recover(folder):
    folder.mkdir(parents=True, exist_ok=True)
    # Probe *historical* archives for the exact byte-for-byte source used by
    # v0.9.0. Different PBF snapshots are not interchangeable with its SHA.
    pbf_path, pbf_url = None, None
    for url in PBF_CANDIDATES:
        name = url.rsplit('/', 1)[-1]
        target = folder / name
        if not target.exists():
            subprocess.run(['curl', '-fL', '--retry', '3', '--connect-timeout', '30',
                            '--max-time', '1200', '-o', str(target), url], check=True)
        actual = sha(target)
        print(f'Source candidate {name}: sha256={actual}, pinned-match={actual == EXPECTED_PBF}', flush=True)
        if actual == EXPECTED_PBF:
            pbf_path, pbf_url = target, url
            break
        target.unlink()
    if pbf_path is None:
        raise ValueError('No historical Geofabrik PBF matches pinned v0.9.0 SHA; stop without publishing')
    dem_path = folder / 'hgtmix.zip'
    if not dem_path.exists():
        subprocess.run(['curl', '-fL', '--retry', '3', '--connect-timeout', '30',
                        '--max-time', '1200', '-o', str(dem_path), DEM_URL], check=True)
    if sha(dem_path) != EXPECTED_DEM:
        raise ValueError('hgtmix.zip: upstream content differs from pinned v0.9.0 source')
    network = folder / 'walking-network-roads.json.gz'
    temporary = folder / 'network-temporary.json.gz'
    subprocess.run([sys.executable, str(ROOT / 'tools/extract_walking_network.py'),
                    str(pbf_path), str(temporary)], check=True)
    # Existing extractor output is retained verbatim; only make gzip reproducible.
    with gzip.open(temporary, 'rb') as source, network.open('wb') as output:
        with gzip.GzipFile(filename='', mode='wb', fileobj=output, mtime=0) as compressed:
            shutil.copyfileobj(source, compressed)
    temporary.unlink()
    with gzip.open(network, 'rt') as source:
        raw = json.load(source)
    if raw['source']['sha256'] != EXPECTED_PBF:
        raise ValueError('Extracted network provenance mismatch')
    manifest = {
        'schemaVersion': 1, 'id': 'terrain-sources-20261106',
        'description': 'Recovered v0.9.0 upstream inputs; network regenerated with repository extractor.',
        'pbf': {'url': pbf_url, 'sha256': EXPECTED_PBF},
        'assets': [
            {'name': network.name, 'sha256': sha(network), 'bytes': network.stat().st_size,
             'source': raw['source'], 'nodes': len(raw['nodes']), 'ways': len(raw['ways'])},
            {'name': 'hgtmix.zip', 'sha256': EXPECTED_DEM, 'bytes': (folder / 'hgtmix.zip').stat().st_size,
             'url': DEM_URL, 'creditUrl': 'https://rudymap.tw/taiwan_topo.html'},
        ],
    }
    (folder / 'terrain-sources-manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    shutil.copyfile(ROOT / 'docs/TERRAIN_SOURCE_NOTICES.md', folder / 'TERRAIN_SOURCE_NOTICES.md')
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    recover(parser.parse_args().directory.resolve())
