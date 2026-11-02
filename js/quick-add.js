import {expandReviewedOverlaps} from './planner.js?v=v0729';
export function quickAddCandidates(route,startId){
 if(!route||route.routingEnabled===false||!route.nodes?.some(n=>n.id===startId))return [];
 const eligible=route.segments.filter(s=>s.routingEnabled!==false&&s.travelMode==='walking'&&s.verificationStatus==='verified');
 const edges=[...new Map(expandReviewedOverlaps(route,eligible).map(s=>[s.fromId+'>'+s.toId,s])).values()];
 const paths=[];
 for(const a of edges.filter(s=>s.fromId===startId&&s.toId!==startId)){
  paths.push([a]);
  for(const b of edges.filter(s=>s.fromId===a.toId&&s.toId!==startId&&s.toId!==a.toId))paths.push([a,b]);
 }
 return paths.map(segments=>({key:[startId,...segments.map(s=>s.toId)].join('>'),segments,nodeId:segments.at(-1).toId,name:segments.at(-1).to,via:segments.length===2?segments[0].to:null})).sort((a,b)=>a.segments.length-b.segments.length||a.name.localeCompare(b.name,'zh-Hant'));
}
export function appendQuickPath(day,route,key,uid){
 const last=[...day.items].reverse().find(x=>x.type!=='rest');
 if(last?.type!=='location')return false;
 const candidate=quickAddCandidates(route,last.nodeId).find(c=>c.key===key);if(!candidate)return false;
 for(const s of candidate.segments)day.items.push({id:uid(),type:'location',nodeId:s.toId,name:s.to,note:'',isPeak:false,hasWater:false,incoming:{kind:'official',from:s.from,to:s.to,fromNodeId:s.fromId,toNodeId:s.toId,officialMinutes:s.minutes,actualMinutes:null,source:s.source||route.source?.image_url,...(s.timeAlternatives?{timeAlternatives:s.timeAlternatives}:{})}});
 return true;
}
