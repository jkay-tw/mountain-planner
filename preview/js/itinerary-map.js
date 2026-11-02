import {resolveItineraryGeometry,geometryToGpx} from './itinerary-geometry.js?v=v0727';

// No plan mutations or persistent state. Failure here must not block the editor.
export function createItineraryMap({host,getDays}){
  let data=null,map=null,group=null,latest=null,ready=null;
  const hiddenDays=new Set();
  const colors=['#b54b22','#146e91','#7955a5','#318354','#9b326c','#806000','#3455b0','#a43b3b','#007970','#62533c'];
  host.innerHTML='<summary>行程地圖與 GPX｜雪山試點</summary><div class="geometry-body"><p>依目前行程顯示 OSM 候選步道。底圖可切換；座標、距離及線形尚未現地核實。</p><div class="geometry-actions"><button type="button" data-action="load">載入行程地圖</button><button type="button" data-action="fit" disabled>縮放至行程</button><button type="button" data-action="export" disabled>匯出候選 GPX</button></div><p data-status role="status">地圖尚未載入。</p><ul data-warnings></ul><div data-legend class="geometry-legend" aria-label="每日路線圖例"></div><div data-map class="itinerary-map" aria-label="行程候選路徑地圖"></div><p class="geometry-source">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>，ODbL 1.0。圈谷底部尚未定位；三六九線形僅經附近步道，不代表山屋可入內或住宿。OSM 擷取日：2026-11-02。</p></div>';
  const status=host.querySelector('[data-status]'),warnings=host.querySelector('[data-warnings]'),load=host.querySelector('[data-action="load"]'),exp=host.querySelector('[data-action="export"]'),fit=host.querySelector('[data-action="fit"]');
  function refresh(){
    if(!data)return;
    latest=resolveItineraryGeometry(getDays(),data);
    status.textContent=`已取得線形約 ${(latest.distanceMeters/1000).toFixed(2)} 公里｜${latest.gaps.length} 段缺漏｜${latest.unlocated.length} 個試點地點未定位`;
    warnings.replaceChildren();
    const notes=[...latest.unlocated.map(n=>`${n.name}：${n.note}`),...latest.gaps.map(g=>`Day ${g.dayIndex+1} ${g.from} → ${g.to}：${g.reason}`)];
    for(const message of notes){const li=document.createElement('li');li.textContent=message;warnings.append(li)}
    exp.disabled=!latest.days.some(d=>d.features.length);exp.textContent=latest.gaps.length?'匯出部分候選 GPX':'匯出候選 GPX';
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
      const label=document.createElement('span');label.textContent=`Day ${day.dayIndex+1} ${f.from} → ${f.to}（OSM 候選）`;
      L.polyline(f.coordinates.map(p=>[p[1],p[0]]),{weight:5,color:colors[day.dayIndex%colors.length]}).bindPopup(label).addTo(group);
    }
    for(const day of latest.days){
      if(hiddenDays.has(day.dayIndex)||!day.features.length)continue;
      const longest=day.features.reduce((a,b)=>a.distanceMeters>=b.distanceMeters?a:b);
      const p=longest.coordinates[Math.floor(longest.coordinates.length/2)];
      L.circleMarker([p[1],p[0]],{radius:0,interactive:false}).bindTooltip(`Day ${day.dayIndex+1}`,{permanent:true,direction:'top',offset:[0,-16*(day.dayIndex%10)],className:'geometry-day-label'}).addTo(group);
    }
    for(const n of latest.waypoints){
      const label=document.createElement('span');label.textContent=`${n.name}（候選）${n.note}`;
      L.circleMarker([n.coordinate[1],n.coordinate[0]],{radius:5,color:'#254936',fillOpacity:.9}).bindPopup(label).addTo(group);
    }
    fit.disabled=!group.getBounds().isValid();
  }
  async function initialize(){
    status.textContent='正在載入雪山線形與地圖…';
    if(!data){const response=await fetch('data/geometry/xueshan-osm-v1.json?v=v0727');if(!response.ok)throw Error('候選線形載入失敗');data=await response.json()}
    if(!window.L)throw Error('地圖元件無法載入，請檢查網路後重試。');
    if(!map){
      map=L.map(host.querySelector('[data-map]')).setView([24.388,121.266],13);
      const osm=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'}).addTo(map);
      const corridor=L.featureGroup(data.spans.map(s=>L.polyline(s.coordinates.map(p=>[p[1],p[0]]),{color:'#7a827a',weight:3,opacity:.55})));
      const layers=L.control.layers({'OpenStreetMap':osm},{'雪山 OSM 全線候選（參考）':corridor}).addTo(map);
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
  exp.onclick=()=>{
    refresh();
    if(latest.gaps.length&&!confirm(`有 ${latest.gaps.length} 段缺少線形。僅匯出已取得部分，各段分開且不補直線，是否繼續？`))return;
    const blob=new Blob([geometryToGpx(latest,data,{allowPartial:latest.gaps.length>0})],{type:'application/gpx+xml'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`mountain-planner-xueshan-candidate${latest.gaps.length?'-partial':''}.gpx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return {update:()=>{try{refresh()}catch(error){status.textContent=error.message;exp.disabled=true}}};
}
