import {MainlandNetwork} from './mainland-network.js';
import {attachedAlternatives} from './osm-attachment-routing.js';
import {routeIntervals,rememberIntervals} from './control-routing.js';
import {MainlandDem} from './mainland-dem.js';
const dem=new MainlandDem();
const network=new MainlandNetwork();let queue=Promise.resolve();const latest=new Map();
self.onmessage=({data:request})=>{if(request.key)latest.set(request.key,request.id);queue=queue.catch(()=>{}).then(async()=>{
 if(request.key&&latest.get(request.key)!==request.id){self.postMessage({id:request.id,error:'已取消過期路網請求。'});return;}
 self.postMessage({id:request.id,started:true});
 const started=performance.now();try{
  const {id,kind,points}=request;let result;
  if(kind==='init'){result=await network.init();}
  else if(kind==='dem'){result=await dem.profile(points);}
  else if(kind==='manual'){await network.init();network.manualEnabled=true;await network.tile(network.manifest.tiles.find(t=>t.file==='2430_500.json.gz'));result={};}
  else{
   // The entire original way belongs to one tile; its actual bounds in the
   // index ensure crossing ways can be fetched before routing across cells.
   for(const padding of [.01,.05,.15]){
    await network.ensure(points,padding);if(request.key&&latest.get(request.key)!==request.id)throw Error('已取消過期路網請求。');const graph=network.graph();
    if(kind==='alternatives'){result=attachedAlternatives(graph,points[0],points.at(-1));if(result.length)break;}
    else if(kind==='intervals'){const edit=structuredClone(request.edit||{controls:[]});if(request.force&&edit.shape&&!edit.intervals?.length)rememberIntervals(edit);result=routeIntervals(edit,points[0],points.at(-1),graph,{recalculate:request.force});if(!result.failures.length)break;}
    else {result={};break;}
   }
  }
  self.postMessage({id:request.id,result,stats:{...network.stats(),demDownloadBytes:dem.downloadBytes,demCacheBytes:dem.cacheBytes},elapsedMs:performance.now()-started});
 }catch(error){self.postMessage({id:request.id,error:error.message,stats:network.stats()});}
});};
