"""Read all tiles in the user's existing Rudy HGT archive; no fabricated values."""
import hashlib,math,struct,zipfile
class Dem:
 def __init__(self,path):
  self.zip=zipfile.ZipFile(path);self.cache={};self.hashes={}
  with open(path,'rb') as f:self.sha256=hashlib.file_digest(f,'sha256').hexdigest()
 def sample(self,p):
  lon,lat=p;x0=math.floor(lon);y0=math.floor(lat)
  name=f'{"N" if y0>=0 else "S"}{abs(y0):02d}{"E" if x0>=0 else "W"}{abs(x0):03d}.hgt'
  if name not in self.cache:
   raw=self.zip.read(name);n=math.isqrt(len(raw)//2)
   if n*n*2!=len(raw):raise ValueError('Invalid DEM tile')
   self.cache[name]=(raw,n);self.hashes[name]=hashlib.sha256(raw).hexdigest()
  raw,n=self.cache[name];x=(lon-x0)*(n-1);y=(y0+1-lat)*(n-1)
  a=min(n-2,int(x));b=min(n-2,int(y));fx=x-a;fy=y-b
  if a<0 or b<0:raise ValueError('Outside DEM tile')
  v=[struct.unpack_from('>h',raw,2*((b+dy)*n+a+dx))[0] for dy,dx in [(0,0),(0,1),(1,0),(1,1)]]
  if -32768 in v:raise ValueError('DEM NoData')
  return (v[0]*(1-fx)+v[1]*fx)*(1-fy)+(v[2]*(1-fx)+v[3]*fx)*fy
 def provenance(self):
  return {'name':'魯地圖 DEM mix v2026','url':'https://rudymap.tw/v1/hgtmix.zip','creditUrl':'https://rudymap.tw/','zipSha256':self.sha256,'tileSha256':self.hashes,'nominalResolutionMeters':30,'method':'big-endian HGT, bilinear sampling; 30m along-path samples, three-sample moving mean, fixed endpoints','verticalDatum':'DEM estimate; not independently surveyed'}
