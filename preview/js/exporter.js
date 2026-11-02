import {dayTerrain,terrainMetrics} from './itinerary-geometry.js?v=v0729';
import {buildTimeline,summarizeDay,edgeActual} from './planner.js';
const placeLabel=r=>(r.isPeak?'⛰ ':'')+r.name+(r.hasWater?' 💧':'');
const excelDuration=min=>min===null?'':Number(min||0)/1440;
const font='Microsoft JhengHei';
const noteHeight=(text,width=18)=>Math.max(28,13*String(text||'').split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil([...line].reduce((w,c)=>w+(c.charCodeAt(0)>255?2:1),0)/width)),0)+8);
const dateForDay=(startDate,index)=>{if(!startDate)return '';const d=new Date(startDate+'T00:00:00');d.setDate(d.getDate()+index);return d.getFullYear()+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0')};
export async function exportExcel({route,days,datasetVersion,tripStartDate,terrainData=null}){
 if(!window.ExcelJS)throw new Error('ExcelJS 尚未載入');
 const wb=new ExcelJS.Workbook();wb.creator='Mountain Planner';wb.created=new Date();
 const ws=wb.addWorksheet('登山行程',{views:[{state:'frozen',ySplit:3}]});
 ws.columns=[18,8,7,7,5,7,7,7,20,7].map(width=>({width}));
 ws.pageSetup={paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,horizontalCentered:true,margins:{left:.25,right:.25,top:.35,bottom:.35,header:.15,footer:.15},printTitlesRow:'1:3'};
 ws.mergeCells('A1:J1');ws.getCell('A1').value=route.route_name+'｜登山行程規劃';ws.getCell('A1').font={name:font,bold:true,size:16};ws.getCell('A1').alignment={horizontal:'center',vertical:'middle'};ws.getRow(1).height=28;
 ws.mergeCells('A2:J2');ws.getCell('A2').value='資料版本 '+datasetVersion+'｜來源：'+(route.source.publisher||'上河文化')+(terrainData?'｜地形：OSM／魯地圖 DEM 30m 估算 https://rudymap.tw/':'');ws.getCell('A2').font={name:font,size:8,color:{argb:'FF6C756E'}};ws.getCell('A2').alignment={horizontal:'center',vertical:'middle',wrapText:true};ws.getRow(2).height=30;
 const header=ws.getRow(3);header.values=['地點／事件','抵達','規劃\n分','上河\n分','係數','距離\nkm','↗上升\nm','↘下降\nm','備註','來源'];header.height=30;header.eachCell(c=>{c.font={name:font,bold:true,size:9};c.alignment={horizontal:'center',vertical:'middle',wrapText:true};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEAF0EB'}}});
 let rowNo=4;
 for(let i=0;i<days.length;i++){
  const day=days[i];if(!day.items.length)continue;
  const terrain=dayTerrain(day,terrainData),byItem=new Map((terrain?.features||[]).map(f=>[f.toItemId,f]));
  const tl=buildTimeline(day),sum=summarizeDay(day),date=dateForDay(tripStartDate,i);
  ws.mergeCells(rowNo,1,rowNo,10);const title=ws.getCell(rowNo,1);title.value='Day '+(i+1)+(date?'｜'+date:'')+'｜'+day.startTime+' 出發 → '+tl.endTime+' 結束';title.font={name:font,bold:true,size:11};title.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDDE9DF'}};title.alignment={vertical:'middle',wrapText:true};ws.getRow(rowNo).height=24;rowNo++;
  for(const r of tl.rows){
   const e=r.incoming,actual=e?edgeActual(e,day.coefficient):'',f=byItem.get(r.id),m=f?terrainMetrics([f]):null;
   const note=[r.note||'',r.type!=='rest'&&e&&!f?'地形資料未收錄':''].filter(Boolean).join('\n');
   const k=e?.kind==='official'&&actual!==null&&e.officialMinutes?Math.round((actual/e.officialMinutes)*100)/100:'';
   const values=r.type==='rest'?['☕ 休息',r.endTime,Number(r.minutes)||0,'','','','','',r.note||'','']:[placeLabel(r),r.arrival,e?(actual===null?'':Number(actual)):'',e?.kind==='official'?Number(e.officialMinutes):'',k,f?f.distanceMeters/1000:'',m?.ascentMeters??'',m?.descentMeters??'',note,e?.kind==='official'?'上河':''];
   const rr=ws.getRow(rowNo);rr.values=values;rr.height=noteHeight(note);
   rr.eachCell((c,col)=>{c.font={name:col>=2&&col<=8?'Calibri':font,size:10};c.alignment={vertical:'middle',horizontal:col>=2&&col<=8?'center':'left',wrapText:true}});
   rr.getCell(6).numFmt='0.00';rr.getCell(7).numFmt='0';rr.getCell(8).numFmt='0';
   if(e?.kind==='official'){const c=ws.getCell(rowNo,10);c.value={text:'上河',hyperlink:e.source||route.source.image_url};c.font={name:font,color:{argb:'FF315D42'},underline:true,size:9}}
   rowNo++;
  }
  const note=(sum.missing?'未填路段 '+sum.missing+'\n':'')+'行進 '+minutesHHMM(sum.movement)+'／休息 '+minutesHHMM(sum.rest)+(terrain?.gaps.length?'\n地形僅計已知部分（缺 '+terrain.gaps.length+' 段）':'');
  const sr=ws.getRow(rowNo);sr.values=['每日統計','',excelDuration(sum.total),excelDuration(sum.official),sum.official&&!sum.missing?Math.round((sum.total/sum.official)*100)/100:'',terrain?.features.length?terrain.distanceMeters/1000:'',terrain?.ascentMeters??'',terrain?.descentMeters??'',note,''];sr.height=noteHeight(note);sr.getCell(3).numFmt='[h]:mm';sr.getCell(4).numFmt='[h]:mm';sr.getCell(6).numFmt='0.00';sr.getCell(7).numFmt='0';sr.getCell(8).numFmt='0';sr.eachCell((c,col)=>{c.font={name:col>=3&&col<=8?'Calibri':font,bold:true,size:10};c.alignment={horizontal:col===9?'left':'center',vertical:'middle',wrapText:true};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF3F6F3'}}});rowNo++;
  if(day.note){ws.mergeCells(rowNo,1,rowNo,10);const c=ws.getCell(rowNo,1);c.value='Day '+(i+1)+' 備註：'+day.note;c.font={name:font,size:10};c.alignment={vertical:'middle',wrapText:true};ws.getRow(rowNo).height=noteHeight('Day '+(i+1)+' 備註：'+day.note,90);rowNo++}rowNo++;
 }
 ws.pageSetup.printArea='A1:J'+Math.max(3,rowNo-1);
 const buf=await wb.xlsx.writeBuffer(),blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=route.route_id+'_'+route.route_name+'_行程.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function minutesHHMM(min){const m=Math.max(0,Math.round(Number(min)||0));return Math.floor(m/60)+':'+String(m%60).padStart(2,'0')}
