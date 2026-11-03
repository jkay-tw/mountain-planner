"""Read owner review XLSX/XLSM as XML only; never execute workbook macros.
Writes a small authoritative override file, preserving the original candidate audit.
"""
import argparse,hashlib,json,math,zipfile,xml.etree.ElementTree as ET
from pathlib import Path
from build_planner_geometry import ROOT

def twd97_to_wgs84(x,y):
 # Inverse transverse Mercator, GRS80 / TM2 zone 121 (EPSG:3826).
 a=6378137.;b=6356752.314140356;k=.9999;e=1-b*b/a**2;ep=e/(1-e)
 mu=(y/k)/(a*(1-e/4-3*e**2/64-5*e**3/256));e1=(1-math.sqrt(1-e))/(1+math.sqrt(1-e))
 p=mu+(3*e1/2-27*e1**3/32)*math.sin(2*mu)+(21*e1**2/16-55*e1**4/32)*math.sin(4*mu)+151*e1**3/96*math.sin(6*mu)+1097*e1**4/512*math.sin(8*mu)
 n=a/math.sqrt(1-e*math.sin(p)**2);r=a*(1-e)/(1-e*math.sin(p)**2)**1.5;t=math.tan(p)**2;c=ep*math.cos(p)**2;d=(x-250000)/(n*k)
 lat=p-n*math.tan(p)/r*(d*d/2-(5+3*t+10*c-4*c*c-9*ep)*d**4/24+(61+90*t+298*c+45*t*t-252*ep-3*c*c)*d**6/720)
 lon=math.radians(121)+(d-(1+2*t+c)*d**3/6+(5-2*c+28*t-3*c*c+8*ep+24*t*t)*d**5/120)/math.cos(p)
 return [round(math.degrees(lon),7),round(math.degrees(lat),7)]

def read_rows(path,sheet='待查填選'):
 with zipfile.ZipFile(path) as z:
  ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
  strings=[''.join(si.itertext()) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',ns)] if 'xl/sharedStrings.xml' in z.namelist() else []
  sheets=ET.fromstring(z.read('xl/workbook.xml')).findall('m:sheets/m:sheet',ns)
  sh=next(s for s in sheets if s.attrib['name']==sheet)
  rid=sh.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
  rel=next(r for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels')) if r.attrib['Id']==rid)
  target=rel.attrib['Target'].lstrip('/');target=target if target.startswith('xl/') else 'xl/'+target
  rows=[]
  for row in ET.fromstring(z.read(target)).findall('m:sheetData/m:row',ns):
   out={}
   for cell in row:
    v=cell.find('m:v',ns);inline=cell.find('m:is',ns)
    s=v.text if v is not None else ''.join(inline.itertext()) if inline is not None else ''
    if cell.attrib.get('t')=='s':s=strings[int(s)]
    out[''.join(c for c in cell.attrib['r'] if c.isalpha())]=s or ''
   if out.get('A','').startswith('Q'):rows.append(out)
  return rows

def parse(path):
 out=[]
 for r in read_rows(path):
  note=r.get('H','').strip();item={'reviewId':r['A'],'nodeId':r['M'],'name':r['C'],'choice':r.get('D',''),'note':note,'coordinate':None}
  item['action']='delete' if note=='刪除節點' else 'ignore' if note in ('忽略','忽視') else 'pending'
  if item['action']=='pending' and r.get('F') and r.get('G'):
   x,y=float(r['F']),float(r['G']);fmt=r.get('E','')
   if fmt=='TWD97':coordinate=twd97_to_wgs84(x,y)
   elif fmt=='WGS84':coordinate=[x,y]
   else:raise ValueError('Unsupported coordinate format '+fmt+' '+r['A'])
   if not all(math.isfinite(v) for v in coordinate) or not (119<coordinate[0]<123 and 21<coordinate[1]<26):raise ValueError('Outside Taiwan: '+r['A'])
   item.update(action='coordinate',coordinate=coordinate,originalCoordinate={'format':fmt,'x':x,'y':y})
   if item['choice']!='自行補座標':item['resolution']='Owner confirmed filled coordinates override rejection of original candidates.'
  if r['A']=='Q053':item['displayName']='松泉崗/天巒池登山口'
  out.append(item)
 if len({r['nodeId'] for r in out})!=len(out):raise ValueError('Repeated Node ID')
 return {'schemaVersion':1,'sourceUrl':'https://drive.google.com/file/d/1bfrGAJmiayJmqG600tlq93ld8slUqPRP/view','sourceFileSha256':hashlib.sha256(Path(path).read_bytes()).hexdigest(),'reviewDate':'2026-11-04','nodes':out}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('workbook',type=Path);p.add_argument('--output',type=Path,default=ROOT/'data/geometry/sources/owner-coordinate-overrides.json');a=p.parse_args();result=parse(a.workbook)
 a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 from collections import Counter
 print(dict(Counter(n['action'] for n in result['nodes'])))
