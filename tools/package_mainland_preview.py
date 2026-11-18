"""Package the isolated mainland trial; never changes reviewed production data.

All original OSM coordinates, IDs, tags and complete ways remain available.
Junction membership is computed globally before subdividing source tiles.
"""
import argparse, collections, gzip, hashlib, json, math
from pathlib import Path

def load(path):
    return json.loads(gzip.decompress(path.read_bytes()))

def package(source, output):
    manifest = json.loads((source/'manifest.json').read_text(encoding='utf-8'))
    counts, junctions, blocked = collections.Counter(), set(), set()
    for tile in manifest['tiles']:
        data=load(source/tile['file']); blocked.update(data['blockedNodeIds'])
        for way in data['ways']:
            refs=way['refs']; counts.update(refs); junctions.update((refs[0], refs[-1]))
    junctions.update(i for i,count in counts.items() if count>1)
    output.mkdir(parents=True,exist_ok=True); result=[]
    # Refine each existing tile independently. This bounds each build step and
    # retains entire ways crossing cell borders, using actual bounds in index.
    for tile in manifest['tiles']:
        data=load(source/tile['file']); groups=collections.defaultdict(list)
        for way in data['ways']:
            point=data['nodes'][str(way['refs'][len(way['refs'])//2])]
            groups[(math.floor(point[0]*20),math.floor(point[1]*20))].append(way)
            for index,node in enumerate(way['refs']):
                if node in blocked:
                    junctions.update(way['refs'][max(0,index-1):index+2])
        for (x,y),ways in sorted(groups.items()):
            ids={i for way in ways for i in way['refs']}; nodes={str(i):data['nodes'][str(i)] for i in sorted(ids)}
            bounds=[min(p[0] for p in nodes.values()), min(p[1] for p in nodes.values()),max(p[0] for p in nodes.values()),max(p[1] for p in nodes.values())]
            content={'schemaVersion':2,'nodes':nodes,'ways':ways,'blockedNodeIds':sorted(ids&blocked),'junctionIds':sorted(ids&junctions)}
            raw=json.dumps(content,ensure_ascii=False,separators=(',',':')).encode(); packed=gzip.compress(raw,mtime=0)
            name=f'{x}_{y}.json.gz'; (output/name).write_bytes(packed)
            result.append({'file':name,**({'manualOnly':True} if name=='2430_500.json.gz' else {}),'bounds':bounds,'cellBounds':[x/20,y/20,(x+1)/20,(y+1)/20],'bytes':len(packed),'jsonBytes':len(raw),'nodes':len(nodes),'junctions':len(content['junctionIds']),'ways':len(ways),'sha256':hashlib.sha256(packed).hexdigest()})
    version=hashlib.sha256(json.dumps(result,sort_keys=True).encode()).hexdigest()[:16]
    index={'schemaVersion':2,'version':version,'status':'trial-not-production','source':{**manifest['source'],'snapshotUrl':'https://download.geofabrik.de/asia/taiwan-261112.osm.pbf'},'sourceManifestSha256':hashlib.sha256((source/'manifest.json').read_bytes()).hexdigest(),'sourceWays':manifest['ways'],'sourceTiles':len(manifest['tiles']),'excluded':manifest['excluded'],'boundary':manifest['boundary'],'filter':manifest['filter'],'cellDegrees':.05,'tiles':result,'note':'Complete ways and globally counted exact-ID junctions; actual way bounds drive loading. OSM records do not establish passability or Shanghe time.'}
    (output/'manifest.json').write_text(json.dumps(index,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'tiles':len(result),'bytes':sum(t['bytes'] for t in result),'largest':max(result,key=lambda t:t['bytes']),'version':version}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('source',type=Path);parser.add_argument('output',type=Path);args=parser.parse_args();package(args.source,args.output)
