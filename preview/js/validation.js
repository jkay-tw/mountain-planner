import {validCoordinate} from './path-editor.js';
// Validate untrusted plan JSON before mutating the current itinerary.
const plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const clock=v=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const date=v=>typeof v==='string'&&(/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00'))||v==='');
export function validatePlan(data,routeIds){
  const fail=msg=>{throw new Error(msg)};
  if(!plain(data)||data.format!=='mountain-planner')fail('不是 Mountain Planner 行程檔');
  if(data.schemaVersion!==1)fail('不支援的行程檔格式版本：'+data.schemaVersion);
  if(data.routeId!==null&&data.routeId!==undefined&&(!routeIds.includes(data.routeId)))fail('不支援的上河圖：'+data.routeId);
  if(!date(data.tripStartDate??''))fail('出發日期格式錯誤');
  if(!Array.isArray(data.days)||data.days.length<1||data.days.length>10)fail('行程天數必須為 1～10 天');
  let count=0;
  data.days.forEach((d,i)=>{
    if(!plain(d)||!clock(d.startTime)||!finite(d.coefficient,.1,3)||typeof d.note!=='string')fail('Day '+(i+1)+' 基本資料有誤');
    if(typeof d.linkedStart!=='boolean'||!Array.isArray(d.items)||d.items.length>1000)fail('Day '+(i+1)+' 行程資料格式錯誤');
    let last=null;
    d.items.forEach((item,j)=>{
      const where='Day '+(i+1)+' 第 '+(j+1)+' 項';
      if(!plain(item)||!['location','manual-location','rest'].includes(item.type))fail(where+' 節點類型錯誤');
      if(item.networkConnection!==undefined&&(!plain(item.networkConnection)||typeof item.networkConnection.nodeId!=='string'||typeof item.networkConnection.spanId!=='string'))fail(where+' 路網連接錯誤');
      if(item.pathEdit?.networkNodeIds!==undefined&&(!Array.isArray(item.pathEdit.networkNodeIds)||item.pathEdit.networkNodeIds.length>1000||item.pathEdit.networkNodeIds.some(id=>typeof id!=='string')))fail(where+' 路網路徑錯誤');
      if(item.pathEdit?.shape!==undefined&&(!Array.isArray(item.pathEdit.shape)||item.pathEdit.shape.length<2||item.pathEdit.shape.length>5000||item.pathEdit.shape.some(p=>!plain(p)||!validCoordinate(p.coordinate)||(p.controlId!==undefined&&typeof p.controlId!=='string'))))fail(where+' 手動線形錯誤');
      if(item.pathEdit?.osmSnapshot!==undefined){const o=item.pathEdit.osmSnapshot;if(!plain(o)||!Array.isArray(o.shape)||o.shape.length>5000||o.shape.some(p=>!validCoordinate(p))||!Array.isArray(o.coordinates)||o.coordinates.length<2||o.coordinates.length>5000||o.coordinates.some(p=>!Array.isArray(p)||p.length!==3||!validCoordinate(p.slice(0,2))||(p[2]!==null&&!finite(p[2],-1000,10000))))fail(where+' OSM 快照錯誤');}
      if(item.pathEdit?.candidateSource!==undefined){const c=item.pathEdit.candidateSource;if(!plain(c)||typeof c.spanId!=='string'||typeof c.name!=='string'||typeof c.url!=='string'||(c.url&&!/^https?:\/\//i.test(c.url)))fail(where+' 參考線形來源錯誤');}
      if(item.pathEdit?.autoReference!==undefined&&(typeof item.pathEdit.autoReference!=='boolean'||item.pathEdit.autoReference&&!item.pathEdit.candidateSource))fail(where+' 自動接入設定錯誤');
      if(item.coordinate!==undefined&&(item.type!=='manual-location'||!validCoordinate(item.coordinate)))fail(where+' 手動座標錯誤');
      if(item.pathManualMinutes!==undefined&&item.pathManualMinutes!==null&&!finite(item.pathManualMinutes,0,10080))fail(where+' 保存的手動時間錯誤');
      if(item.pathOriginalIncoming!==undefined){const e=item.pathOriginalIncoming;if(!plain(e)||e.kind!=='official'||!finite(e.officialMinutes,0,10080)||typeof e.from!=='string'||typeof e.to!=='string'||(e.actualMinutes!=null&&!finite(e.actualMinutes,0,10080)))fail(where+' 原始路段時間錯誤');}
      if(item.showInTable!==undefined&&typeof item.showInTable!=='boolean')fail(where+' 顯示設定錯誤');
      if(item.pathEdit!==undefined){const e=item.pathEdit;if(!plain(e)||typeof e.fromItemId!=='string'||!['auto','straight'].includes(e.mode)||!Array.isArray(e.controls)||e.controls.length>200||e.controls.some(c=>!plain(c)||typeof c.id!=='string'||!validCoordinate(c.coordinate)))fail(where+' 控制點錯誤');}
      if(item.pathEdit?.shape){const points=item.pathEdit.shape.filter(p=>p.controlId),controls=item.pathEdit.controls;if(points.length!==controls.length||new Set(points.map(p=>p.controlId)).size!==points.length||points.some(p=>!controls.some(c=>c.id===p.controlId&&c.coordinate[0]===p.coordinate[0]&&c.coordinate[1]===p.coordinate[1])))fail(where+' 控制點與線形不一致');}
      if(item.type==='rest'){
        if(!finite(item.minutes,0,10080))fail(where+' 休息時間錯誤');
        if(item.note!==undefined&&(typeof item.note!=='string'||item.note.length>10000))fail(where+' 休息備註錯誤');
        return;
      }
      if(typeof item.name!=='string'||!item.name.trim()||item.name.length>250||typeof item.note!=='string')fail(where+' 名稱或備註錯誤');
      if(item.incoming!==null&&item.incoming!==undefined){
        const e=item.incoming;
        if(!plain(e)||!['official','manual'].includes(e.kind))fail(where+' 路段資料錯誤');
        if(e.actualMinutes!==null&&e.actualMinutes!==undefined&&!finite(e.actualMinutes,0,10080))fail(where+' 規劃時間錯誤');
        if(e.coefficient!==undefined&&(!finite(e.coefficient,.1,3)||e.kind!=='official'))fail(where+' 路段係數錯誤');
        if(e.referenceKind!==undefined&&(!['regular','slow','heavy_pack'].includes(e.referenceKind)||e.kind!=='official'||(e.referenceKind!=='regular'&&!e.timeAlternatives?.some(t=>t.kind===e.referenceKind&&finite(t.minutes,0.01,10080)))))fail(where+' 參考條件錯誤');
        if(e.kind==='official'&&(!finite(e.officialMinutes,0,10080)||typeof e.from!=='string'||typeof e.to!=='string'))fail(where+' 上河時間錯誤');
        if(e.kind==='manual'&&(typeof e.fromId!=='string'||typeof e.toId!=='string'))fail(where+' 手動路段連接錯誤');
      }
      if(last===null&&item.incoming)fail(where+' 首個地點不應有進入路段');
      if(last!==null&&!item.incoming)fail(where+' 缺少路段資料');
      last=item;
    });
    count+=d.items.length;
  });
  if(count>4000)fail('行程點數量超過限制');
  return data;
}
