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
        const profile=span.profile?(reverse?span.profile.map(([d,z])=>[span.distanceMeters-d,z]).reverse():span.profile.map(p=>[...p])):null;
        features.push({profile,fromItemId:items[i].id,toItemId:items[i+count-1].id,spanId:span.id,dayIndex,from:items[i].name,to:items[i+count-1].name,coordinates,distanceMeters:length(coordinates),reverse});
        i+=count-1;
      }else{
        const a=items[i],b=items[i+1];
        const gap={dayIndex,from:a.name,to:b.name,reason:!officialChain([a,b])?'手動、車行或非已連通步行路段':'缺少可對應的線形／端點位置未確認'};
        gaps.push(gap);result.gaps.push(gap);i++;
      }
    }
    const distance=features.reduce((n,f)=>n+f.distanceMeters,0);
    const metrics=terrainMetrics(features);
    result.days.push({dayIndex,features,gaps,distanceMeters:distance,...metrics});result.distanceMeters+=distance;
  });
  return result;
}

export function geometryToGpx(resolved,data,{allowPartial=false}={}){
  if(resolved.gaps.length&&!allowPartial)throw Error('行程含線形缺漏，請明確選擇匯出部分路徑。');
  if(!resolved.days.some(d=>d.features.length))throw Error('目前沒有可匯出的候選路徑。');
  const warnings=[...data.notes,...resolved.unlocated.map(n=>`${n.name}：未定位，未輸出該路點。`),...resolved.gaps.map(g=>`Day ${g.dayIndex+1} 缺漏 ${g.from} → ${g.to}：${g.reason}`)];
  const desc=`${data.source.attribution}; ${data.source.license}; ${data.source.copyrightUrl}; 資料擷取 ${data.source.retrievedDate}。${warnings.join(' ')}`;
  let out='<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Mountain Planner" xmlns="http://www.topografix.com/GPX/1/1">\n';
  out+=`<metadata><name>登山行程 OSM 候選${resolved.gaps.length?'（部分路徑）':''}</name><desc>${xml(desc)}</desc><link href="${xml(data.source.copyrightUrl)}"><text>OpenStreetMap contributors — ODbL 1.0</text></link></metadata>\n`;
  for(const n of resolved.waypoints)out+=`<wpt lat="${n.coordinate[1]}" lon="${n.coordinate[0]}"><name>${xml(n.name)}（候選）</name><desc>${xml([n.coordinateSource?.url||n.osmRef||'使用者指定位置',n.coordinateMethod,n.note].filter(Boolean).join('；'))}</desc></wpt>\n`;
  for(const day of resolved.days){
    if(!day.features.length)continue;
    out+=`<trk><name>Day ${day.dayIndex+1}${day.gaps.length?'（部分路徑）':''}</name><desc>${xml(desc)}</desc>\n`;
    // Each source span is a separate segment. Gaps and days never gain bridges.
    for(const f of day.features)out+='<trkseg>\n'+f.coordinates.map(p=>`<trkpt lat="${p[1]}" lon="${p[0]}"/>`).join('\n')+'\n</trkseg>\n';
    out+='</trk>\n';
  }
  return out+'</gpx>\n';
}

export function terrainMetrics(features){
  if(!features.length||features.some(f=>!f.profile||f.profile.some(p=>!Number.isFinite(p[1]))))return {ascentMeters:null,descentMeters:null};
  let ascentMeters=0,descentMeters=0;
  for(const f of features)for(let i=1;i<f.profile.length;i++){const dz=f.profile[i][1]-f.profile[i-1][1];ascentMeters+=Math.max(0,dz);descentMeters+=Math.max(0,-dz)}
  return {ascentMeters,descentMeters};
}
export function formatTerrain(value,{partial=false}={}){
  if(!value)return '地形資料未收錄';
  const m=value.features?value: {...value,...terrainMetrics([value])};
  return `${partial?'已知部分':'約'} ${(m.distanceMeters/1000).toFixed(2)} km · 上升 ${m.ascentMeters===null?'未取得':Math.round(m.ascentMeters)+' m'} · 下降 ${m.descentMeters===null?'未取得':Math.round(m.descentMeters)+' m'}`;
}
export function dayTerrain(day,data){return data?resolveItineraryGeometry([day],data).days[0]:null}
export function profileNodeRows(day){
 let offset=0,rows=[];
 for(const f of day.features){
  if(f.profile?.length){
   const start={name:f.from,distanceMeters:offset,elevationMeters:f.profile[0][1]};
   if(!rows.length||rows.at(-1).name!==start.name||Math.abs(rows.at(-1).distanceMeters-offset)>.01)rows.push(start);
   rows.push({name:f.to,distanceMeters:offset+f.distanceMeters,elevationMeters:f.profile.at(-1)[1]});
  }
  offset+=f.distanceMeters;
 }
 return rows;
}
export function renderTerrainProfile(day){
 const features=day.features.filter(f=>f.profile?.length);if(!features.length)return '<p>沒有可繪製的高度資料。</p>';
 const zs=features.flatMap(f=>f.profile.map(p=>p[1])),lo=Math.floor(Math.min(...zs)/100)*100,hi=Math.max(lo+100,Math.ceil(Math.max(...zs)/100)*100),total=day.distanceMeters||1;
 const X=d=>60+700*d/total,Y=z=>300-200*(z-lo)/(hi-lo),nodes=profileNodeRows(day);
 let offset=0,paths='',grid='',labels='',marks='';const boxes=[];
 const heightStep=Math.max(100,Math.ceil((hi-lo)/500)*100),distanceStep=Math.max(.2,Math.ceil(total/1000/6*5)/5);
 for(let z=lo;z<=hi;z+=heightStep){const y=Y(z).toFixed(1);grid+=`<path d="M60 ${y}H760"/><text x="4" y="${Number(y)+4}">${z} m</text>`}
 for(let km=0;km<=total/1000;km+=distanceStep){const x=X(km*1000).toFixed(1);grid+=`<path d="M${x} 100V300"/><text x="${x}" y="322" text-anchor="middle">${km.toFixed(1)}</text>`}
 for(const f of day.features){if(f.profile)paths+=`<polyline points="${f.profile.map(([d,z])=>`${X(offset+d).toFixed(1)},${Y(z).toFixed(1)}`).join(' ')}" fill="none" stroke="#246447" stroke-width="2"><title>${xml(f.from)} → ${xml(f.to)}</title></polyline>`;offset+=f.distanceMeters}
 for(const [i,n] of nodes.entries()){
  const x=X(n.distanceMeters),y=Y(n.elevationMeters),w=Math.max(92,[...n.name].reduce((v,c)=>v+(c.charCodeAt(0)>255?12:7),0)+16),h=56,above=i%2===0;
  const box={x:Math.max(60,Math.min(780-w,x-w/2)),y:above?y-h-14:y+14,w,h};
  if(!above&&box.y+h>300)box.y=345;
  while(boxes.some(b=>box.x<b.x+b.w+8&&box.x+box.w+8>b.x&&box.y<b.y+b.h+8&&box.y+box.h+8>b.y))box.y+=above?-(h+10):h+10;
  if(!above&&box.y<335&&box.y+h>300)box.y=345;
  boxes.push(box);const tx=(box.x+8).toFixed(1),ty=(box.y+15).toFixed(1),distance=(n.distanceMeters/1000).toFixed(2),height=Math.round(n.elevationMeters).toLocaleString('en-US');
  marks+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="#246447"><title>${xml(n.name)}：${distance} km，約 ${height} m</title></circle>`;
  labels+=`<g class="profile-node-label"><path d="M${x.toFixed(1)} ${y.toFixed(1)}L${Math.max(box.x,Math.min(box.x+w,x)).toFixed(1)} ${(above?box.y+h:box.y).toFixed(1)}" stroke="#93a69b" fill="none"/><rect x="${box.x.toFixed(1)}" y="${box.y.toFixed(1)}" width="${w}" height="${h}" rx="4" fill="#fff" fill-opacity=".94" stroke="#dce6dc"/><text x="${tx}" y="${ty}" fill="#344b3d" font-size="12"><tspan x="${tx}" font-weight="650">${xml(n.name)}</tspan><tspan x="${tx}" dy="17">${distance} km</tspan><tspan x="${tx}" dy="16">約 ${height} m</tspan></text></g>`;
 }
 const top=Math.min(0,...boxes.map(b=>b.y-10)),bottom=Math.max(340,...boxes.map(b=>b.y+b.h+10));
 return `<div class="profile-chart-scroll"><svg viewBox="0 ${top} 800 ${bottom-top}" role="img" aria-label="Day ${day.dayIndex+1} 高度剖面圖"><g class="profile-grid" stroke="#dae3dc" stroke-width="1" fill="#53665a" font-size="12">${grid}</g><path d="M60 100V300H760" fill="none" stroke="#89988c"/>${paths}${labels}${marks}<text x="780" y="322" font-size="11">km</text></svg></div><p>${day.gaps.length?'橫軸為已知路徑累計距離；缺漏未計入，各段分開繪製。':'橫軸：沿山徑累計距離；縱軸與節點海拔：DEM 估算。'}</p>`;
}
