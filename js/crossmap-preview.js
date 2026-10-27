import {buildVerifiedWalkingGraph,shortestVerifiedWalkingPath} from './crossmap-routing.js';

const $=id=>document.getElementById(id);
const fmt=min=>Math.floor(min/60)+' 小時 '+String(min%60).padStart(2,'0')+' 分鐘';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dataset=[
  'data/staging/G17.overlap-verified-subset.json',
  'data/staging/G18.overlap-verified-subset.json'
];
let routes=[],graph=null,options=[];
function updateOptions(){
  options=routes.flatMap(r=>r.nodes.map(n=>({
    key:graph.locationId.get(JSON.stringify([r.route_id,n.id])),
    name:n.name,route:r.route_name,localId:n.id
  })));
  // Shared physical points remain selectable from either chart, labeled by source chart.
  for(const id of ['start','end']){
    const select=$(id);
    select.innerHTML=options.map(o=>'<option value="'+esc(o.route+'|'+o.localId)+'">'+esc(o.route+'｜'+o.name)+'</option>').join('');
  }
  const a=options.find(o=>o.route==='南二段'&&o.name==='南雙頭山');
  const b=options.find(o=>o.route==='新康橫斷'&&o.name==='3058公尺峰');
  if(a)$('start').value=a.route+'|'+a.localId;
  if(b)$('end').value=b.route+'|'+b.localId;
}
function getSelection(id){
  const val=$(id).value,selected=options.find(o=>o.route+'|'+o.localId===val);
  return selected?.key||null;
}
function render(){
  if(!graph)return;
  const start=getSelection('start'),end=getSelection('end');
  const result=shortestVerifiedWalkingPath(graph,start,end);
  const box=$('result');
  if(!start||!end){box.innerHTML='<p>請選擇起點與終點。</p>';return;}
  if(!result){
    box.innerHTML='<h2>目前無法計算完整步行路徑</h2><p>測試資料只收錄四組已核對的雙向路段；其餘路段尚未進入路網。這不代表實際山徑不相通。</p>';return;
  }
  const transitions=result.segments.reduce((n,e,i,a)=>n+(i>0&&e.routeId!==a[i-1].routeId?1:0),0);
  const rows=result.segments.map((e,i)=>{
    const from=graph.nodes.get(e.from)?.name||e.from;
    const to=graph.nodes.get(e.to)?.name||e.to;
    const source=e.source?'<a href="'+esc(e.source)+'" target="_blank" rel="noopener noreferrer">查看上河原圖</a>':'來源未記錄';
    const name=routes.find(r=>r.route_id===e.routeId)?.route_name||e.routeId;
    return '<tr><td>'+esc(String(i+1))+'</td><td>'+esc(from)+' → '+esc(to)+'</td><td>'+esc(name)+'</td><td>'+esc(fmt(e.minutes))+'</td><td>'+source+'</td></tr>';
  }).join('');
  box.innerHTML='<h2>尋路結果：'+esc(fmt(result.minutes))+'</h2>'+
    '<p>共 '+result.segments.length+' 段，跨圖邊界 '+transitions+' 次。此為資料核對與演算法測試，非完整登山行程建議。</p>'+
    (rows?'<div class="table-scroll"><table><thead><tr><th>#</th><th>行走路段</th><th>所屬圖</th><th>步程時間</th><th>來源</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<p>起終點為同一實體地點，時間為 0。</p>');
}
async function init(){
  const files=await Promise.all([...dataset,'data/crosswalk-reviewed.json'].map(async file=>{
    const response=await fetch(file,{cache:'no-store'});if(!response.ok)throw Error('無法載入 '+file);
    return response.json();
  }));
  routes=files.slice(0,2);
  const crosswalk=files[2];
  if(crosswalk.schemaVersion!==1||crosswalk.canonicalNodes.some(n=>n.routingEnabled!==false))
    throw Error('跨圖資料檢查失敗');
  graph=buildVerifiedWalkingGraph(routes,crosswalk,{allowCrossMap:true});
  updateOptions();
  $('start').addEventListener('change',render);
  $('end').addEventListener('change',render);
  $('swap').addEventListener('click',()=>{
    const a=$('start').value;$('start').value=$('end').value;$('end').value=a;render();
  });
  $('status').textContent='已載入 G17／G18 部分核對路段（8 條方向邊）；僅用於跨圖驗證。';
  render();
}
init().catch(e=>{
  $('status').textContent='載入失敗：'+e.message;
  $('result').textContent='資料無法載入，不會改動任何已儲存行程。';
});
