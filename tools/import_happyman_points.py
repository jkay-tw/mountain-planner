"""Import matched named POIs read by the official Mapsforge Java reader.
Raw map/POI database stays outside Git. Only matching source references are kept.
"""
import argparse,hashlib,json,re,struct,datetime
from pathlib import Path
from resolve_coordinate_sources import key,search_names
ROOT=Path(__file__).resolve().parents[1]

def labels(raw):
 value=raw.strip()
 value=re.sub(r'^\d{1,2}[:：]\d{2}\s*','',value)
 value=re.sub(r'^(?:編號|WPT?|wpt?)[-_\s]*\d+[._\-\s]*','',value)
 value=re.sub(r'^\d{1,3}(?:[_\-\s]+|\.(?!\d))(?=\S)','',value)
 value=re.sub(r'^\d{3}(?=[^\d.kKmM峰營鞍])','',value)
 # Preserve numbered camps and kilometre prefixes; remove only metadata tails.
 bare=re.sub(r'[,，\s（(]+[Hh]?\s*\d{3,4}\s*(?:[mM]|公尺)[）)]?\s*$','',value).strip()
 bare=re.sub(r'(?<=[^\d.])\d{3,4}\s*(?:[mM]|公尺)$','',bare).rstrip(' ,，（(')
 variants={value,bare}
 variants.add(re.sub(r'\s*\d+(?:\.\d+)?[kK]\s*$','',bare).strip())
 return [v for v in sorted(variants,key=lambda s:(len(s),s)) if v]

def build(map_path,ndjson,baseline_path=None):
 raw=map_path.read_bytes();md5=hashlib.md5(raw).hexdigest();sha=hashlib.sha256(raw).hexdigest()
 if raw[:20]!=b'mapsforge binary OSM':raise ValueError('Not a Mapsforge file')
 version,size,date=struct.unpack('>iqq',raw[24:44])
 if size!=len(raw):raise ValueError('Truncated Mapsforge file')
 baseline=json.loads((baseline_path or ROOT/'data/geometry/all-route-coordinates-v1.json').read_text())
 targets=[n for n in baseline['nodes'] if not n['coordinate'] or '志佳陽' in n['name']]
 wanted={key(s) for n in targets for names in search_names({'name':n['name'],'aliases':[]}) for s in names}
 pattern=re.compile('|'.join(re.escape(s) for s in sorted(wanted,key=len,reverse=True) if len(s)>=2))
 points={};total=0
 for line in ndjson.open():
  item=json.loads(line);total+=1;name=item['tags'].get('name','');variants=labels(name)
  if not ('志佳陽' in name or any(key(v) in wanted or pattern.search(key(v)) for v in variants)):continue
  identity=json.dumps(item,ensure_ascii=False,sort_keys=True,separators=(',',':'));i='happyman:'+hashlib.sha256(identity.encode()).hexdigest()[:20]
  ele=item['tags'].get('ele');elevation=float(ele) if ele and re.fullmatch(r'-?\d+(?:\.\d+)?',ele) else None
  points[i]={'id':i,'source':'happyman','name':variants[0] if variants else name,'rawName':name,'aliases':variants[1:],'coordinate':item['coordinate'],'elevationMeters':elevation,'category':'recorded-waypoint','tags':item['tags'],'sourceFileSha256':sha,'url':'https://tile.happyman.idv.tw/~happyman/gpx_map/20240813_155542/Happyman.map'}
 return {'schemaVersion':1,'source':{'id':'happyman','title':'使用者提供 Happyman.map（20240813_155542）','url':'https://tile.happyman.idv.tw/~happyman/gpx_map/','retrievedDate':'2026-11-02','md5':md5,'sha256':sha,'fileSize':size,'formatVersion':version,'mapCreatedUtc':datetime.datetime.fromtimestamp(date/1000,datetime.timezone.utc).isoformat(),'reader':'org.mapsforge/mapsforge-map-reader 0.25.0','rawNamedPoiCount':total,'note':'GPX-derived reference layer, not an independent survey; raw map is not redistributed.'},'points':list(points.values())}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('map',type=Path);p.add_argument('ndjson',type=Path);p.add_argument('output',type=Path);p.add_argument('--baseline',type=Path);a=p.parse_args();result=build(a.map,a.ndjson,a.baseline);a.output.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n');print('raw named POIs',result['source']['rawNamedPoiCount'],'matched unique POIs',len(result['points']))
