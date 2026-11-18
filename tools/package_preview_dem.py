"""Split unchanged 1-arcsecond HGT samples into demand-loaded 0.05 degree grids.

Output is a renamed derivative; source, archive hash and notices are retained.
Cells cover the mainland network envelope, not offshore islands.
"""
import argparse,gzip,hashlib,json,math,struct,zipfile
from pathlib import Path

def package(archive,network,coastline,output):
    import numpy as np
    import shapely
    from shapely.geometry import Polygon,box
    coast=json.loads(coastline.read_text(encoding='utf-8'));polygon=Polygon(coast['coordinates'][0]);shapely.prepare(polygon)
    if not polygon.is_valid:raise ValueError('Invalid mainland coastline; do not invent a mask')
    index=json.loads(network.read_text(encoding='utf-8'));output.mkdir(parents=True,exist_ok=True)
    source_hash=hashlib.file_digest(archive.open('rb'),'sha256').hexdigest();result=[]
    # Use source mainland boundary bounds, not the offshore HGT archive extent.
    west,south,east,north=index['boundary']['bounds'];grids={}
    with zipfile.ZipFile(archive) as source:
        for y in range(math.floor(south*20),math.floor(north*20)+1):
            for x in range(math.floor(west*20),math.floor(east*20)+1):
                lon,lat=x/20,y/20;name=f'N{math.floor(lat):02d}E{math.floor(lon):03d}.hgt'
                if not polygon.intersects(box(lon,lat,lon+.05,lat+.05)):continue
                if name not in source.namelist():continue
                if name not in grids:grids={name:source.read(name)}
                raw=grids[name];n=math.isqrt(len(raw)//2)
                if n!=3601:raise ValueError('Expected original 1 arcsecond HGT source')
                # Store rows south to north for straightforward browser sampling.
                values=bytearray()
                for row in range(181):
                    py=round((math.floor(lat)+1-(lat+row/3600))*3600)
                    px=round((lon-math.floor(lon))*3600)
                    values.extend(raw[2*(py*n+px):2*(py*n+px+181)])
                if len(values)!=181*181*2:raise ValueError('Invalid grid dimensions')
                xs,ys=np.meshgrid(lon+np.arange(181)/3600,lat+np.arange(181)/3600)
                inside=shapely.intersects_xy(polygon,xs,ys)
                masked=np.frombuffer(values,dtype='>i2').reshape(181,181).copy();masked[~inside]=-32768;values=masked.tobytes()
                packed=gzip.compress(bytes(values),mtime=0);file=f'{x}_{y}.hgt.gz';(output/file).write_bytes(packed)
                result.append({'file':file,'x':x,'y':y,'bytes':len(packed),'sha256':hashlib.sha256(packed).hexdigest()})
    version=hashlib.sha256(json.dumps(result,sort_keys=True).encode()).hexdigest()[:16]
    info={'schemaVersion':1,'version':version,'cellDegrees':.05,'gridSize':181,'arcSeconds':1,'encoding':'big-endian int16, rows south to north','noData':-32768,'source':{'name':'魯地圖 DEM mix v2026','url':'https://rudymap.tw/v1/hgtmix.zip','archiveSha256':source_hash,'creditUrl':'https://rudymap.tw/','distributionNoticeUrl':'https://github.com/jkay-tw/mountain-planner/releases/download/terrain-sources-20261106/TERRAIN_SOURCE_NOTICES.md','coastlineSha256':hashlib.sha256(coastline.read_bytes()).hexdigest(),'method':'Original HGT samples in renamed small grids, masked outside exact-ID closed OSM mainland coastline to NoData; bilinear browser sampling; elevation estimate, not surveyed'},'tiles':result}
    (output/'manifest.json').write_text(json.dumps(info,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({'tiles':len(result),'bytes':sum(t['bytes'] for t in result),'version':version}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('archive',type=Path);parser.add_argument('network_manifest',type=Path);parser.add_argument('coastline',type=Path);parser.add_argument('output',type=Path);args=parser.parse_args();package(args.archive,args.network_manifest,args.coastline,args.output)
