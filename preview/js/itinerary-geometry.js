import {attachmentPath} from './network-attachment.js';
import {coordinateOf,manualWarning} from './path-editor.js';
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
    if(!a||!b||s.coordinates?.length<2||!s.coordinates?.every(valid)||!same(s.fromAnchor||a.anchor,s.coordinates[0])||!same(s.toAnchor||b.anchor,s.coordinates.at(-1))||(s.viaNodeIds||[]).some(id=>!ids.has(id)))throw Error('路段線形或錨點無效。');
  }
  return data;
}

function officialChain(items){
  return items.slice(1).every((to,i)=>{
    const from=items[i],e=to.incoming;
    return from.type==='location'&&to.type==='location'&&e?.kind==='official'&&e.travelMode!=='vehicle'&&e.fromNodeId===from.nodeId&&e.toNodeId===to.nodeId;
  });
}

export function resolveItineraryGeometry(days,data){
  validateGeometry(data);
  const known=new Map(data.nodes.map(n=>[n.nodeId,n]));
  const result={days:[],distanceMeters:0,gaps:[],unlocated:[],waypoints:[]};
  days.forEach((day,dayIndex)=>{
    const items=(day.items||[]).filter(i=>i.type!=='rest'),features=[],gaps=[];
    for(const item of items){
      const n=item.type==='manual-location'&&item.coordinate?{nodeId:item.id,name:item.name,coordinate:item.coordinate,note:'使用者指定座標',coordinateMethod:manualWarning}:known.get(item.nodeId);
      const suppressed=['ignored','vehicle-only'].includes(n?.coordinatePolicy);
      const index=items.indexOf(item),isVehicle=e=>e?.travelMode==='vehicle'||e?.kind==='vehicle';
      const vehicleOnly=items.length>1&&(index===0||isVehicle(item.incoming))&&(index===items.length-1||isVehicle(items[index+1]?.incoming));
      if(n?.coordinate&&!suppressed&&!vehicleOnly&&!result.waypoints.some(w=>w.nodeId===n.nodeId))result.waypoints.push(n);
      if(n&&!n.coordinate&&!suppressed&&!result.unlocated.some(w=>w.nodeId===n.nodeId))result.unlocated.push(n);
    }
    for(let i=0;i<items.length-1;){
      if(items[i+1].incoming?.travelMode==='vehicle'||items[i+1].incoming?.kind==='vehicle'){i++;continue;}
      const a=items[i],b=items[i+1],edit=b.pathEdit?.fromItemId===a.id?b.pathEdit:null;
      const ca=coordinateOf(a,data),cb=coordinateOf(b,data);
      if(edit?.mode==='auto'&&!edit.controls.length&&edit.networkNodeIds?.length&&ca&&cb){
        const ids=edit.networkNodeIds;
        const temp={items:ids.map((nodeId,j)=>({id:'network-'+j,type:'location',nodeId,name:known.get(nodeId)?.name||nodeId,incoming:j?{kind:'official',fromNodeId:ids[j-1],toNodeId:nodeId}:null}))};
        const network=resolveItineraryGeometry([temp],data).days[0];
        const expectedA=a.type==='location'?a.nodeId:a.networkConnection?.nodeId,expectedB=b.type==='location'?b.nodeId:b.networkConnection?.nodeId;
        if(ids[0]===expectedA&&ids.at(-1)===expectedB&&!network.gaps.length){
          const addAttachment=(item,point,reverse)=>{
            if(item.type==='location')return;
            const binding=item.networkConnection,span=data.spans.find(s=>s.id===binding?.spanId);
            if(!span)throw Error('連接路段來源不存在，請重新確認');
            let coordinates=attachmentPath(point,span,binding.nodeId).coordinates;
            if(reverse)coordinates=coordinates.slice().reverse();
            features.push({manual:true,profile:null,sourceName:manualWarning+' 使用者確認連接參考路段 '+span.id,sourceUrl:span.sourceUrl||data.source.url,coordinates,distanceMeters:length(coordinates),fromItemId:a.id,toItemId:b.id,viaItemIds:[],dayIndex,from:a.name,to:b.name});
          };
          addAttachment(a,ca,false);
          features.push(...network.features.map(f=>({...f,dayIndex,fromItemId:a.id,toItemId:b.id,viaItemIds:[]})));
          addAttachment(b,cb,true);i++;continue;
        }
      }
      const explicit=edit&&(edit.mode==='straight'||edit.controls.length);
      const fallback=b.incoming?.kind==='manual'&&b.incoming.fromId===a.id&&b.incoming.toId===b.id&&b.incoming.connectionStatus!=='owner-confirmed';
      if((explicit||fallback)&&ca&&cb){
        const coordinates=(edit?.shape?.length?edit.shape.map(p=>p.coordinate):[ca,...(edit?.controls||[]).map(c=>c.coordinate),cb]).map(p=>[...p]);
        features.push({profile:null,manual:true,sourceName:manualWarning+(edit?.candidateSource?' 參考線形：'+edit.candidateSource.name+'（'+edit.candidateSource.spanId+'）':''),sourceUrl:edit?.candidateSource?.url||null,fromItemId:a.id,toItemId:b.id,viaItemIds:[],dayIndex,from:a.name,to:b.name,coordinates,distanceMeters:length(coordinates)});i++;continue;
      }
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
            const ownerChain=span.ownerConfirmed&&slice.length===2&&slice[1].incoming?.kind==='manual'&&slice[1].incoming.connectionStatus==='owner-confirmed'&&slice[1].incoming.fromNodeId===slice[0].nodeId&&slice[1].incoming.toNodeId===slice[1].nodeId;
            if(slice.length===sequence.length&&slice.every((x,j)=>x.nodeId===sequence[j])&&(officialChain(slice)||ownerChain)){
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
        features.push({profile,routingAmbiguity:span.routingAmbiguity||null,sourceName:span.sourceName||'OpenStreetMap',sourceUrl:span.sourceUrl||data.source.url,fromItemId:items[i].id,toItemId:items[i+count-1].id,viaItemIds:items.slice(i+1,i+count-1).map(x=>x.id),intermediateCoordinatesUnknown:!!span.intermediateCoordinatesUnknown,spanId:span.id,dayIndex,from:items[i].name,to:items[i+count-1].name,coordinates,distanceMeters:length(coordinates),reverse});
        i+=count-1;
      }else{
        const a=items[i],b=items[i+1];
        const pair=(data.coverage?.routeDataGaps||[]).find(g=>(g.fromId===a.nodeId&&g.toId===b.nodeId)||(g.toId===a.nodeId&&g.fromId===b.nodeId));
        const labels={'missing-coordinate':'端點座標待補','no-OSM-anchor-within-120m':'附近尚無可對應步道','disconnected-OSM-topology':'步道圖資未連通','OSM-route-detour-needs-review':'來源路徑繞行過遠，待核對','different-nodes-share-one-anchor-needs-review':'不同節點對應同一錨點，待核對','route-DEM-unavailable':'沿線高程資料缺失'};
        const gap={dayIndex,from:a.name,to:b.name,reason:labels[pair?.reason]||(!officialChain([a,b])?'手動、車行或非已連通步行路段':'缺少可對應的線形／端點位置未確認')};
        gaps.push(gap);result.gaps.push(gap);i++;
      }
    }
    const distance=features.reduce((n,f)=>n+f.distanceMeters,0);
    const metrics=terrainMetrics(features);
    result.days.push({dayIndex,features,gaps,distanceMeters:distance,...metrics});result.distanceMeters+=distance;
  });
  return result;
}

export function geometryToGpx(resolved,data,{allowPartial=false,allowWaypointsOnly=false}={}){
  if(resolved.gaps.length&&!allowPartial)throw Error('行程含線形缺漏，請明確選擇匯出部分路徑。');
  if(!resolved.days.some(d=>d.features.length)&&!(allowWaypointsOnly&&resolved.waypoints.length))throw Error('目前沒有可匯出的候選路徑。');
  const warnings=[...(data.notes||[]),...resolved.unlocated.map(n=>`${n.name}：未定位，未輸出該路點。`),...resolved.days.flatMap(d=>d.features.filter(f=>f.routingAmbiguity).map(f=>`${f.from} → ${f.to}：${f.routingAmbiguity}`)),...resolved.gaps.map(g=>`Day ${g.dayIndex+1} 缺漏 ${g.from} → ${g.to}：${g.reason}`)];
  const desc=`${data.source.attribution}; ${data.source.license}; ${data.source.copyrightUrl}; 資料擷取 ${data.source.retrievedDate}。${warnings.join(' ')}`;
  const extra=(data.additionalSources||[]).map(s=>`${s.name}；${s.url}；${s.notice}`).join(' ');
  let out='<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Mountain Planner" xmlns="http://www.topografix.com/GPX/1/1">\n';
  out+=`<metadata><name>登山行程參考路徑${resolved.gaps.length?'（部分資料）':''}</name><desc>${xml(desc+extra)}</desc><link href="${xml(data.source.copyrightUrl)}"><text>OpenStreetMap contributors — ODbL 1.0</text></link></metadata>\n`;
  for(const n of resolved.waypoints)out+=`<wpt lat="${n.coordinate[1]}" lon="${n.coordinate[0]}">${Number.isFinite(n.elevationMeters)?`<ele>${n.elevationMeters}</ele>`:''}<name>${xml(n.name)}（候選）</name><desc>${xml([n.coordinateSource?.url||n.osmRef||'使用者指定位置',n.coordinateMethod,n.note].filter(Boolean).join('；'))}</desc></wpt>\n`;
  for(const day of resolved.days){
    if(!day.features.length)continue;
    out+=`<trk><name>Day ${day.dayIndex+1}${day.gaps.length?'（部分路徑）':''}</name><desc>${xml(desc+' 路段來源：'+[...new Set(day.features.map(f=>f.sourceName+' '+(f.sourceUrl||'')))].join('；'))}</desc>\n`;
    // Each source span is a separate segment. Gaps and days never gain bridges.
    for(const f of day.features){
      let walked=0,pi=0;
      out+='<trkseg>\n'+f.coordinates.map((p,i)=>{
        if(i)walked+=distanceMeters(f.coordinates[i-1],p);
        let z=null;
        if(f.profile?.length){
          while(pi<f.profile.length-2&&f.profile[pi+1][0]<walked)pi++;
          const [da,za]=f.profile[pi],[db,zb]=f.profile[Math.min(pi+1,f.profile.length-1)];
          z=za+(zb-za)*(db===da?0:Math.max(0,Math.min(1,(walked-da)/(db-da))));
        }
        return `<trkpt lat="${p[1]}" lon="${p[0]}">${Number.isFinite(z)?`<ele>${z.toFixed(1)}</ele>`:''}</trkpt>`;
      }).join('\n')+'\n</trkseg>\n';
    }
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
  return `${m.features?.some(f=>f.manual)||m.manual?'含手動水平距離・':''}${partial?'已知部分':'約'} ${(m.distanceMeters/1000).toFixed(2)} km · 上升 ${m.ascentMeters===null?'未取得':Math.round(m.ascentMeters)+' m'} · 下降 ${m.descentMeters===null?'未取得':Math.round(m.descentMeters)+' m'}`;
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
export const terrainDayColor=index=>['#b54b22','#146e91','#7955a5','#318354','#9b326c','#806000','#3455b0','#a43b3b','#007970','#62533c'][(index||0)%10];
// Four bounded lanes; dense clusters use a compact numbered key instead.
export function layoutProfileLabels(nodes,total,curve=[]){
 const boxes=[];
 for(const node of nodes){
  const x=60+700*node.distanceMeters/(total||1),w=Math.min(190,Math.max(124,[...node.name].reduce((v,c)=>v+(c.charCodeAt(0)>255?12:7),0)+16));
  const choices=[];
  const lanes=[(node.plotY??200)-60,(node.plotY??200)+24,34,-8,336,378].filter(y=>y<70||y>320||(y>=105&&y<=255));
  for(const y of lanes)for(const dx of [0,-16,16,-32,32,-48,48,-64,64,-80,80]){
   const left=Math.max(60,Math.min(760-w,x-w/2+dx));
   if(Math.abs(left+w/2-x)>100)continue;
   const box={x:left,y,w,h:36};
   if(!boxes.some(b=>y<b.y+b.h+6&&y+36+6>b.y&&left<b.x+b.w+6&&left+w+6>b.x)&&!nodes.some(n=>{const nx=60+700*n.distanceMeters/(total||1),ny=n.plotY??200;return nx>=left-5&&nx<=left+w+5&&ny>=y-5&&ny<=y+41})&&!curve.some(p=>p.x>=left-3&&p.x<=left+w+3&&p.y>=y-3&&p.y<=y+39))choices.push({...box,score:Math.abs(left+w/2-x)+Math.abs(y+18-(node.plotY??200))*.18});
  }
  if(!choices.length)return {numbered:true,boxes:[]};
  choices.sort((a,b)=>a.score-b.score);boxes.push(choices[0]);
 }
 return {numbered:false,boxes};
}
export function renderTerrainProfile(day){
 const features=day.features.filter(f=>f.profile?.length);if(!features.length)return '<p>沒有可繪製的高度資料。</p>';
 const zs=features.flatMap(f=>f.profile.map(p=>p[1])),lo=Math.floor(Math.min(...zs)/100)*100,hi=Math.max(lo+100,Math.ceil(Math.max(...zs)/100)*100),total=day.distanceMeters||1;
 const X=d=>60+700*d/total,Y=z=>300-200*(z-lo)/(hi-lo),nodes=profileNodeRows(day);
 let curveOffset=0;const curve=[];for(const f of day.features){if(f.profile)for(const [d,z] of f.profile)curve.push({x:X(curveOffset+d),y:Y(z)});curveOffset+=f.distanceMeters}
 const color=terrainDayColor(day.dayIndex),layout=layoutProfileLabels(nodes.map(n=>({...n,plotY:Y(n.elevationMeters)})),total,curve);
 let offset=0,paths='',grid='',labels='',marks='';const boxes=layout.boxes;
 const heightStep=Math.max(100,Math.ceil((hi-lo)/500)*100),distanceStep=Math.max(.2,Math.ceil(total/1000/6*5)/5);
 for(let z=lo;z<=hi;z+=heightStep){const y=Y(z).toFixed(1);grid+=`<path d="M60 ${y}H760"/><text stroke="none" x="4" y="${Number(y)+4}">${z} m</text>`}
 for(let km=0;km<=total/1000;km+=distanceStep){const x=X(km*1000).toFixed(1);grid+=`<path d="M${x} 100V300"/><text stroke="none" x="${x}" y="322" text-anchor="middle">${km.toFixed(1)}</text>`}
 for(const f of day.features){if(f.profile){const points=f.profile.map(([d,z])=>`${X(offset+d).toFixed(1)},${Y(z).toFixed(1)}`).join(' ');paths+=`<polygon points="${X(offset).toFixed(1)},300 ${points} ${X(offset+f.distanceMeters).toFixed(1)},300" fill="${color}" fill-opacity=".12"/><polyline points="${points}" fill="none" stroke="${color}" stroke-linejoin="round" stroke-width="2.5"><title>${xml(f.from)} → ${xml(f.to)}</title></polyline>`}offset+=f.distanceMeters}
 for(const [i,n] of nodes.entries()){
  const x=X(n.distanceMeters),y=Y(n.elevationMeters),distance=(n.distanceMeters/1000).toFixed(2),height=Math.round(n.elevationMeters).toLocaleString('en-US');
  marks+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${color}" stroke="#fff" stroke-width="1.5"><title>${xml(n.name)}：${distance} km，約 ${height} m</title></circle>`;
  if(layout.numbered){
   const col=i%3,row=Math.floor(i/3),lx=36+col*252,ly=348+row*38;
   labels+=`<g class="profile-node-label"><text x="${lx}" y="${ly}" font-size="12" fill="#344b3d"><tspan font-weight="650">${i+1}. ${xml(n.name)}</tspan><tspan x="${lx}" dy="15" font-size="11">${distance} km · 約 ${height} m</tspan></text></g>`;
   marks+=`<text x="${x.toFixed(1)}" y="${(y-12-(i%3)*15).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="${color}" stroke="#fff" stroke-width="3" paint-order="stroke">${i+1}</text>`;
  }else{
   const box=boxes[i],above=box.y+box.h<y,tx=(box.x+8).toFixed(1),ty=(box.y+13).toFixed(1);
   labels+=`<g class="profile-node-label"><path d="M${x.toFixed(1)} ${y.toFixed(1)}L${Math.max(box.x,Math.min(box.x+box.w,x)).toFixed(1)} ${(above?box.y+box.h:box.y).toFixed(1)}" stroke="#a6b7af" fill="none"/><rect x="${box.x.toFixed(1)}" y="${box.y}" width="${box.w}" height="36" rx="5" fill="#fff" fill-opacity=".96" stroke="#dce6dc"/><text x="${tx}" y="${ty}" fill="#344b3d" font-size="12"><tspan x="${tx}" font-weight="650">${xml(n.name)}</tspan><tspan x="${tx}" dy="16" font-size="10.5">${distance} km · 約 ${height} m</tspan></text></g>`;
  }
 }
 const top=-14,compact=nodes.length<=3&&!layout.numbered,chartShift=compact?45:0;
 const bottom=(layout.numbered?Math.max(340,348+Math.ceil(nodes.length/3)*38):432)-chartShift;
 const titleTop=-80,dayNumber=(day.dayIndex||0)+1;
 const summary=`${(day.distanceMeters/1000).toFixed(2)} km   ↗ ${(day.ascentMeters==null?'無資料':Math.round(day.ascentMeters))} m   ↘ ${(day.descentMeters==null?'無資料':Math.round(day.descentMeters))} m${day.gaps.length?'（已知部分）':''}`;
 return `<section class="profile-card"><div class="profile-export-actions"><button type="button" class="secondary" data-profile-export="copy">複製圖片</button><button type="button" class="secondary" data-profile-export="download">下載 PNG</button><span role="status" data-profile-export-status></span></div><div class="profile-chart-scroll"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${titleTop} 800 ${bottom-titleTop}" role="img" aria-label="Day ${dayNumber} 高度剖面圖" style="font-family:system-ui,'Noto Sans TC',sans-serif"><rect x="0" y="${titleTop}" width="800" height="${bottom-titleTop}" rx="12" fill="#fff"/><rect x="20" y="${top-42}" width="5" height="32" rx="2" fill="${color}"/><text x="36" y="${top-24}" font-size="18" font-weight="700" fill="#243d35">Day ${dayNumber} · 高度剖面</text><text x="36" y="${top-4}" font-size="12" fill="#53665a">${summary}</text><g transform="translate(0,-${chartShift})"><g class="profile-grid" stroke="#e5ebe9" stroke-width="1" fill="#60736b" font-size="12">${grid}</g><path d="M60 100V300H760" fill="none" stroke="#89988c"/>${paths}${labels}${marks}<text x="780" y="322" fill="#60736b" font-size="11">km</text></g><text x="760" y="${bottom-3}" text-anchor="end" font-size="10" fill="#60736b">Mountain Planner · DEM 估算${day.gaps.length?' · 僅計已知部分':''}</text></svg></div><p>${day.gaps.length?'橫軸為已知路徑累計距離；缺漏未計入，各段分開繪製。':'橫軸：沿山徑累計距離；縱軸與節點海拔：DEM 估算。'}${day.features.some(f=>f.intermediateCoordinatesUnknown)?' 含跨未定位節點的連續參考線形；中間節點不標示推估位置。':''}</p></section>`;
}
