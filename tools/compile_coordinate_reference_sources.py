import sys,json,pathlib,re,hashlib,xml.etree.ElementTree as E,argparse

from resolve_coordinate_sources import key,search_names
parser=argparse.ArgumentParser();parser.add_argument('capture_directory',type=pathlib.Path);args=parser.parse_args();root=pathlib.Path(__file__).resolve().parents[1];scratch=args.capture_directory
inventory=json.loads((root/'data/audits/all-route-coordinate-inventory-20261102.json').read_text());wanted={key(s) for n in inventory['nodes'] for labels in search_names(n) for s in labels}
def relevant(labels):return any(key(s) in wanted or any(w in key(s) and len(key(s))<=len(w)+10 for w in wanted if len(w)>=4) for s in labels)
points=[]
for c in json.loads((scratch/'twmap-points.json').read_text()):
 aliases=[s.strip() for s in re.split(r'[,、;/；]',c.get('alias') or '') if s.strip()]
 if not relevant([c['name'],*aliases]):continue
 typ=c['type'];cat='peak' if any(x in typ for x in ['等點','森林點','山頭','獨立峰']) else 'hut' if typ=='山屋' else 'camp' if typ=='營地' else typ
 points.append({'id':'twmap:'+c['id'],'source':'twmap','name':c['name'],'aliases':aliases,'coordinate':[float(c['x']),float(c['y'])],'elevationMeters':float(c['ele']) if c.get('ele') else None,'category':cat,'checked':c['checked']=='1','url':'https://twmap.happyman.idv.tw/gen/api/pointdata.php?id='+c['id']})
refs={}
for f in scratch.glob('official-markers-*.json'):
 try:x=json.loads(f.read_text(encoding='utf-8-sig'))
 except:continue
 for c in x.get('data',[]):
  if not c.get('X') or not c.get('Y'):continue
  aliases=[]
  name=c['name'];aliases+=re.split(r'[/／]',name)
  if '/營地' in name and '山屋' in name:aliases.append(name.split('/')[0].replace('山屋','營地'))
  if not relevant([name,*aliases]):continue
  i='official:'+str(c['node_id']);route=f.stem.split('-')[-1]
  if i in refs:refs[i]['routeIds'].append(route);continue
  refs[i]={'id':i,'source':'official','name':name,'aliases':aliases,'coordinate':[float(c['X']),float(c['Y'])],'category':'official-route-marker','routeIds':[route],'url':'https://hike.taiwan.gov.tw/GetGisData.ashx?action=getMarker&id='+route}
points+=list(refs.values())
for c in json.loads((scratch/'hike-points.json').read_text(encoding='utf-8-sig')):
 if c['layer_typeCN']!='遊客中心':continue
 name=c['layer_name_main']
 if not relevant([name]):continue
 points.append({'id':'official-facility:'+str(c['layer_id']),'source':'official','name':name,'aliases':[],'coordinate':[float(c['lon']),float(c['lat'])],'category':'visitor-centre','url':'https://hike.taiwan.gov.tw/layers/POINT20251205.json'})
# Supplemental OSM names include route-qualified labels; canonical IDs stay unchanged.
for c in json.loads((scratch/'osm-supplement.json').read_text()):
 t=c['tags']
 # A long named road's mean is not a point of interest. Closed POI areas and
 # hut footprints remain label candidates, never trail anchors.
 if c['osmRef'].startswith('way/') and t.get('highway') and t.get('amenity')!='parking':continue
 points.append({**c,'id':'osm:'+c['osmRef'],'source':'osm','name':t.get('name',''),'aliases':[v for k in ('name:zh','name:zh-Hant','alt_name','old_name','official_name') for v in t.get(k,'').split(';') if v],'url':'https://www.openstreetmap.org/'+c['osmRef']})
# Public community waypoints are retained as point references only. Do not
# copy full tracks, owner information, timestamps, or personal journey data.
tracks={c['mid']:c for c in json.loads((scratch/'gpx-track-references.json').read_text())}
for f in scratch.glob('community-*.gpx'):
 mid=f.stem.split('-')[-1]
 source_hash=hashlib.sha256(f.read_bytes()).hexdigest()
 try:tree=E.fromstring(f.read_bytes())
 except E.ParseError:
  # Some public Garmin files omit namespace declarations in extensions.
  # We only need standard waypoint coordinates/names; leave raw GPX intact.
  stripped=re.sub(r'<extensions\b[^>]*>.*?</extensions>','',f.read_text(errors='replace'),flags=re.S)
  try:tree=E.fromstring(stripped)
  except E.ParseError:continue
 for ordinal,w in enumerate(e for e in tree.iter() if e.tag.split('}')[-1]=='wpt'):
  name=next((e.text for e in w if e.tag.split('}')[-1]=='name'),'') or ''
  clean=re.sub(r'^(?:編號|WPT?|wpt?)[-_\s]*\d+[._\-\s]*','',name)
  clean=re.sub(r'^\d{2,}[._\-\s]+(?=\D)','',clean)
  clean=re.sub(r'^\d{2,}(?=[^\d.kKmM])','',clean)
  clean=re.sub(r'[（(]H?\d+\s*[mM公尺].*[）)]$','',clean).strip()
  if not clean or re.fullmatch(r'[\d.]+',clean) or not relevant([clean,name]):continue
  try:coord=[float(w.attrib['lon']),float(w.attrib['lat'])]
  except (KeyError,ValueError):continue
  if not (120<coord[0]<123 and 21<coord[1]<26):continue
  points.append({'id':f'community-gpx:{mid}:{ordinal}','source':'community-gpx','name':clean,'aliases':[name] if name!=clean else [],'coordinate':coord,'category':'recorded-waypoint','trackRef':mid,'sourceFileSha256':source_hash,'url':tracks.get(mid,{}).get('url','https://twmap.happyman.idv.tw/gen/api/getkml.php?mid='+mid+'&type=gpx')})
data={'schemaVersion':1,'sources':[{'id':'community-gpx','title':'TWMap 公開山友 GPX 具名航點（原始軌跡僅本機研究）','url':'https://twmap.happyman.idv.tw/map/','retrievedDate':'2026-11-02'},{'id':'official','title':'國家公園署登山申請一站式服務網 公開圖台路線標記','url':'https://hike.taiwan.gov.tw/web_map2.aspx','retrievedDate':'2026-11-02'},{'id':'twmap','title':'TWMap 公開興趣點資料庫','url':'https://twmap.happyman.idv.tw/gen/api/pointdata.php?id=ALL','retrievedDate':'2026-11-02'},{'id':'osm','title':'OpenStreetMap contributors／Geofabrik 台灣擷取（ODbL 1.0）','url':'https://download.geofabrik.de/asia/taiwan.html','retrievedDate':'2026-11-02'}],'points':points}
p=root/'data/geometry/sources/coordinate-reference-points-20261102.json';p.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n');print('external matching references',len(points),'official',len(refs))
