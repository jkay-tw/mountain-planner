import {expandReviewedOverlaps,isOwnerTimedConnection,incomingForSegment} from './planner.js?v=segments1';
export function quickAddCandidates(route,startId){
 if(!route||route.routingEnabled===false||!route.nodes?.some(n=>n.id===startId))return [];
 const eligible=[...route.segments.filter(s=>s.routingEnabled!==false&&s.travelMode==='walking'&&s.verificationStatus==='verified'),...(route.manualConnections||[]).filter(isOwnerTimedConnection)];
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
 for(const s of candidate.segments){const previous=[...day.items].reverse().find(x=>x.type!=='rest'),id=uid();day.items.push({id,type:'location',nodeId:s.toId,name:s.to,note:'',isPeak:false,hasWater:false,incoming:incomingForSegment(s,previous.id,id,route.source?.image_url,day.coefficient)});}
 return true;
}
// Direction is relative to the actual previous itinerary point, not map north
// or dataset order. Other branches remain available as forward choices.
export function directionalQuickAdd(route,day,previousNodeId=null){
 const locations=day.items.filter(x=>x.type!=='rest'),last=locations.at(-1);
 if(last?.type!=='location')return [];
 const previous=locations.at(-2)?.nodeId||previousNodeId;
 return quickAddCandidates(route,last.nodeId).map(c=>({...c,steps:c.segments.length,direction:previous?(c.segments[0].toId===previous?-1:1):0})).sort((a,b)=>(a.direction<0?2:0)+a.steps-((b.direction<0?2:0)+b.steps)||a.name.localeCompare(b.name,'zh-Hant'));
}
