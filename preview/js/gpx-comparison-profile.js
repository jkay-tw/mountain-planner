import {meters} from './osm-pilot-router.js';
const xml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function comparisonProfileData(segments){
 let distance=0;const pieces=[];let piece=[],known=0,missing=0,min=Infinity,max=-Infinity;
 const flush=()=>{if(piece.length)pieces.push(piece);piece=[];};
 for(const segment of segments){for(let i=0;i<segment.length;i++){if(i)distance+=meters(segment[i-1],segment[i]);const height=segment[i][2];if(Number.isFinite(height)){piece.push([distance,height]);known++;min=Math.min(min,height);max=Math.max(max,height);}else{missing++;flush();}}flush();}
 return {distance,pieces,known,missing,min,max,segments:segments.length};
}
export function renderComparisonProfile(segments,name='匯入 GPX'){
 const data=comparisonProfileData(segments),summary=`${(data.distance/1000).toFixed(2)} km · ${data.segments} 段 · ${data.known} 點有原始高程${data.missing?' · '+data.missing+' 點高度未知':''}`;
 if(!data.known)return `<p>${xml(summary)}；檔案沒有可繪製的原始高程，不補零。</p>`;
 const low=Math.floor(data.min/100)*100,high=Math.max(low+100,Math.ceil(data.max/100)*100),X=d=>60+700*d/(data.distance||1),Y=z=>280-180*(z-low)/(high-low);
 let grid='',paths='';for(let i=0;i<=4;i++){const height=low+(high-low)*i/4,y=Y(height);grid+=`<line x1="60" y1="${y}" x2="760" y2="${y}"/><text x="52" y="${y+4}" text-anchor="end">${Math.round(height)}</text>`;const d=data.distance*i/4,x=X(d);grid+=`<line x1="${x}" y1="100" x2="${x}" y2="280"/><text x="${x}" y="300" text-anchor="middle">${(d/1000).toFixed(1)}</text>`;}
 for(const piece of data.pieces){const points=piece.map(([d,z])=>`${X(d).toFixed(1)},${Y(z).toFixed(1)}`).join(' ');if(piece.length>1)paths+=`<polygon points="${X(piece[0][0])},280 ${points} ${X(piece.at(-1)[0])},280" fill="#8c459a" fill-opacity=".1"/><polyline points="${points}" fill="none" stroke="#8c459a" stroke-width="2.5" stroke-linejoin="round"/>`;else paths+=`<circle cx="${X(piece[0][0])}" cy="${Y(piece[0][1])}" r="3" fill="#8c459a"/>`;}
 return `<section class="profile-card gpx-profile-card"><div class="profile-chart-scroll"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 340" role="img" aria-label="匯入 GPX 原始高程剖面" style="font-family:system-ui,'Noto Sans TC',sans-serif"><rect width="800" height="340" rx="12" fill="#fff"/><rect x="20" y="22" width="5" height="32" rx="2" fill="#8c459a"/><text x="36" y="40" font-size="18" font-weight="700" fill="#243d35">匯入 GPX · 高度剖面</text><text x="36" y="62" font-size="12" fill="#53665a">${xml(summary)}</text><text x="36" y="82" font-size="11" fill="#53665a">${xml(name.slice(0,90))} · 檔案原值</text><g stroke="#e5ebe9" fill="#60736b" font-size="11" class="profile-grid">${grid}</g><path d="M60 100V280H760" fill="none" stroke="#89988c"/>${paths}<text x="30" y="100" font-size="11" fill="#60736b">m</text><text x="778" y="300" font-size="11" fill="#60736b">km</text><text x="760" y="326" text-anchor="end" font-size="10" fill="#60736b">GPX 原始高程 · 未套用 DEM</text></svg></div><p>橫軸為各軌跡段內累計水平距離，分段之間不累計接線；高程使用檔案原值，缺值與不同軌跡段分開繪製。匯入軌跡只作比較，不修改目前行程。</p></section>`;
}
