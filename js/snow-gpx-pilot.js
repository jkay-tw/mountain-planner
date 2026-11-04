// Standalone GPX visual inspection: no itinerary writes and no uploaded files.
export function distanceMeters(a,b){
  const rad=Math.PI/180,la=a.lat*rad,lb=b.lat*rad;
  const h=Math.sin((lb-la)/2)**2+Math.cos(la)*Math.cos(lb)*Math.sin((b.lon-a.lon)*rad/2)**2;
  return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));
}
export function summarizeTracks(segments){
  let distance=0,maxGap=0,count=0;
  for(const segment of segments){count+=segment.length;for(let i=1;i<segment.length;i++){
    const d=distanceMeters(segment[i-1],segment[i]);distance+=d;maxGap=Math.max(maxGap,d);
  }}
  return {points:count,distance,maxGap};
}
export function parseGpx(doc){
  if(doc.querySelector('parsererror')||doc.documentElement?.localName!=='gpx')throw Error('檔案不是有效的 GPX。');
  const validPoint=element=>{
    const lat=Number(element.getAttribute('lat')),lon=Number(element.getAttribute('lon'));
    if(!element.hasAttribute('lat')||!element.hasAttribute('lon')||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw Error('GPX 含無效的經緯度。');
    return {lat,lon};
  };
  const segments=[...doc.getElementsByTagNameNS('*','trkseg')].map(seg=>[...seg.getElementsByTagNameNS('*','trkpt')].map(validPoint)).filter(s=>s.length>0);
  if(!segments.some(s=>s.length>=2))throw Error('檔案沒有可顯示的實走軌跡（trkpt）。');
  const waypoints=[...doc.getElementsByTagNameNS('*','wpt')].map(w=>({...validPoint(w),name:w.getElementsByTagNameNS('*','name')[0]?.textContent?.slice(0,120)||'未命名路點'}));
  return {segments,waypoints};
}
if(typeof document!=='undefined'){
  const status=document.getElementById('status'),input=document.getElementById('file');
  if(!window.L){status.textContent='地圖元件載入失敗，請檢查網路後重新開啟。';input.disabled=true;}
  else{
    const map=L.map('map').setView([24.388,121.265],12);
    const osm=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'}).addTo(map);
    const layers=L.control.layers({'OpenStreetMap':osm}).addTo(map);
    fetch('https://tiles.rudymap.tw/tilejson').then(r=>{if(!r.ok)throw Error();return r.json()}).then(t=>{
      if(!Array.isArray(t.tiles)||typeof t.tiles[0]!=='string'||typeof t.attribution!=='string')throw Error();
      layers.addBaseLayer(L.tileLayer(t.tiles[0],{maxZoom:t.maxzoom||18,minZoom:t.minzoom||7,attribution:t.attribution}),'魯地圖');
    }).catch(()=>{status.textContent='魯地圖目前無法載入；仍可使用 OpenStreetMap 與匯入 GPX。';});
    let group=L.featureGroup().addTo(map);
    input.addEventListener('change',async()=>{
      try{
        const file=input.files?.[0];if(!file)return;
        if(file.size>10*1024*1024)throw Error('GPX 檔案過大，請選擇 10 MB 以下的檔案。');
        const parsed=parseGpx(new DOMParser().parseFromString(await file.text(),'application/xml'));
        const summary=summarizeTracks(parsed.segments),next=L.featureGroup();
        for(const seg of parsed.segments)if(seg.length>=2)L.polyline(seg.map(p=>[p.lat,p.lon]),{color:'#c75324',weight:4}).addTo(next);
        for(const p of parsed.waypoints){const label=document.createElement('span');label.textContent=p.name;L.circleMarker([p.lat,p.lon],{radius:5,color:'#165d86',fillOpacity:.9}).bindPopup(label).addTo(next)}
        group.remove();group=next.addTo(map);map.fitBounds(group.getBounds(),{padding:[25,25],maxZoom:16});
        status.textContent=`${summary.points} 個軌跡點｜${parsed.segments.length} 段｜軌跡約 ${(summary.distance/1000).toFixed(2)} 公里｜${parsed.waypoints.length} 個路點｜最大相鄰點間距 ${Math.round(summary.maxGap)} 公尺`;
      }catch(error){status.textContent=error.message||'無法讀取 GPX。';}
    });
  }
}
