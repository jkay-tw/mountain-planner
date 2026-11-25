import {meters} from './osm-pilot-router.js';
import {openTerrainCache,putTerrainCache} from './terrain-cache.js';
export function sampleBilinear(view,lon,lat,x,y){
 const fx=(lon-x/20)*3600,fy=(lat-y/20)*3600,a=Math.min(179,Math.floor(fx)),b=Math.min(179,Math.floor(fy));if(a<0||b<0||fx>180.00001||fy>180.00001)return null;
 const values=[[0,0],[1,0],[0,1],[1,1]].map(([dx,dy])=>view.getInt16(2*((b+dy)*181+a+dx),false));if(values.some(v=>v===-32768))return null;
 const u=fx-a,v=fy-b;return (values[0]*(1-u)+values[1]*u)*(1-v)+(values[2]*(1-u)+values[3]*u)*v;
}
export function alongLine(coordinates,spacing=30){
 if(!Array.isArray(coordinates)||coordinates.length<2||coordinates.length>100000||!Number.isFinite(spacing)||spacing<=0||coordinates.some(p=>!Array.isArray(p)||!Number.isFinite(p[0])||!Number.isFinite(p[1])||Math.abs(p[0])>180||Math.abs(p[1])>90))throw Error('DEM取樣線形無效或超過上限。');
 const result=[{coordinate:coordinates[0].slice(0,2),distance:0}];let walked=0;
 for(let i=1;i<coordinates.length;i++){const a=coordinates[i-1],b=coordinates[i],distance=meters(a,b),steps=Math.max(1,Math.ceil(distance/spacing));if(result.length+steps>100000)throw Error('DEM取樣超過10萬點，請分段規劃。');for(let j=1;j<=steps;j++)result.push({coordinate:[a[0]+(b[0]-a[0])*j/steps,a[1]+(b[1]-a[1])*j/steps],distance:walked+distance*j/steps});walked+=distance;}
 return result;
}
export class MainlandDem{
 constructor({base=new URL('../data/dem-mainland/',import.meta.url),fetcher=(...args)=>fetch(...args)}={}){this.base=base;this.fetcher=fetcher;this.cache=new Map();this.downloadBytes=0;this.cacheBytes=0;this.failures=new Set();}
 async init(){if(!this.manifest){const response=await this.fetcher(new URL('manifest.json',this.base),{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('DEM清單載入失敗');this.manifest=await response.json();this.index=new Map(this.manifest.tiles.map(t=>[t.x+'_'+t.y,t]));}return this.manifest;}
 async sample(coordinate){await this.init();const [lon,lat]=coordinate,x=Math.floor(lon*20),y=Math.floor(lat*20),key=x+'_'+y,tile=this.index.get(key);if(!tile||this.failures.has(key))return null;
  let view=this.cache.get(key);if(!view){try{const url=new URL(tile.file,this.base);url.searchParams.set('v',this.manifest.version);let stored=null;try{stored=await openTerrainCache(globalThis.caches,'mountain-dem-',this.manifest.version)}catch{}
   let response=await stored?.match(url);const hit=!!response;if(!response)response=await this.fetcher(url,{signal:AbortSignal.timeout(15000)});if(!response.ok){this.failures.add(key);return null;}const packed=await response.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',packed)),x=>x.toString(16).padStart(2,'0')).join('');if(hash!==tile.sha256){await stored?.delete(url);this.failures.add(key);return null;}
   const raw=await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();if(raw.byteLength!==181*181*2){this.failures.add(key);return null;}view=new DataView(raw);this.cache.set(key,view);if(this.cache.size>8)this.cache.delete(this.cache.keys().next().value);if(hit)this.cacheBytes+=packed.byteLength;else this.downloadBytes+=packed.byteLength;try{await putTerrainCache(stored,url,packed,16*1024*1024)}catch{}
  }catch{this.failures.add(key);return null;}}
  this.cache.delete(key);this.cache.set(key,view);return sampleBilinear(view,lon,lat,x,y);
 }
 async profile(coordinates){this.failures.clear();const manifest=await this.init(),samples=alongLine(coordinates);if(samples.length>100000)throw Error('DEM取樣超過10萬點，請分段規劃。');const profile=[];for(const sample of samples)profile.push([sample.distance,await this.sample(sample.coordinate)]);return {shape:coordinates.map(p=>p.slice(0,2)),profile,source:manifest.source,version:manifest.version,spacingMeters:30,downloadBytes:this.downloadBytes,cacheBytes:this.cacheBytes,unknownSamples:profile.filter(p=>!Number.isFinite(p[1])).length};}
}
