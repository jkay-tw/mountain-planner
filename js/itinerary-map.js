import {chooseSaveTarget,writeDownload,reportSaveError} from './save-file.js?v=v086';
import {placeMapLabels} from './map-label-layout.js?v=aliases1';
import {twd97Label} from './twd97.js?v=v0731';
import {nodeAliases} from './node-aliases.js?v=aliases1';
import {resolveItineraryGeometry,geometryToGpx,formatTerrain,renderTerrainProfile,terrainDayColor} from './itinerary-geometry.js?v=v084';

// No plan mutations or persistent state. Failure here must not block the editor.
export function createItineraryMap({host,getDays,initialData=null,getNode=()=>null}){
  let data=initialData,map=null,group=null,labelGroup=null,latest=null,ready=null,selectedNode=null;
  const hiddenDays=new Set();
  const colors=Array.from({length:10},(_,i)=>terrainDayColor(i));
  host.innerHTML='<summary>行程地圖與 GPX</summary><div class="geometry-body"><div class="geometry-actions"><button type="button" data-action="load">載入行程地圖</button><button type="button" data-action="fit" disabled>縮放至行程</button><button type="button" data-action="export" disabled>匯出候選 GPX</button><button type="button" data-toggle-profiles aria-expanded="false">每日剖面</button></div><p class="geometry-label-hint">點選節點標籤，可查看海拔與座標</p><div class="geometry-summary"><p data-status role="status">地圖尚未載入。</p><div data-legend class="geometry-legend" aria-label="每日路線圖例"></div></div><ul data-warnings></ul><div data-profile class="terrain-profiles" hidden></div><div data-map class="itinerary-map" aria-label="行程候選路徑地圖"></div><div class="geometry-source"><span>地圖 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · 高程：<a href="https://rudymap.tw/">魯地圖 DEM</a></span><details><summary>資料來源與說明</summary><p>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>，ODbL 1.0。規劃座標另參考 TWMap、Happyman 與具來源記錄點。參考線形包含 OSM 步行路網與另有標示的山友歷史行跡；不代表即時通行狀態。缺座標或缺線形會逐段提示，統計只計已知部分。OSM 全臺快照：2026-11-03。高度來源：<a href="https://rudymap.tw/">魯地圖 DEM mix v2026</a>，約30m格網估算。</p></details></div></div>';
  const status=host.querySelector('[data-status]'),warnings=host.querySelector('[data-warnings]'),load=host.querySelector('[data-action="load"]'),exp=host.querySelector('[data-action="export"]'),fit=host.querySelector('[data-action="fit"]');
  const profiles=host.querySelector('[data-profile]'),profileToggle=host.querySelector('[data-toggle-profiles]');
  profileToggle.onclick=()=>{profiles.hidden=!profiles.hidden;profileToggle.setAttribute('aria-expanded',String(!profiles.hidden))};
  function refresh(){
    if(!data)return;
    latest=resolveItineraryGeometry(getDays(),data);
    status.textContent=`${(latest.distanceMeters/1000).toFixed(2)} km · ${latest.gaps.length||latest.unlocated.length?`${latest.gaps.length} 段缺漏 · ${latest.unlocated.length} 點未定位`:'路徑完整'}`;
    warnings.replaceChildren();
    const notes=[...latest.unlocated.map(n=>`${n.name}：${n.note}`),...latest.days.flatMap(d=>d.features.filter(f=>f.routingAmbiguity).map(f=>`Day ${d.dayIndex+1} ${f.from} → ${f.to}：${f.routingAmbiguity}`)),...latest.gaps.map(g=>`Day ${g.dayIndex+1} ${g.from} → ${g.to}：${g.reason}`)];
    for(const message of notes){const li=document.createElement('li');li.textContent=message;warnings.append(li)}
    const hasTracks=latest.days.some(d=>d.features.length);
    exp.disabled=!hasTracks&&!latest.waypoints.length;exp.textContent=!hasTracks?'匯出節點 GPX':latest.gaps.length?'匯出部分參考 GPX':'匯出參考 GPX';
    host.querySelector('[data-profile]').innerHTML=latest.days.filter(d=>d.features.length||d.gaps.length).map(d=>`<details><summary>Day ${d.dayIndex+1} 高度剖面 · ${formatTerrain(d,{partial:!!d.gaps.length})}</summary>${renderTerrainProfile(d)}</details>`).join('');
    const legend=host.querySelector('[data-legend]');legend.replaceChildren();
    for(const day of latest.days){
      if(!day.features.length&&!day.gaps.length)continue;
      const label=document.createElement('label'),checkbox=document.createElement('input'),swatch=document.createElement('span'),text=document.createElement('span');
      checkbox.type='checkbox';checkbox.checked=!hiddenDays.has(day.dayIndex);checkbox.setAttribute('aria-label',`顯示 Day ${day.dayIndex+1} 路線`);
      checkbox.onchange=()=>{if(checkbox.checked)hiddenDays.delete(day.dayIndex);else hiddenDays.add(day.dayIndex);refresh()};
      swatch.className='geometry-swatch';swatch.style.backgroundColor=colors[day.dayIndex%colors.length];
      text.textContent=`Day ${day.dayIndex+1} · ${(day.distanceMeters/1000).toFixed(2)} km${day.gaps.length?` · ${day.gaps.length} 段缺漏`:''}`;
      label.append(checkbox,swatch,text);legend.append(label);
    }
    if(!map)return;
    group.clearLayers();
    for(const day of latest.days)for(const f of day.features){
      if(hiddenDays.has(day.dayIndex))continue;
      const label=document.createElement('span');label.textContent=`Day ${day.dayIndex+1} ${f.from} → ${f.to}（${f.sourceName} 參考）`;
      if(f.sourceUrl){const a=document.createElement('a');a.href=f.sourceUrl;a.target='_blank';a.rel='noreferrer';a.textContent=' 查看來源';label.append(a)}
      L.polyline(f.coordinates.map(p=>[p[1],p[0]]),{weight:5,color:colors[day.dayIndex%colors.length]}).bindPopup(label).addTo(group);
    }
    const visibleIds=new Set(getDays().flatMap((d,i)=>hiddenDays.has(i)?[]:(d.items||[]).filter(x=>x.type==='location').map(x=>x.nodeId)));
    const visible=latest.waypoints.filter(n=>visibleIds.has(n.nodeId));
    if(selectedNode&&!visible.some(n=>n.nodeId===selectedNode))selectedNode=null;
    for(const n of visible){
      const marker=L.circleMarker([n.coordinate[1],n.coordinate[0]],{radius:5,color:'#254936',fillOpacity:.9}).addTo(group);
      marker.on('click',()=>{selectedNode=selectedNode===n.nodeId?null:n.nodeId;drawLabels()});
    }
    drawLabels();
    fit.disabled=!group.getBounds().isValid();
  }
  function drawLabels(){
    if(!map||!latest||!labelGroup)return;
    labelGroup.clearLayers();
    const visibleIds=new Set(getDays().flatMap((d,i)=>hiddenDays.has(i)?[]:(d.items||[]).filter(x=>x.type==='location').map(x=>x.nodeId)));
    const nodes=latest.waypoints.filter(n=>visibleIds.has(n.nodeId));
    const point=n=>map.latLngToContainerPoint([n.coordinate[1],n.coordinate[0]]);
    const points=nodes.map(point),segments=[];
    for(const day of latest.days)if(!hiddenDays.has(day.dayIndex))for(const f of day.features){
      const coords=f.coordinates.map(p=>map.latLngToContainerPoint([p[1],p[0]]));
      for(let i=1;i<coords.length;i++)segments.push([coords[i-1],coords[i]]);
    }
    function measure(element){
      element.classList.add('geometry-label-measure');host.append(element);
      const rect=element.getBoundingClientRect();element.remove();element.classList.remove('geometry-label-measure');
      return {w:Math.ceil(rect.width),h:Math.ceil(rect.height)};
    }
    function nodeLabel(n){
      const button=document.createElement('button');button.type='button';button.className='geometry-map-label geometry-map-node';
      const title=document.createElement('span');title.textContent=n.name;button.append(title);
      const selected=n.nodeId===selectedNode;button.setAttribute('aria-expanded',String(selected));
      if(selected){const height=document.createElement('span');height.className='geometry-label-height';height.textContent=Number.isFinite(n.elevationMeters)?`約 ${Math.round(n.elevationMeters).toLocaleString('en-US')} m`:'高度未取得';button.append(height);
        const coord=document.createElement('span');coord.className='geometry-label-coordinate';coord.textContent=twd97Label(n.coordinate);button.append(coord);
        const aliases=nodeAliases(getNode(n.nodeId));
        if(aliases.length){const details=document.createElement('span');details.className='geometry-label-aliases';details.textContent='別稱：'+aliases.join('、');button.append(details)}
      }
      button.onclick=e=>{e.stopPropagation();selectedNode=selected?null:n.nodeId;drawLabels()};
      return {element:button,point:point(n),selected,...measure(button)};
    }
    const selected=nodes.filter(n=>n.nodeId===selectedNode).map(nodeLabel);
    const dayLabels=latest.days.filter(d=>!hiddenDays.has(d.dayIndex)&&d.features.length).map(day=>{
      const longest=day.features.reduce((a,b)=>a.distanceMeters>=b.distanceMeters?a:b),p=longest.coordinates[Math.floor(longest.coordinates.length/2)];
      const element=document.createElement('span');element.className='geometry-map-label geometry-map-day';element.textContent=`Day ${day.dayIndex+1}`;element.style.borderColor=colors[day.dayIndex%colors.length];
      return {element,point:map.latLngToContainerPoint([p[1],p[0]]),dayOffset:day.dayIndex*25,...measure(element)};
    });
    const labels=[...selected,...dayLabels,...nodes.filter(n=>n.nodeId!==selectedNode).map(nodeLabel)];
    for(const item of placeMapLabels(labels,points,segments,map.getSize())){
      const {box,element}=item;
      const icon=L.divIcon({className:'geometry-label-icon',html:element,iconSize:[box.w,box.h],iconAnchor:[0,0]});
      L.marker(map.containerPointToLatLng([box.x,box.y]),{icon,keyboard:false}).addTo(labelGroup);
    }
  }
  async function initialize(){
    status.textContent='正在載入節點座標與地圖…';
    if(!data){const response=await fetch('data/geometry/planner-terrain-v1.json?v=v084');if(!response.ok)throw Error('候選線形載入失敗');data=await response.json()}
    if(!window.L)throw Error('地圖元件無法載入，請檢查網路後重試。');
    if(!map){
      map=L.map(host.querySelector('[data-map]')).setView([24.388,121.266],13);
      map.on('zoomend moveend',drawLabels);
      const osm=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'}).addTo(map);
      const corridor=L.featureGroup(data.spans.filter(s=>!s.aggregate).map(s=>L.polyline(s.coordinates.map(p=>[p[1],p[0]]),{color:'#7a827a',weight:3,opacity:.55})));
      const layers=L.control.layers({'OpenStreetMap':osm},{'已收錄參考路徑（全路網）':corridor}).addTo(map);
      fetch('https://tiles.rudymap.tw/tilejson').then(r=>{if(!r.ok)throw Error();return r.json()}).then(t=>{
        if(!Array.isArray(t.tiles)||typeof t.tiles[0]!=='string'||typeof t.attribution!=='string')throw Error();
        layers.addBaseLayer(L.tileLayer(t.tiles[0],{maxZoom:t.maxzoom||18,minZoom:t.minzoom||7,attribution:t.attribution}),'魯地圖');
      }).catch(()=>{const p=document.createElement('li');p.textContent='魯地圖目前無法載入，可先使用 OpenStreetMap。';warnings.append(p)});
      group=L.featureGroup().addTo(map);labelGroup=L.layerGroup().addTo(map);
    }
    refresh();load.hidden=true;map.invalidateSize();if(group.getBounds().isValid())map.fitBounds(group.getBounds(),{padding:[25,25],maxZoom:16});
  }
  function startLoading(){
    if(ready||load.hidden)return;
    load.hidden=true;load.disabled=true;
    ready=initialize().catch(error=>{status.textContent=error.message;load.textContent='重新載入地圖';load.hidden=false;load.disabled=false}).finally(()=>{ready=null});
  }
  load.onclick=startLoading;
  fit.onclick=()=>{if(group?.getBounds().isValid())map.fitBounds(group.getBounds(),{padding:[25,25],maxZoom:16})};
  host.addEventListener('toggle',event=>{if(event.target!==host||!host.open)return;if(map&&load.hidden)requestAnimationFrame(()=>map.invalidateSize());else startLoading()});
  if(host.open)startLoading();
  exp.onclick=async()=>{
    refresh();
    const hasTracks=latest.days.some(d=>d.features.length);
    if((latest.gaps.length||latest.unlocated.length||!hasTracks)&&!confirm(`${!hasTracks?'目前僅可匯出已定位節點。':''}有 ${latest.gaps.length} 段缺少線形、${latest.unlocated.length} 個節點未定位。僅匯出已取得部分，各段分開且不補直線，是否繼續？`))return;
    const name=`mountain-planner-candidate${latest.gaps.length?'-partial':''}.gpx`;
    try{const handle=await chooseSaveTarget(name,'application/gpx+xml','gpx');const blob=new Blob([geometryToGpx(latest,data,{allowPartial:latest.gaps.length>0,allowWaypointsOnly:!hasTracks})],{type:'application/gpx+xml'});await writeDownload(blob,name,handle)}catch(error){reportSaveError(error)}
  };
  return {update:()=>{try{refresh()}catch(error){status.textContent=error.message;exp.disabled=true}}};
}
