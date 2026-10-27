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
      if(item.type==='rest'){
        if(!finite(item.minutes,0,10080))fail(where+' 休息時間錯誤');
        return;
      }
      if(typeof item.name!=='string'||!item.name.trim()||item.name.length>250||typeof item.note!=='string')fail(where+' 名稱或備註錯誤');
      if(item.incoming!==null&&item.incoming!==undefined){
        const e=item.incoming;
        if(!plain(e)||!['official','manual'].includes(e.kind))fail(where+' 路段資料錯誤');
        if(e.actualMinutes!==null&&e.actualMinutes!==undefined&&!finite(e.actualMinutes,0,10080))fail(where+' 規劃時間錯誤');
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
