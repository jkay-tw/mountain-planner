"""Publish small inspection samples, with original geometry IDs and DEM values."""
import argparse,gzip,hashlib,json
from pathlib import Path
from full_dem import Dem

def build(source,dem_file,output):
    manifest=json.loads((source/'manifest.json').read_text(encoding='utf-8'));dem=Dem(dem_file);output.mkdir(parents=True,exist_ok=True);samples=[]
    for name,file,north in [('雪山附近檢查區塊','485_97.json.gz',False),('雪山北側相鄰區塊（跨區測試）','485_98.json.gz',False),('郡大山／郡大林道區塊','483_94.json.gz',False),('玉山附近檢查區塊','483_93.json.gz',False),('北部山區局部檢查（非整個台北）','486_100.json.gz',True)]:
        data=json.loads(gzip.decompress((source/file).read_bytes()))
        if north:
            data['ways']=[w for w in data['ways'] if 25.125<=data['nodes'][str(w['refs'][len(w['refs'])//2])][1]<25.25]
            used={str(i) for w in data['ways'] for i in w['refs']};data['nodes']={i:p for i,p in data['nodes'].items() if i in used};data['blockedNodeIds']=[i for i in data['blockedNodeIds'] if str(i) in used]
        missing=0
        for point in data['nodes'].values():
            try:point.append(round(dem.sample(point),1))
            except (ValueError,KeyError):point.append(None);missing+=1
        data['source']=manifest['source'];data['terrainSource']=dem.provenance()
        data['terrainSource']['method']='big-endian HGT, bilinear sampling at original OSM vertices only; no along-path resampling or smoothing'
        data['sampleNote']='Complete ways assigned by midpoint; not an isolated complete routing region. Node DEM samples only.'
        filename=('north-' if north else '')+file;raw=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode();packed=gzip.compress(raw,mtime=0);(output/filename).write_bytes(packed)
        samples.append({'name':name,'file':filename,'bytes':len(packed),'jsonBytes':len(raw),'nodes':len(data['nodes']),'ways':len(data['ways']),'elevationMissing':missing,'sha256':hashlib.sha256(packed).hexdigest()})
    (output/'samples.json').write_text(json.dumps(samples,ensure_ascii=False,indent=2),encoding='utf-8');(output/'build-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(samples,ensure_ascii=False,indent=2))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('dem',type=Path);p.add_argument('output',type=Path);a=p.parse_args();build(a.source,a.dem,a.output)
