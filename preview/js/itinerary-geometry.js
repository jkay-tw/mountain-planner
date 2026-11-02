// Candidate geometry is deliberately separate from times, plan snapshots and routing.
export function distanceMeters(a,b){
  const r=Math.PI/180,h=Math.sin((b[1]-a[1])*r/2)**2+Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin((b[0]-a[0])*r/2)**2;
  return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));
}
const length=points=>points.slice(1).reduce((sum,p,i)=>sum+distanceMeters(points[i],p),0);
const xml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const same=(a,b)=>a?.[0]===b?.[0]&&a?.[1]===b?.[1];

export function validateGeometry(data){
  if(data?.schemaVersion!==1||!Array.isArray(data.nodes)||!Array.isArray(data.spans))throw Error('路徑資料格式不符。');
  const ids=new Set(data.nodes.map(n=>n.nodeId));
  const valid=p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
  for(const n of data.nodes)if(n.coordinate&&!valid(n.coordinate))throw Error('節點座標無效。');
  for(const s of data.spans){
    const a=data.nodes.find(n=>n.nodeId===s.fromId),b=data.nodes.find(n=>n.nodeId===s.toId);
    if(!a||!b||s.coordinates?.length<2||!s.coordinates?.every(valid)||!same(a.anchor,s.coordinates[0])||!same(b.anchor,s.coordinates.at(-1))||(s.viaNodeIds||[]).some(id=>!ids.has(id)))throw Error('路段線形或錨點無效。');
  }
  return data;
}

function officialChain(items){
  return items.slice(1).every((to,i)=>{
    const from=items[i],e=to.incoming;
    return from.type==='location'&&to.type==='location'&&e?.kind==='official'&&e.fromNodeId===from.nodeId&&e.toNodeId===to.nodeId;
  });
}

export function resolveItineraryGeometry(days,data){
  validateGeometry(data);
  const known=new Map(data.nodes.map(n=>[n.nodeId,n]));
  const result={days:[],distanceMeters:0,gaps:[],unlocated:[],waypoints:[]};
  days.forEach((day,dayIndex)=>{
    const items=(day.items||[]).filter(i=>i.type!=='rest'),features=[],gaps=[];
    for(const item of items){
      const n=known.get(item.nodeId);
      if(n?.coordinate&&!result.waypoints.some(w=>w.nodeId===n.nodeId))result.waypoints.push(n);
      if(n&&!n.coordinate&&!result.unlocated.some(w=>w.nodeId===n.nodeId))result.unlocated.push(n);
    }
    for(let i=0;i<items.length-1;){
      let match=null;
      for(const span of data.spans){
        for(const reverse of [false,true]){
          if(reverse&&!span.reversible)continue;
          const full=[span.fromId,...(span.viaNodeIds||[]),span.toId];
          if(reverse)full.reverse();
          // A historical direct official edge may omit the intermediate node.
          const sequences=full.length>2?[full,[full[0],full.at(-1)]]:[full];
          for(const sequence of sequences){
            const slice=items.slice(i,i+sequence.length);
            if(slice.length===sequence.length&&slice.every((x,j)=>x.nodeId===sequence[j])&&officialChain(slice)){
              match={span,reverse,count:sequence.length};break;
            }
          }
          if(match)break;
        }
        if(match)break;
      }
      if(match){
        const {span,reverse,count}=match;
        const coordinates=reverse?[...span.coordinates].reverse():span.coordinates.map(p=>[...p]);
        features.push({spanId:span.id,dayIndex,from:items[i].name,to:items[i+count-1].name,coordinates,distanceMeters:length(coordinates),reverse});
        i+=count-1;
      }else{
        const a=items[i],b=items[i+1];
        const gap={dayIndex,from:a.name,to:b.name,reason:!officialChain([a,b])?'手動、車行或非已連通步行路段':'缺少可對應的線形／端點位置未確認'};
        gaps.push(gap);result.gaps.push(gap);i++;
      }
    }
    const distance=features.reduce((n,f)=>n+f.distanceMeters,0);
    result.days.push({dayIndex,features,gaps,distanceMeters:distance});result.distanceMeters+=distance;
  });
  return result;
}

export function geometryToGpx(resolved,data,{allowPartial=false}={}){
  if(resolved.gaps.length&&!allowPartial)throw Error('行程含線形缺漏，請明確選擇匯出部分路徑。');
  if(!resolved.days.some(d=>d.features.length))throw Error('目前沒有可匯出的候選路徑。');
  const warnings=[...data.notes,...resolved.unlocated.map(n=>`${n.name}：未定位，未輸出該路點。`),...resolved.gaps.map(g=>`Day ${g.dayIndex+1} 缺漏 ${g.from} → ${g.to}：${g.reason}`)];
  const desc=`${data.source.attribution}; ${data.source.license}; ${data.source.copyrightUrl}; 資料擷取 ${data.source.retrievedDate}。${warnings.join(' ')}`;
  let out='<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Mountain Planner" xmlns="http://www.topografix.com/GPX/1/1">\n';
  out+=`<metadata><name>雪山行程 OSM 候選${resolved.gaps.length?'（部分路徑）':''}</name><desc>${xml(desc)}</desc><link href="${xml(data.source.copyrightUrl)}"><text>OpenStreetMap contributors — ODbL 1.0</text></link></metadata>\n`;
  for(const n of resolved.waypoints)out+=`<wpt lat="${n.coordinate[1]}" lon="${n.coordinate[0]}"><name>${xml(n.name)}（候選）</name><desc>${xml(`${n.osmRef}；${n.coordinateMethod}；${n.note}`)}</desc></wpt>\n`;
  for(const day of resolved.days){
    if(!day.features.length)continue;
    out+=`<trk><name>Day ${day.dayIndex+1}${day.gaps.length?'（部分路徑）':''}</name><desc>${xml(desc)}</desc>\n`;
    // Each source span is a separate segment. Gaps and days never gain bridges.
    for(const f of day.features)out+='<trkseg>\n'+f.coordinates.map(p=>`<trkpt lat="${p[1]}" lon="${p[0]}"/>`).join('\n')+'\n</trkseg>\n';
    out+='</trk>\n';
  }
  return out+'</gpx>\n';
}
