// Local-only GPX inspection; imported tracks never alter routing identities.
const panel=document.createElement('section');
panel.innerHTML='<h2>範圍與 GPX 比較</h2><p id="extent"></p><label>匯入 GPX（最多 10 MiB） <input id="review-file" type="file" accept=".gpx"></label><button id="review-remove">移除匯入</button><p id="review-status" role="status"></p><h3>規劃路徑高度（DEM 原頂點估算）</h3><div id="route-profile"></div><h3>匯入 GPX 高度（檔案原值）</h3><div id="import-profile"></div>';
document.querySelector('#map').after(panel);
import {meters} from './osm-pilot-router.js';
function profile(segments,host){
 let distance=0;const rows=[];
 for(const segment of segments){for(let i=0;i<segment.length;i++){if(i)distance+=meters(segment[i-1],segment[i]);rows.push([distance,segment[i][2]]);}rows.push([distance,null]);}
 const values=rows.filter(p=>Number.isFinite(p[1]));host.replaceChildren();
 const label=document.createElement('p');label.textContent=`距離 ${(distance/1000).toFixed(2)} km；${values.length?'有高度的點 '+values.length+'；缺值保留斷線':'無高度資料'}`;host.append(label);if(!values.length)return;
 const min=values.reduce((v,p)=>Math.min(v,p[1]),Infinity),max=values.reduce((v,p)=>Math.max(v,p[1]),-Infinity);
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 640 180');svg.setAttribute('role','img');svg.setAttribute('aria-label','橫軸累計距離，縱軸高度');svg.style.width='100%';svg.style.maxWidth='800px';
 let d='',open=false;for(const [x,z] of rows){if(!Number.isFinite(z)){open=false;continue}d+=`${open?'L':'M'}${40+x/(distance||1)*580},${140-(z-min)/(max-min||1)*110} `;open=true;}
 const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',d);path.setAttribute('fill','none');path.setAttribute('stroke','#8c459a');path.setAttribute('stroke-width','2');svg.append(path);
 for(const [x,y,text] of [[0,20,`${max.toFixed(0)} m`],[0,145,`${min.toFixed(0)} m`],[40,175,'0 km'],[550,175,`${(distance/1000).toFixed(2)} km`]]){const t=document.createElementNS(svg.namespaceURI,'text');t.setAttribute('x',x);t.setAttribute('y',y);t.setAttribute('font-size','12');t.textContent=text;svg.append(t)}host.append(svg);
}
document.addEventListener('pilot-route',e=>profile([e.detail],document.querySelector('#route-profile')));
let comparisonMap=null;
document.addEventListener('pilot-data',e=>{comparisonMap=e.detail.map;const p=Object.values(e.detail.nodes);let west=180,east=-180,south=90,north=-90;for(const a of p){west=Math.min(west,a[0]);east=Math.max(east,a[0]);south=Math.min(south,a[1]);north=Math.max(north,a[1])}document.querySelector('#extent').textContent=`已載入線形包圍範圍：東經 ${west.toFixed(4)}～${east.toFixed(4)}，北緯 ${south.toFixed(4)}～${north.toFixed(4)}。範圍內仍可能沒有路網；灰線才是已載入線形。`;document.querySelector('#route-profile').replaceChildren()});
let imported=null;
document.querySelector('#review-remove').onclick=()=>{imported?.remove();imported=null;document.querySelector('#import-profile').replaceChildren();document.querySelector('#review-status').textContent='匯入資料已移除';};
document.querySelector('#review-file').onchange=async e=>{const status=document.querySelector('#review-status');try{const file=e.target.files[0];if(!file)return;if(file.size>10*1024*1024)throw Error('檔案超過 10 MiB');const text=await file.text();if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('不接受含外部實體的 XML');const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror')||doc.documentElement.localName!=='gpx')throw Error('無效 GPX');
 const point=n=>{const lat=Number(n.getAttribute('lat')),lon=Number(n.getAttribute('lon')),ele=n.getElementsByTagNameNS('*','ele')[0]?.textContent; if(!n.hasAttribute('lat')||!n.hasAttribute('lon')||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw Error('無效座標');return [lon,lat,ele?.trim()&&Number.isFinite(Number(ele))?Number(ele):null]};
 const segments=[...doc.getElementsByTagNameNS('*','trkseg')].map(s=>[...s.getElementsByTagNameNS('*','trkpt')].map(point));if(!segments.some(s=>s.length>1))throw Error('沒有軌跡點');if(segments.reduce((n,s)=>n+s.length,0)>100000)throw Error('軌跡超過 100,000 點');
 if(!comparisonMap)throw Error('請先載入樣本區域');
 const group=L.featureGroup();for(const s of segments)L.polyline(s.map(p=>[p[1],p[0]]),{color:'#8c459a'}).addTo(group);for(const w of doc.getElementsByTagNameNS('*','wpt')){const p=point(w);const label=document.createElement('span');label.textContent=w.getElementsByTagNameNS('*','name')[0]?.textContent||'路點';L.circleMarker([p[1],p[0]],{radius:5}).bindTooltip(label).addTo(group)}imported?.remove();imported=group.addTo(comparisonMap);comparisonMap.fitBounds(group.getBounds());profile(segments,document.querySelector('#import-profile'));status.textContent=file.name+'：只在本機檢視，未加入行程。';
 }catch(error){status.textContent=error.message}};
