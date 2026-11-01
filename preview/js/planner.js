export const round2=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
export const uid=()=>Math.random().toString(36).slice(2,9);

export function allNodes(route){
  return [...new Set(route.segments.flatMap(s=>[s.from,s.to]))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
}
export function directSegment(route,from,to){
  return route.segments.find(s=>s.from===from&&s.to===to)||null;
}
// Owner-confirmed physical overlaps. IDs are explicit: labels alone never establish
// identity. Each direction must still match the verified edges and minute total.
const reviewedOverlaps=[
  ['shared:cw-v07-066','g04-fork-xueshan','shared:cw-v07-074'],
  ['shared:cw-v07-003','g04-027','g04-044','shared:cw-v07-004'],
  ['shared:cw-v07-004','g04-039','shared:cw-v07-074'],
  ['shared:cw-v07-012','node:83a76c46935de2ee6f88','node:6d5573eb9babae99663c','shared:cw-v07-048'],
  ['shared:cw-v07-012','node:dca389db39359114677f','shared:cw-v07-041'],
  ['shared:cw-v07-078','node:e9cc87a6032a69ff2163','shared:cw-v07-080'],
  ['shared:cw-v07-040','node:2f804109a33585abde92','node:47059555f89c94f5c563','node:70418012ecbda7a8add8','shared:cw-v07-080'],
  ['shared:cw-v07-018','shared:cw-v07-008','shared:cw-v07-055','shared:cw-v07-076'],
  ['shared:cw-v07-054','shared:cw-v07-013','shared:cw-v07-044','shared:cw-v07-072'],
  ['shared:cw-v07-071','shared:cw-v07-057','shared:cw-v07-026','shared:cw-v07-072'],
  ['shared:cw-v07-019','shared:cw-v07-026','shared:cw-v07-072']
];
function expandReviewedOverlaps(route,segments){
  return segments.flatMap(segment=>{
    const match=reviewedOverlaps.find(ids=>(ids[0]===segment.fromId&&ids.at(-1)===segment.toId)||(ids[0]===segment.toId&&ids.at(-1)===segment.fromId));
    if(!match)return [segment];
    const ids=match[0]===segment.fromId?match:[...match].reverse();
    const parts=ids.slice(1).map((id,i)=>route.segments.find(s=>s.fromId===ids[i]&&s.toId===id&&s.routingEnabled!==false&&s.travelMode==='walking'&&s.verificationStatus==='verified'));
    // A partial dataset or changed source must never invent a route or time.
    return parts.every(Boolean)&&parts.reduce((sum,s)=>sum+s.minutes,0)===segment.minutes?parts:[segment];
  });
}
export function shortestPath(route,start,end){
  const idMode=Array.isArray(route.nodes)&&route.segments.every(s=>s.fromId&&s.toId);
  if(idMode){
    const valid=new Set(route.nodes.map(n=>n.id));
    if(!valid.has(start)||!valid.has(end))return null;
  }
  if(start===end)return {nodes:[start],segments:[],minutes:0};
  const ns=idMode?route.nodes.map(n=>n.id):allNodes(route);
  const dist=new Map(ns.map(n=>[n,Infinity])),prev=new Map(),unvisited=new Set(ns);
  const fromKey=idMode?'fromId':'from',toKey=idMode?'toId':'to';
  dist.set(start,0);
  while(unvisited.size){
    let u=null,best=Infinity;
    for(const n of unvisited)if(dist.get(n)<best){best=dist.get(n);u=n}
    if(u===null||best===Infinity)break;
    unvisited.delete(u);if(u===end)break;
    for(const seg of route.segments.filter(s=>s[fromKey]===u&&route.routingEnabled!==false&&s.routingEnabled!==false&&!['vehicle','driving','transport'].includes(s.travelMode??s.edgeType??'walking')&&s.verificationStatus!=='unverified'&&(route.routingPolicy!=='verified-walking-only'||(s.travelMode==='walking'&&s.verificationStatus==='verified')))){
      const target=seg[toKey];
      const alt=best+seg.minutes;
      if(alt<(dist.get(target)??Infinity)){dist.set(target,alt);prev.set(target,{node:u,seg})}
    }
  }
  if(!prev.has(end))return null;
  const segments=[],path=[end];let cur=end;
  while(cur!==start){
    const p=prev.get(cur);if(!p)return null;
    segments.unshift(p.seg);path.unshift(p.node);cur=p.node;
  }
  if(idMode){
    const expanded=expandReviewedOverlaps(route,segments);
    return {nodes:[start,...expanded.map(s=>s.toId)],segments:expanded,minutes:dist.get(end)};
  }
  return {nodes:path,segments,minutes:dist.get(end)};
}
export function minutesToClock(total){
  total=((Math.round(total)%1440)+1440)%1440;
  return String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0');
}
export function clockToMinutes(clock){
  const [h,m]=(clock||'00:00').split(':').map(Number);return h*60+m;
}
export function formatDuration(minutes){
  const m=Math.max(0,Math.round(Number(minutes)||0)),h=Math.floor(m/60),r=m%60;
  if(!h)return m+'m';
  if(!r)return h+'hr';
  return h+'hr '+r+'m';
}
export function edgeActual(edge,defaultCoefficient){
  if(edge.actualMinutes!==null&&edge.actualMinutes!==undefined&&edge.actualMinutes!=='')return Number(edge.actualMinutes);
  if(edge.kind==='official')return round2(edge.officialMinutes*defaultCoefficient);
  return null;
}
export function missingSegments(day){return day.items.filter(x=>x.type!=='rest'&&x.incoming&&edgeActual(x.incoming,day.coefficient)===null).length;}
export function recalcConnections(day,route){
  const original=day.items;
  const result=[];let previous=null;
  const makeManual=(from,to,old)=>{
    const keep=old?.kind==='manual'&&old.fromId===from.id&&old.toId===to.id;
    return keep?{...old}:{kind:'manual',fromId:from.id,toId:to.id,actualMinutes:null};
  };
  for(const raw of original){
    if(raw.type==='rest'){result.push({...raw});continue;}
    const item={...raw};
    if(!previous){item.incoming=null;result.push(item);previous=item;continue;}
    // Dataset updates must not replace a saved connection while its endpoints stay put.
    // A move/delete changes endpoint identity and still triggers normal reconnection below.
    const stored=raw.incoming;
    const stableManual=stored?.kind==='manual'&&stored.connectionStatus==='unverified'&&stored.fromId===previous.id&&stored.toId===item.id;
    const stableOfficial=Array.isArray(route.nodes)&&stored?.kind==='official'&&
      stored.fromNodeId===previous.nodeId&&stored.toNodeId===item.nodeId&&
      previous.nodeId!==item.nodeId;
    if(stableManual||stableOfficial){
      item.incoming={...stored};result.push(item);previous=item;continue;
    }
    if(previous.type==='manual-location'||item.type==='manual-location'){
      item.incoming=makeManual(previous,item,raw.incoming);result.push(item);previous=item;continue;
    }
    const identified=Array.isArray(route.nodes);
    const path=shortestPath(route,identified?previous.nodeId:previous.name,identified?item.nodeId:item.name);
    if(!path){item.incoming=makeManual(previous,item,raw.incoming);result.push(item);previous=item;continue;}
    if(!path.segments.length){
      // Adjacent identical official locations represent the same physical point.
      // Merge them instead of leaving a later item with incoming=null ("起點").
      const prevOut=[...result].reverse().find(x=>x.type!=='rest');
      if(prevOut&&prevOut.type==='location'&&item.type==='location'&&(identified?prevOut.nodeId===item.nodeId:prevOut.name===item.name)){
        prevOut.note=prevOut.note||item.note||'';
        prevOut.isPeak=!!(prevOut.isPeak||item.isPeak);
        prevOut.hasWater=!!(prevOut.hasWater||item.hasWater);
        previous=prevOut;
        continue;
      }
      item.incoming={kind:'manual',fromId:previous.id,toId:item.id,actualMinutes:null};
      result.push(item);previous=item;continue;
    }
    for(let j=0;j<path.segments.length;j++){
      const seg=path.segments[j],isDestination=j===path.segments.length-1;
      const existing=original.find(x=>x.type!=='rest'&&(identified?x.nodeId===seg.toId:x.name===seg.to)&&x.incoming?.kind==='official'&&(identified?x.incoming.fromNodeId===seg.fromId&&x.incoming.toNodeId===seg.toId:x.incoming.from===seg.from&&x.incoming.to===seg.to));
      const target=isDestination?item:(existing?{...existing}:{id:uid(),type:'location',name:seg.to,...(identified?{nodeId:seg.toId}:{}),auto:true,waypoint:false,note:'',isPeak:false,hasWater:false});
      const old=target.incoming,keep=old?.kind==='official'&&(identified?old.fromNodeId===seg.fromId&&old.toNodeId===seg.toId:old.from===seg.from&&old.to===seg.to);
      target.incoming={kind:'official',from:seg.from,to:seg.to,...(identified?{fromNodeId:seg.fromId,toNodeId:seg.toId}:{}),officialMinutes:keep?old.officialMinutes:seg.minutes,actualMinutes:keep?old.actualMinutes??null:null,source:seg.source||route.source?.image_url,...(Array.isArray(seg.timeAlternatives)&&seg.timeAlternatives.length?{timeAlternatives:seg.timeAlternatives}:keep&&old.timeAlternatives?{timeAlternatives:old.timeAlternatives}:{})};
      result.push(target);
    }
    previous=item;
  }
  day.items=result;
}
// Deletion is based on the node's role in the current day, never on how it was added.
// Official nodes are deletable only at day boundaries or immediately beside a manual node.
export function retargetSplitIncoming(items,oldStartId,newStartId){
  const firstMoved=items.find(x=>x.type!=='rest');
  if(firstMoved?.incoming?.kind==='manual'&&firstMoved.incoming.fromId===oldStartId){
    firstMoved.incoming={...firstMoved.incoming,fromId:newStartId};
  }
  return items;
}
export function normalizeDay(day,route){
  if(route)recalcConnections(day,route);
  const locs=day.items.filter(x=>x.type!=='rest');
  if(locs.length){
    locs[0].incoming=null;
    for(let i=1;i<locs.length;i++){
      if(!locs[i].incoming){
        const prev=locs[i-1];
        locs[i].incoming={kind:'manual',fromId:prev.id,toId:locs[i].id,actualMinutes:null};
      }
    }
  }
  return day;
}
export function canDeleteItem(day,index){
  const item=day.items[index];
  if(!item)return false;
  if(item.type==='rest'||item.type==='manual-location')return true;
  const locIndexes=day.items.map((x,i)=>x.type==='rest'?null:i).filter(i=>i!==null);
  const pos=locIndexes.indexOf(index);
  if(pos<0)return false;
  if(pos===0||pos===locIndexes.length-1)return true;
  const prev=day.items[locIndexes[pos-1]],next=day.items[locIndexes[pos+1]];
  return prev?.type==='manual-location'||next?.type==='manual-location';
}
export function buildTimeline(day){
  let t=clockToMinutes(day.startTime),known=true;const rows=[];
  for(const item of day.items){
    if(item.type==='rest'){
      if(known)t+=Number(item.minutes)||0;
      rows.push({...item,endTime:known?minutesToClock(t):'—'});continue;
    }
    const incomingActual=item.incoming?edgeActual(item.incoming,day.coefficient):0;
    if(incomingActual===null)known=false;
    else if(known)t+=incomingActual;
    rows.push({...item,arrival:known?minutesToClock(t):'—',incomingActual});
  }
  return {rows,endTime:known?minutesToClock(t):'—',complete:known};
}
export function summarizeDay(day){
  let official=0,officialActual=0,movement=0,rest=0,manual=0,missing=0;
  for(const item of day.items){
    if(item.type==='rest'){rest+=Number(item.minutes)||0;continue;}
    if(!item.incoming)continue;
    const actual=edgeActual(item.incoming,day.coefficient);
    if(actual===null){missing++;continue;}
    movement+=actual;
    if(item.incoming.kind==='official'){official+=Number(item.incoming.officialMinutes)||0;officialActual+=actual;}
    else manual+=actual;
  }
  return {official:round2(official),movement:round2(movement),manual:round2(manual),rest:round2(rest),total:missing?null:round2(movement+rest),missing,coefficient:official?round2(officialActual/official):null};
}
