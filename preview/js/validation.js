import {projectOnShape,detourShape} from './local-detour.js';
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
      if(item.demSnapshot!==undefined){const s=item.demSnapshot;if(!plain(s)||!Array.isArray(s.shape)||s.shape.length<2||s.shape.length>100000||s.shape.some(p=>!validCoordinate(p))||!Array.isArray(s.profile)||s.profile.length<2||s.profile.length>100000||s.profile.some((p,i)=>!Array.isArray(p)||p.length!==2||!finite(p[0],0,1e8)||(p[1]!==null&&!finite(p[1],-1000,10000))||(i&&p[0]<s.profile[i-1][0]))||!plain(s.source)||typeof s.version!=='string'||s.version.length>100||s.spacingMeters!==30)fail(where+' DEM 快照錯誤');}
      if(item.networkConnection!==undefined&&(!plain(item.networkConnection)||typeof item.networkConnection.nodeId!=='string'||typeof item.networkConnection.spanId!=='string'))fail(where+' 路網連接錯誤');
      if(item.pathEdit?.networkNodeIds!==undefined&&(!Array.isArray(item.pathEdit.networkNodeIds)||item.pathEdit.networkNodeIds.length>1000||item.pathEdit.networkNodeIds.some(id=>typeof id!=='string')))fail(where+' 路網路徑錯誤');
      if(item.pathEdit?.shape!==undefined&&(!Array.isArray(item.pathEdit.shape)||item.pathEdit.shape.length<2||item.pathEdit.shape.length>5000||item.pathEdit.shape.some(p=>!plain(p)||!validCoordinate(p.coordinate)||(p.controlId!==undefined&&typeof p.controlId!=='string'))))fail(where+' 手動線形錯誤');
      if(item.pathEdit?.detour!==undefined){const d=item.pathEdit.detour;if(!plain(d)||!Array.isArray(d.base)||d.base.length<2||d.base.length>4997||d.base.some(p=>!plain(p)||!validCoordinate(p.coordinate)||(p.controlId!==undefined&&typeof p.controlId!=='string'))||!validCoordinate(d.target)||!finite(d.start,0,1e8)||!finite(d.end,0,1e8)||d.start>=d.end||!finite(d.min,0,1e8)||!finite(d.max,0,1e8)||d.start<d.min||d.end>d.max||![d.id,d.pId,d.qId].every(id=>typeof id==='string'&&id.length>0)||new Set([d.id,d.pId,d.qId]).size!==3)fail(where+' 局部繞行資料錯誤');if(d.end>projectOnShape(d.base,d.base.at(-1).coordinate).total+.001||JSON.stringify(detourShape(d))!==JSON.stringify(item.pathEdit.shape))fail(where+' 局部繞行線形不一致');}
      if(item.pathEdit?.intervalModes!==undefined&&(!plain(item.pathEdit.intervalModes)||Object.keys(item.pathEdit.intervalModes).length>1000||Object.values(item.pathEdit.intervalModes).some(m=>!['auto','straight'].includes(m))))fail(where+' 區間連接模式錯誤');
      if(item.pathEdit?.intervals!==undefined&&(!Array.isArray(item.pathEdit.intervals)||item.pathEdit.intervals.length>201||item.pathEdit.intervals.some(p=>!plain(p)||typeof p.key!=='string'||typeof p.signature!=='string'||!['auto','straight'].includes(p.mode)||typeof p.network!=='boolean'||!Array.isArray(p.coordinates)||p.coordinates.length<2||p.coordinates.length>5000||p.coordinates.some(c=>!validCoordinate(c)))))fail(where+' 區間線形錯誤');
      if(item.pathEdit?.intervals?.some(p=>['accessSegments','startAccess','endAccess'].some(k=>p[k]!==undefined&&typeof p[k]!=='boolean')||['failureReason','sourceName'].some(k=>p[k]!==undefined&&(typeof p[k]!=='string'||p[k].length>1000))||(p.sourceUrl!==undefined&&(typeof p.sourceUrl!=='string'||p.sourceUrl&&!/^https?:\/\//i.test(p.sourceUrl)))||(p.networkProfile!=null&&(!Array.isArray(p.networkProfile)||p.networkProfile.length<2||p.networkProfile.length>5000||p.networkProfile.some((v,i)=>!Array.isArray(v)||v.length!==2||!finite(v[0],0,1e8)||!finite(v[1],-1000,10000)||(i>0&&v[0]<p.networkProfile[i-1][0]))))))fail(where+' 區間來源或高程格式錯誤');
      if(item.pathEdit?.routingError!==undefined&&(typeof item.pathEdit.routingError!=='string'||item.pathEdit.routingError.length>1000))fail(where+' 尋路訊息錯誤');
      if(item.pathEdit?.endpointCoordinates!==undefined&&(!Array.isArray(item.pathEdit.endpointCoordinates)||item.pathEdit.endpointCoordinates.length!==2||item.pathEdit.endpointCoordinates.some(c=>!validCoordinate(c))))fail(where+' 路徑端點快照錯誤');
      if(item.pathEdit?.osmRouting!==undefined&&typeof item.pathEdit.osmRouting!=='boolean')fail(where+' OSM 自動重算設定錯誤');
      if(item.pathEdit?.osmSnapshot!==undefined){const o=item.pathEdit.osmSnapshot;if(!plain(o)||!Array.isArray(o.shape)||o.shape.length>5000||o.shape.some(p=>!validCoordinate(p))||!Array.isArray(o.coordinates)||o.coordinates.length<2||o.coordinates.length>5000||o.coordinates.some(p=>!Array.isArray(p)||p.length!==3||!validCoordinate(p.slice(0,2))||(p[2]!==null&&!finite(p[2],-1000,10000))))fail(where+' OSM 快照錯誤');}
      if(item.pathEdit?.candidateSource!==undefined){const c=item.pathEdit.candidateSource;if(!plain(c)||typeof c.spanId!=='string'||typeof c.name!=='string'||typeof c.url!=='string'||(c.url&&!/^https?:\/\//i.test(c.url)))fail(where+' 參考線形來源錯誤');}
      if(item.pathEdit?.autoReference!==undefined&&(typeof item.pathEdit.autoReference!=='boolean'||item.pathEdit.autoReference&&!item.pathEdit.candidateSource))fail(where+' 自動接入設定錯誤');
      if(item.coordinate!==undefined&&(item.type!=='manual-location'||!validCoordinate(item.coordinate)))fail(where+' 手動座標錯誤');
      if(item.pathManualMinutes!==undefined&&item.pathManualMinutes!==null&&!finite(item.pathManualMinutes,0,10080))fail(where+' 保存的手動時間錯誤');
      if(item.pathOriginalIncoming!==undefined){const e=item.pathOriginalIncoming;if(!plain(e)||e.kind!=='official'||!finite(e.officialMinutes,0,10080)||typeof e.from!=='string'||typeof e.to!=='string'||(e.actualMinutes!=null&&!finite(e.actualMinutes,0,10080)))fail(where+' 原始路段時間錯誤');}
      if(item.showInTable!==undefined&&typeof item.showInTable!=='boolean')fail(where+' 顯示設定錯誤');
      if(item.pathEdit!==undefined){const e=item.pathEdit;if(!plain(e)||typeof e.fromItemId!=='string'||!['auto','straight'].includes(e.mode)||!Array.isArray(e.controls)||e.controls.length>200||e.controls.some(c=>!plain(c)||typeof c.id!=='string'||!validCoordinate(c.coordinate)))fail(where+' 控制點錯誤');}
      if(item.pathEdit?.controls?.some(c=>c.label!==undefined&&(typeof c.label!=='string'||c.label.length>16)))fail(where+' 控制點標號錯誤');
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
