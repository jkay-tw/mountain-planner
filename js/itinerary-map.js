import {twd97Label} from './twd97.js?v=v0731';
import {resolveItineraryGeometry,geometryToGpx,formatTerrain,renderTerrainProfile} from './itinerary-geometry.js?v=v080rc1';

// No plan mutations or persistent state. Failure here must not block the editor.
export function createItineraryMap({host,getDays,initialData=null}){
  let data=initialData,map=null,group=null,latest=null,ready=null;
  let detailedNodes=false;
  const hiddenDays=new Set();
  const colors=['#b54b22','#146e91','#7955a5','#318354','#9b326c','#806000','#3455b0','#a43b3b','#007970','#62533c'];
  host.innerHTML='<summary>行程地圖與 GPX</summary><div class="geometry-body"><p>顯示全路網已定位節點與可對應的參考路徑。每日高度剖面可在下方展開；距離與升降以沿線 DEM 估算。</p><div class="geometry-actions"><button type="button" data-action="load">載入行程地圖</button><button type="button" data-action="fit" disabled>縮放至行程</button><button type="button" data-action="export" disabled>匯出候選 GPX</button></div><label class="node-label-control">節點標籤 <select data-node-labels><option value="name">名稱與海拔</option><option value="detail">詳細資訊（含 TWD97）</option></select></label><p data-status role="status">地圖尚未載入。</p><ul data-warnings></ul><div data-legend class="geometry-legend" aria-label="每日路線圖例"></div><div data-profile class="terrain-profiles"></div><div data-map class="itinerary-map" aria-label="行程候選路徑地圖"></div><p class="geometry-source">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>，ODbL 1.0。規劃座標另參考 TWMap、Happyman 與具來源記錄點。參考線形包含 OSM 步行路網與另有標示的山友歷史行跡；不代表即時通行狀態。缺座標或缺線形會逐段提示，統計只計已知部分。OSM 全臺快照：2026-11-03。高度來源：<a href="https://rudymap.tw/">魯地圖 DEM mix v2026</a>，約30m格網估算。</p></div>';
  const status=host.querySelector('[data-status]'),warnings=host.querySelector('[data-warnings]'),load=host.querySelector('[data-action="load"]'),exp=host.querySelector('[data-action="export"]'),fit=host.querySelector('[data-action="fit"]');
  function refresh(){
    if(!data)return;
    latest=resolveItineraryGeometry(getDays(),data);
    status.textContent=`已取得線形約 ${(latest.distanceMeters/1000).toFixed(2)} 公里｜${latest.gaps.length} 段缺漏｜${latest.unlocated.length} 個地點未定位`;
    warnings.replaceChildren();
    const notes=[...latest.unlocated.map(n=>`${n.name}：${n.note}`),...latest.gaps.map(g=>`Day ${g.dayIndex+1} ${g.from} → ${g.to}：${g.reason}`)];
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
    for(const day of latest.days){
      if(hiddenDays.has(day.dayIndex)||!day.features.length)continue;
      const longest=day.features.reduce((a,b)=>a.distanceMeters>=b.distanceMeters?a:b);
      const p=longest.coordinates[Math.floor(longest.coordinates.length/2)];
      L.circleMarker([p[1],p[0]],{radius:0,interactive:false}).bindTooltip(`Day ${day.dayIndex+1}`,{permanent:true,direction:'top',offset:[0,-16*(day.dayIndex%10)],className:'geometry-day-label'}).addTo(group);
    }
    for(const n of latest.waypoints){
      const label=document.createElement('div'),name=document.createElement('strong'),elevation=document.createElement('div'),coordinate=document.createElement('small');
      name.textContent=n.name;elevation.textContent=Number.isFinite(n.elevationMeters)?`約 ${Math.round(n.elevationMeters)} m`:'海拔未取得';coordinate.textContent=twd97Label(n.coordinate);coordinate.className='node-coordinate';label.append(name,elevation,coordinate);
      const popup=label.cloneNode(true);
      if(!detailedNodes)coordinate.hidden=true;
      L.circleMarker([n.coordinate[1],n.coordinate[0]],{radius:5,color:'#254936',fillOpacity:.9}).bindPopup(popup).bindTooltip(label,{permanent:true,direction:'right',className:'geometry-node-label',offset:[6,0]}).addTo(group);
    }
    fit.disabled=!group.getBounds().isValid();
  }
  async function initialize(){
    status.textContent='正在載入節點座標與地圖…';
    if(!data){const response=await fetch('data/geometry/planner-terrain-v1.json?v=v080rc1');if(!response.ok)throw Error('候選線形載入失敗');data=await response.json()}
    if(!window.L)throw Error('地圖元件無法載入，請檢查網路後重試。');
    if(!map){
      map=L.map(host.querySelector('[data-map]')).setView([24.388,121.266],13);
      const osm=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'}).addTo(map);
      const corridor=L.featureGroup(data.spans.filter(s=>!s.aggregate).map(s=>L.polyline(s.coordinates.map(p=>[p[1],p[0]]),{color:'#7a827a',weight:3,opacity:.55})));
      const layers=L.control.layers({'OpenStreetMap':osm},{'已收錄參考路徑（全路網）':corridor}).addTo(map);
      fetch('https://tiles.rudymap.tw/tilejson').then(r=>{if(!r.ok)throw Error();return r.json()}).then(t=>{
        if(!Array.isArray(t.tiles)||typeof t.tiles[0]!=='string'||typeof t.attribution!=='string')throw Error();
        layers.addBaseLayer(L.tileLayer(t.tiles[0],{maxZoom:t.maxzoom||18,minZoom:t.minzoom||7,attribution:t.attribution}),'魯地圖');
      }).catch(()=>{const p=document.createElement('li');p.textContent='魯地圖目前無法載入，可先使用 OpenStreetMap。';warnings.append(p)});
      group=L.featureGroup().addTo(map);
    }
    refresh();load.hidden=true;map.invalidateSize();if(group.getBounds().isValid())map.fitBounds(group.getBounds(),{padding:[25,25],maxZoom:16});
  }
  load.onclick=()=>{if(ready)return;load.disabled=true;ready=initialize().catch(error=>{status.textContent=error.message;load.disabled=false}).finally(()=>{ready=null})};
  fit.onclick=()=>{if(group?.getBounds().isValid())map.fitBounds(group.getBounds(),{padding:[25,25],maxZoom:16})};
  host.addEventListener('toggle',()=>{if(host.open&&map)requestAnimationFrame(()=>map.invalidateSize())});
  host.querySelector('[data-node-labels]').onchange=e=>{detailedNodes=e.target.value==='detail';refresh()};
  exp.onclick=()=>{
    refresh();
    const hasTracks=latest.days.some(d=>d.features.length);
    if((latest.gaps.length||latest.unlocated.length||!hasTracks)&&!confirm(`${!hasTracks?'目前僅可匯出已定位節點。':''}有 ${latest.gaps.length} 段缺少線形、${latest.unlocated.length} 個節點未定位。僅匯出已取得部分，各段分開且不補直線，是否繼續？`))return;
    const blob=new Blob([geometryToGpx(latest,data,{allowPartial:latest.gaps.length>0,allowWaypointsOnly:!hasTracks})],{type:'application/gpx+xml'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`mountain-planner-candidate${latest.gaps.length?'-partial':''}.gpx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return {update:()=>{try{refresh()}catch(error){status.textContent=error.message;exp.disabled=true}}};
}
