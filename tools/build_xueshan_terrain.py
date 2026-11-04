"""Build traceable 30 m terrain profiles from Rudy's downloaded HGT zip.
Usage: python3 tools/build_xueshan_terrain.py /path/to/hgtmix.zip
Raw grids remain outside the repository; derived samples retain both checksums.
"""
import hashlib,json,math,struct,sys,zipfile
from pathlib import Path
from build_xueshan_geometry import distance
ROOT=Path(__file__).resolve().parents[1]

def project(point,coords):
    sx=111195*math.cos(math.radians(point[1]));sy=111195
    candidates=[]
    for i,(a,b) in enumerate(zip(coords,coords[1:])):
        ax=(a[0]-point[0])*sx;ay=(a[1]-point[1])*sy
        dx=(b[0]-a[0])*sx;dy=(b[1]-a[1])*sy
        f=max(0,min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy))) if dx*dx+dy*dy else 0
        p=[a[j]+f*(b[j]-a[j]) for j in (0,1)]
        candidates.append((math.hypot(ax+f*dx,ay+f*dy),i,f,p))
    return min(candidates)

class Hgt:
    def __init__(self,raw):
        self.raw=raw;self.n=math.isqrt(len(raw)//2)
        if self.n*self.n*2!=len(raw):raise ValueError('Invalid HGT dimensions')
    def sample(self,p):
        x=(p[0]-121)*(self.n-1);y=(25-p[1])*(self.n-1)
        if not 0<=x<self.n-1 or not 0<=y<self.n-1:raise ValueError('Outside N24E121')
        a,b=int(x),int(y);fx,fy=x-a,y-b
        v=[struct.unpack_from('>h',self.raw,2*((b+dy)*self.n+a+dx))[0] for dy,dx in [(0,0),(0,1),(1,0),(1,1)]]
        if -32768 in v:raise ValueError('DEM NoData')
        return (v[0]*(1-fx)+v[1]*fx)*(1-fy)+(v[2]*(1-fx)+v[3]*fx)*fy

def resample(coords,step=30):
    chain=[0]
    for a,b in zip(coords,coords[1:]):chain.append(chain[-1]+distance(a,b))
    targets=[i*step for i in range(int(chain[-1]//step)+1)]
    if targets[-1]!=chain[-1]:targets.append(chain[-1])
    out=[];j=0
    for d in targets:
        while j<len(chain)-2 and chain[j+1]<d:j+=1
        f=(d-chain[j])/(chain[j+1]-chain[j]) if chain[j+1]>chain[j] else 0
        out.append((d,[coords[j][k]+f*(coords[j+1][k]-coords[j][k]) for k in (0,1)]))
    return out

def build(zip_path):
    data=json.loads((ROOT/'data/geometry/xueshan-osm-v1.json').read_text())
    rawzip=Path(zip_path).read_bytes()
    with zipfile.ZipFile(zip_path) as z:raw=z.read('N24E121.hgt')
    grid=Hgt(raw)
    circle=next(n for n in data['nodes'] if n['nodeId']=='g04-039')
    point=[121.23638022672083,24.388491806668416]
    old=data['spans'][-1];offset,index,f,anchor=project(point,old['coordinates'])
    if offset>100:raise ValueError('User circle position is too far from selected corridor')
    circle.update(status='user-specified',coordinate=point,coordinateMethod='User TWD97 TM2 zone121 EPSG:3826 (273977,2698069), confirmed 2026-11-02',anchor=anchor,offsetMeters=round(offset,1),note='使用者指定位置；錨點為既有 OSM 走廊投影點，不補離徑直線。',osmRef=None)
    circle.pop('anchorOsmNodeId',None)
    left={**old,'id':'xueshan-5a','toId':'g04-039','viaNodeIds':[],'coordinates':old['coordinates'][:index+1]+[anchor]}
    right={**old,'id':'xueshan-5b','fromId':'g04-039','viaNodeIds':[],'coordinates':[anchor]+old['coordinates'][index+1:]}
    for s in [left,right]:
        s.pop('osmNodeIds',None);s.pop('edgeWayIds',None)
        s['derivedFrom']={'spanId':old['id'],'edgeIndex':index,'fraction':f,'method':'projection onto existing OSM edge; no off-trail connector'}
    old['aggregate']=True
    data['spans']=data['spans'][:-1]+[left,right,old]
    for s in data['spans']:
        samples=resample(s['coordinates']);heights=[grid.sample(p) for _,p in samples]
        smooth=[heights[0]]+[sum(heights[i-1:i+2])/3 for i in range(1,len(heights)-1)]+[heights[-1]]
        s['profile']=[[round(d,3),round(z,3)] for (d,_),z in zip(samples,smooth)]
        s['distanceMeters']=round(samples[-1][0],3)
    # The legacy direct long edge uses the exact same split profiles, so totals
    # remain additive whether an old plan contains the circle node or omits it.
    old['profile']=left['profile']+[[round(d+left['distanceMeters'],3),z] for d,z in right['profile'][1:]]
    for n in data['nodes']:n['elevationMeters']=round(grid.sample(n['coordinate']),1)
    data['id']='xueshan-osm-rudy-dem-20261102'
    data['terrainSource']={'name':'魯地圖 DEM mix v2026','url':'https://rudymap.tw/v1/hgtmix.zip','creditUrl':'https://rudymap.tw/','retrievedDate':'2026-11-02','tile':'N24E121.hgt','gridSize':grid.n,'gridStepDegrees':1/(grid.n-1),'nominalResolutionMeters':30,'zipSha256':hashlib.sha256(rawzip).hexdigest(),'tileSha256':hashlib.sha256(raw).hexdigest(),'method':'HGT signed big-endian int16; bilinear interpolation; 30m along-path sampling; three-sample moving mean with fixed endpoints; separate sum of positive/negative increments','verticalDatum':'not independently confirmed; DEM estimate, not surveyed elevation'}
    data['notes']=[n for n in data['notes'] if '圈谷底部未定位' not in n]+['高程與升降為魯地圖 DEM 約30m格網估算；非現地測量。']
    return data

if __name__=='__main__':
    result=build(sys.argv[1]);out=ROOT/'data/geometry/xueshan-terrain-v1.json';out.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
    print('circle offset',next(n['offsetMeters'] for n in result['nodes'] if n['nodeId']=='g04-039'))
    for s in result['spans']:
        diffs=[b[1]-a[1] for a,b in zip(s['profile'],s['profile'][1:])]
        print(s['id'],round(s['distanceMeters']),round(sum(max(0,v) for v in diffs)),round(sum(max(0,-v) for v in diffs)))
