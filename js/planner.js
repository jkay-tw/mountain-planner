export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const uid = () => Math.random().toString(36).slice(2, 9);

export function allNodes(route){
  return [...new Set(route.segments.flatMap(s => [s.from, s.to]))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
}

export function directSegment(route, from, to){
  return route.segments.find(s => s.from === from && s.to === to) || null;
}

export function shortestPath(route, start, end){
  if(start === end) return {nodes:[start], segments:[], minutes:0};
  const nodes = allNodes(route);
  const dist = new Map(nodes.map(n=>[n, Infinity]));
  const prev = new Map();
  const unvisited = new Set(nodes);
  dist.set(start, 0);

  while(unvisited.size){
    let u = null, best = Infinity;
    for(const n of unvisited){
      if(dist.get(n) < best){ best = dist.get(n); u = n; }
    }
    if(u === null || best === Infinity) break;
    unvisited.delete(u);
    if(u === end) break;

    for(const seg of route.segments.filter(s=>s.from===u)){
      const alt = best + seg.minutes;
      if(alt < (dist.get(seg.to) ?? Infinity)){
        dist.set(seg.to, alt);
        prev.set(seg.to, {node:u, seg});
      }
    }
  }

  if(!prev.has(end)) return null;
  const segments=[], path=[end];
  let cur=end;
  while(cur !== start){
    const p=prev.get(cur);
    if(!p) return null;
    segments.unshift(p.seg);
    path.unshift(p.node);
    cur=p.node;
  }
  return {nodes:path, segments, minutes:dist.get(end)};
}

export function minutesToClock(totalMinutes){
  totalMinutes = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const h = Math.floor(totalMinutes / 60), m = totalMinutes % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
export function clockToMinutes(clock){
  const [h,m]=(clock || '00:00').split(':').map(Number);
  return h*60+m;
}

export function edgeActual(edge, defaultCoefficient){
  if(edge.actualMinutes !== null && edge.actualMinutes !== undefined && edge.actualMinutes !== '') return Number(edge.actualMinutes);
  if(edge.kind === 'official') return round2(edge.officialMinutes * defaultCoefficient);
  return 0;
}

export function recalcConnections(day, route){
  const out=[];
  let previousLocation=null;

  for(const item of day.items){
    if(item.type === 'rest'){
      out.push(item);
      continue;
    }

    const next={...item};
    if(!previousLocation){
      next.incoming=null;
    }else if(next.type === 'manual-location' || previousLocation.type === 'manual-location'){
      const old=item.incoming;
      const stillSameManual = old?.kind === 'manual' && old.fromId === previousLocation.id && old.toId === next.id;
      next.incoming = stillSameManual ? {...old} : {
        kind:'manual', fromId:previousLocation.id, toId:next.id, officialMinutes:null, actualMinutes:null
      };
    }else{
      const seg=directSegment(route, previousLocation.name, next.name);
      if(seg){
        const old=item.incoming;
        const preserveOverride = old?.kind==='official' && old.from===seg.from && old.to===seg.to ? old.actualMinutes : null;
        next.incoming={
          kind:'official', from:seg.from, to:seg.to, officialMinutes:seg.minutes,
          actualMinutes:preserveOverride ?? null, source:route.source.image_url
        };
      }else{
        next.incoming={kind:'manual', fromId:previousLocation.id, toId:next.id, officialMinutes:null, actualMinutes:null};
      }
    }
    out.push(next);
    previousLocation=next;
  }
  day.items=out;
}

export function buildTimeline(day, defaultCoefficient){
  let t=clockToMinutes(day.startTime);
  const rows=[];
  let lastLocation=null;

  for(const item of day.items){
    if(item.type === 'rest'){
      const start=minutesToClock(t);
      t += Number(item.minutes)||0;
      rows.push({...item,startTime:start,endTime:minutesToClock(t)});
      continue;
    }

    let incomingActual=0;
    if(item.incoming){
      incomingActual=edgeActual(item.incoming, defaultCoefficient);
      t += incomingActual;
    }
    rows.push({...item,arrival:minutesToClock(t),incomingActual});
    lastLocation=item;
  }
  return {rows, endTime:minutesToClock(t), lastLocation};
}

export function summarizeDay(day, defaultCoefficient){
  let official=0, officialActual=0, movement=0, rest=0, manual=0;
  for(const item of day.items){
    if(item.type==='rest'){ rest += Number(item.minutes)||0; continue; }
    if(!item.incoming) continue;
    const actual=edgeActual(item.incoming, defaultCoefficient);
    movement += actual;
    if(item.incoming.kind==='official'){
      official += Number(item.incoming.officialMinutes)||0;
      officialActual += actual;
    }else{
      manual += actual;
    }
  }
  return {
    official:round2(official),
    movement:round2(movement),
    manual:round2(manual),
    rest:round2(rest),
    total:round2(movement+rest),
    coefficient:official ? round2(officialActual/official) : null
  };
}
