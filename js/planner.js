export const round2=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
export const uid=()=>Math.random().toString(36).slice(2,9);

export function allNodes(route){
  return [...new Set(route.segments.flatMap(s=>[s.from,s.to]))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
}
export function directSegment(route,from,to){
  return route.segments.find(s=>s.from===from&&s.to===to)||null;
}
export function shortestPath(route,start,end){
  if(start===end)return {nodes:[start],segments:[],minutes:0};
  const ns=allNodes(route),dist=new Map(ns.map(n=>[n,Infinity])),prev=new Map(),unvisited=new Set(ns);
  dist.set(start,0);
  while(unvisited.size){
    let u=null,best=Infinity;
    for(const n of unvisited)if(dist.get(n)<best){best=dist.get(n);u=n}
    if(u===null||best===Infinity)break;
    unvisited.delete(u);if(u===end)break;
    for(const seg of route.segments.filter(s=>s.from===u)){
      const alt=best+seg.minutes;
      if(alt<(dist.get(seg.to)??Infinity)){dist.set(seg.to,alt);prev.set(seg.to,{node:u,seg})}
    }
  }
  if(!prev.has(end))return null;
  const segments=[],path=[end];let cur=end;
  while(cur!==start){
    const p=prev.get(cur);if(!p)return null;
    segments.unshift(p.seg);path.unshift(p.node);cur=p.node;
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
  return 0;
}
export function recalcConnections(day,route){
  const out=[];let prev=null;
  for(const raw of day.items){
    if(raw.type==='rest'){out.push({...raw});continue}
    const item={...raw};
    if(!prev)item.incoming=null;
    else if(item.type==='manual-location'||prev.type==='manual-location'){
      const old=raw.incoming;
      const keep=old?.kind==='manual'&&old.fromId===prev.id&&old.toId===item.id;
      item.incoming=keep?{...old}:{kind:'manual',fromId:prev.id,toId:item.id,actualMinutes:null};
    }else{
      const seg=directSegment(route,prev.name,item.name);
      if(seg){
        const old=raw.incoming;
        const keep=old?.kind==='official'&&old.from===seg.from&&old.to===seg.to?old.actualMinutes:null;
        item.incoming={kind:'official',from:seg.from,to:seg.to,officialMinutes:seg.minutes,actualMinutes:keep??null,source:route.source.image_url};
      }else item.incoming={kind:'manual',fromId:prev.id,toId:item.id,actualMinutes:null};
    }
    out.push(item);prev=item;
  }
  day.items=out;
}
export function buildTimeline(day){
  let t=clockToMinutes(day.startTime);const rows=[];
  for(const item of day.items){
    if(item.type==='rest'){
      t+=Number(item.minutes)||0;
      rows.push({...item,endTime:minutesToClock(t)});
      continue;
    }
    let incomingActual=0;
    if(item.incoming){incomingActual=edgeActual(item.incoming,day.coefficient);t+=incomingActual}
    rows.push({...item,arrival:minutesToClock(t),incomingActual});
  }
  return {rows,endTime:minutesToClock(t)};
}
export function summarizeDay(day){
  let official=0,officialActual=0,movement=0,rest=0,manual=0;
  for(const item of day.items){
    if(item.type==='rest'){rest+=Number(item.minutes)||0;continue}
    if(!item.incoming)continue;
    const actual=edgeActual(item.incoming,day.coefficient);movement+=actual;
    if(item.incoming.kind==='official'){official+=Number(item.incoming.officialMinutes)||0;officialActual+=actual}
    else manual+=actual;
  }
  return {official:round2(official),movement:round2(movement),manual:round2(manual),rest:round2(rest),total:round2(movement+rest),coefficient:official?round2(officialActual/official):null};
}
