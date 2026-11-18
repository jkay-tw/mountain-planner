"""Isolated mainland trial. Derive the boundary from closed OSM coastline rings.

Never overwrites reviewed routes, Node IDs, times or production terrain.
Requires osmium; raw PBF and generated trial files belong outside Git.
"""
import argparse, collections, gzip, hashlib, json, math, time
from pathlib import Path
from extract_walking_network import ALLOWED, eligible

CORE = {'path', 'track', 'footway', 'steps', 'pedestrian'}

def inside(p, ring):
    x, y = p; result = False
    for a, b in zip(ring, ring[1:]):
        if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:
            result = not result
    return result

def coastline_rings(lines, coords):
    ends = collections.defaultdict(list)
    for i, line in enumerate(lines):
        ends[line[0]].append(i); ends[line[-1]].append(i)
    unused = set(range(len(lines))); rings = []; open_count = 0
    while unused:
        i = unused.pop(); chain = list(lines[i])
        while chain[-1] != chain[0]:
            choices = [i for i in ends[chain[-1]] if i in unused]
            if len(choices) != 1: break
            i = choices[0]; unused.remove(i); line = lines[i]
            if line[-1] == chain[-1]: line = list(reversed(line))
            chain.extend(line[1:])
        if chain[-1] == chain[0] and all(i in coords for i in chain):
            rings.append([coords[i] for i in chain])
        else: open_count += 1
    if not rings: raise ValueError('No closed coastline: do not invent a mainland boundary')
    area = lambda r: abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(r,r[1:]))/2)
    ring = max(rings, key=area)
    if area(ring) < 1: raise ValueError('Largest closed coastline is too small; review boundary')
    return ring, {'closedRings':len(rings), 'openChains':open_count, 'areaDegrees2':area(ring)}

def build(pbf, output):
    import osmium
    import shapely
    from shapely.geometry import Polygon
    started = time.perf_counter(); ways = []; coast = []; needed = set(); core_nodes = set(); blocked = set(); coords = {}
    class Ways(osmium.SimpleHandler):
        def way(self,w):
            if w.tags.get('natural') == 'coastline':
                refs=[n.ref for n in w.nodes];coast.append(refs);needed.update(refs)
            if w.tags.get('highway') not in ALLOWED: return
            tags=dict(w.tags)
            if not eligible(tags) or len(w.nodes)<2: return
            refs=[n.ref for n in w.nodes];needed.update(refs)
            ways.append({'id':w.id,'version':w.version,'timestamp':str(w.timestamp),'refs':refs,'tags':tags})
            if tags['highway'] in CORE: core_nodes.update(refs)
    Ways().apply_file(str(pbf));print('ways scanned',len(ways),'required nodes',len(needed),flush=True)
    class Nodes(osmium.SimpleHandler):
        def node(self,n):
            if n.id not in needed or not n.location.valid(): return
            coords[n.id]=[n.location.lon,n.location.lat]
            t=dict(n.tags)
            if t.get('access') in ('no','private') or t.get('foot') in ('no','private') or t.get('barrier') in ('wall','fence','block'):blocked.add(n.id)
    Nodes().apply_file(str(pbf));print('nodes loaded',len(coords),flush=True)
    ring,boundary_stats=coastline_rings(coast,coords)
    polygon=Polygon(ring)
    if not polygon.is_valid: raise ValueError('OSM coastline polygon is invalid; manual boundary review required')
    shapely.prepare(polygon)
    # Use coarse cells to reject distant/island nodes before point-in-ring tests.
    bounds=[min(p[0] for p in ring),min(p[1] for p in ring),max(p[0] for p in ring),max(p[1] for p in ring)]
    kept=[];excluded=collections.Counter();membership={}
    def mainland(i):
        if i not in membership:
            p=coords.get(i)
            membership[i]=bool(p and bounds[0]<=p[0]<=bounds[2] and bounds[1]<=p[1]<=bounds[3] and shapely.intersects_xy(polygon,p[0],p[1]))
        return membership[i]
    for w in ways:
        refs=w['refs'];is_core=w['tags']['highway'] in CORE
        if not is_core and not any(i in core_nodes for i in refs):excluded['unconnected-road']+=1;continue
        if not all(i in coords for i in refs):excluded['missing-coordinate']+=1;continue
        # Keep complete ways, not guessed clipped boundary connectors.
        if not all(mainland(i) for i in refs):excluded['outside-or-crosses-mainland-boundary']+=1;continue
        kept.append(w)
    output.mkdir(parents=True,exist_ok=True);tiles=collections.defaultdict(list)
    for w in kept:
        p=coords[w['refs'][len(w['refs'])//2]];key=f'{math.floor(p[0]*4)}_{math.floor(p[1]*4)}';tiles[key].append(w)
    manifest=[]
    for key,rows in sorted(tiles.items()):
        ids={i for w in rows for i in w['refs']}
        data={'nodes':{str(i):coords[i] for i in sorted(ids)},'ways':rows,'blockedNodeIds':sorted(ids&blocked)}
        raw=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode();compressed=gzip.compress(raw,mtime=0)
        name=key+'.json.gz';(output/name).write_bytes(compressed)
        manifest.append({'file':name,'bytes':len(compressed),'jsonBytes':len(raw),'nodes':len(ids),'ways':len(rows),'sha256':hashlib.sha256(compressed).hexdigest()})
    reader=osmium.io.Reader(str(pbf));timestamp=reader.header().get('osmosis_replication_timestamp');reader.close()
    result={'schemaVersion':1,'status':'trial-not-production','source':{'url':'https://download.geofabrik.de/asia/taiwan-latest.osm.pbf','timestamp':timestamp,'sha256':hashlib.file_digest(pbf.open('rb'),'sha256').hexdigest(),'license':'ODbL-1.0'},'boundary':{'method':'largest closed OSM coastline ring; complete ways only',**boundary_stats,'bounds':bounds},'filter':{'coreHighways':sorted(CORE),'connectors':'permitted road ways sharing at least one exact OSM node with core ways; one hop only'},'excluded':dict(excluded),'ways':len(kept),'tiles':manifest,'elapsedSeconds':round(time.perf_counter()-started,2)}
    (output/'manifest.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({'ways':len(kept),'tiles':len(tiles),'compressedBytes':sum(x['bytes'] for x in manifest),'elapsedSeconds':result['elapsedSeconds']}),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('pbf',type=Path);p.add_argument('output',type=Path);a=p.parse_args();build(a.pbf,a.output)
