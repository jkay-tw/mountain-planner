import {buildGraph,meters} from './osm-pilot-router.js';
import {openTerrainCache,putTerrainCache} from './terrain-cache.js';

export function intersects(a,b){return a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1]}
export function corridorTiles(tiles,points,padding){
 return tiles.filter(tile=>points.some((p,i)=>{const q=points[Math.min(i+1,points.length-1)],b=tile.bounds.map((v,j)=>v+(j<2?-padding:padding));let lo=0,hi=1;for(let axis=0;axis<2;axis++){const delta=q[axis]-p[axis];if(!delta){if(p[axis]<b[axis]||p[axis]>b[axis+2])return false;continue;}const a=(b[axis]-p[axis])/delta,c=(b[axis+2]-p[axis])/delta;lo=Math.max(lo,Math.min(a,c));hi=Math.min(hi,Math.max(a,c));if(lo>hi)return false;}return true;}));
}
export class MainlandNetwork{
 constructor({base=new URL('../data/osm-mainland/',import.meta.url),fetcher=(...args)=>fetch(...args),cacheStorage=globalThis.caches}={}){this.base=base;this.fetcher=fetcher;this.cacheStorage=cacheStorage;this.loaded=new Map();this.bytes=0;this.downloadBytes=0;this.cacheBytes=0;}
 async init(){if(!this.manifest){const response=await this.fetcher(new URL('manifest.json',this.base),{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('本島路網清單載入失敗');this.manifest=await response.json();if(this.manifest.schemaVersion!==2)throw Error('不支援的路網資料版本');}return this.manifest;}
 async tile(tile){
  if(this.loaded.has(tile.file))return;
  if(this.bytes+tile.bytes>32*1024*1024)throw Error('此搜尋超過壓縮資料載入預算；請分段規劃。原路徑已保留。');
  const url=new URL(tile.file,this.base);url.searchParams.set('v',this.manifest.version);url.searchParams.set('sha256',tile.sha256);
  let cache=null,response=null;try{cache=await openTerrainCache(this.cacheStorage,'mountain-mainland-',this.manifest.version);response=await cache?.match(url);}catch{}
  const cached=!!response;
  if(!response){response=await this.fetcher(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('路網區塊下載失敗：'+tile.file);}
  const packed=await response.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',packed)),x=>x.toString(16).padStart(2,'0')).join('');
  if(hash!==tile.sha256){try{await cache?.delete(url)}catch{}throw Error('路網資料雜湊不符，已拒絕載入：'+tile.file);}
  const data=await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  if(data.schemaVersion!==2)throw Error('路網區塊版本不符');
  this.loaded.set(tile.file,data);this.bytes+=packed.byteLength;if(cached)this.cacheBytes+=packed.byteLength;else this.downloadBytes+=packed.byteLength;
  try{await putTerrainCache(cache,url,packed,32*1024*1024)}catch{}
 }
 async ensure(points,padding=.01){await this.init();const wanted=corridorTiles(this.manifest.tiles,points,padding).filter(t=>!t.manualOnly||this.manualEnabled),keys=new Set(wanted.map(t=>t.file));
  if(wanted.reduce((sum,t)=>sum+t.nodes,0)>800000||wanted.reduce((sum,t)=>sum+t.bytes,0)>32*1024*1024)throw Error('此搜尋超過80萬解碼頂點或32 MiB壓縮資料預算，請增加行程點分段；原路徑已保留。');
  for(const [file] of this.loaded)if(!keys.has(file)){this.loaded.delete(file);this.bytes-=this.manifest.tiles.find(t=>t.file===file).bytes;}
  for(const tile of wanted)await this.tile(tile);return wanted.length;}
 needsManual(points,padding=.01){return !this.manualEnabled&&corridorTiles(this.manifest?.tiles||[],points,padding).some(t=>t.manualOnly);}
 graph(){const merged={nodes:{},ways:[],blockedNodeIds:[],junctionIds:[]},ways=new Set();for(const tile of this.loaded.values()){for(const [id,point] of Object.entries(tile.nodes)){const existing=merged.nodes[id];if(existing&&(existing[0]!==point[0]||existing[1]!==point[1]))throw Error('相同OSM ID有衝突座標，已拒絕建圖：'+id);merged.nodes[id]=point;}for(const way of tile.ways){if(ways.has(way.id))throw Error('重複OSM way來源，已拒絕建圖：'+way.id);ways.add(way.id);merged.ways.push(way);}merged.blockedNodeIds.push(...tile.blockedNodeIds);merged.junctionIds.push(...tile.junctionIds);}return buildGraph(merged);}
 stats(){return {version:this.manifest?.version,tiles:this.loaded.size,compressedBytes:this.bytes,downloadBytes:this.downloadBytes,cacheBytes:this.cacheBytes};}
}
