import {writeDownload} from './save-file.js?v=v086';
import {dayTerrain,terrainMetrics} from './itinerary-geometry.js?v=v084';
import {buildTimeline,summarizeDay,edgeActual,referenceMinutes,round2} from './planner.js?v=segments1';
const placeLabel=r=>(r.isPeak?'⛰ ':'')+r.name+(r.hasWater?' 💧':'');
const excelDuration=min=>min==null||min===''?'':Number(min)/1440;
const font='Microsoft JhengHei';
const dateForDay=(startDate,index)=>{if(!startDate)return '';const d=new Date(startDate+'T00:00:00');d.setDate(d.getDate()+index);return d.getFullYear()+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0')};
export async function exportExcel({route,days,datasetVersion,tripStartDate,tripName='',terrainData=null,handle=null,name=null}){
 if(!window.ExcelJS)throw new Error('ExcelJS 尚未載入');
 const wb=new ExcelJS.Workbook();wb.creator='Mountain Planner';wb.created=new Date();
 const ws=wb.addWorksheet('登山行程',{views:[{state:'normal',showGridLines:true}]});
 ws.properties={defaultRowHeight:15.75};
 ws.columns=[18,8,7,7,5,7.5703125,6.85546875,6.85546875,20].map(width=>({width}));
 ws.pageSetup={paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,horizontalCentered:true,margins:{left:.25,right:.25,top:.35,bottom:.35,header:.15,footer:.15},printTitlesRow:'1:1'};
 ws.mergeCells('A1:I1');ws.getCell('A1').value=tripName.trim()||'登山行程規劃';ws.getCell('A1').font={name:font,bold:true,size:16};ws.getCell('A1').alignment={horizontal:'center',vertical:'middle'};ws.getRow(1).height=27.95;
 const border={top:{style:'thin',color:{argb:'FFB8C5BC'}},bottom:{style:'thin',color:{argb:'FFB8C5BC'}},left:{style:'thin',color:{argb:'FFB8C5BC'}},right:{style:'thin',color:{argb:'FFB8C5BC'}}};
 const addHeader=()=>{const header=ws.getRow(rowNo);header.values=['地點／事件','抵達','規劃','上河','係數','距離 km','↗ m','↘ m','備註'];header.height=15.75;header.eachCell(c=>{c.font={name:font,bold:true,size:9,color:{argb:'FFFFFFFF'}};c.alignment={horizontal:'center',vertical:'middle'};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF426651'}};c.border=border});rowNo++};
 let rowNo=2;
 for(let i=0;i<days.length;i++){
  const day=days[i];if(!day.items.length)continue;
  const terrain=dayTerrain(day,terrainData),byItem=new Map((terrain?.features||[]).map(f=>[f.toItemId,f]));
  const tl=buildTimeline(day),sum=summarizeDay(day),date=dateForDay(tripStartDate,i);
  ws.mergeCells(rowNo,1,rowNo,9);const title=ws.getCell(rowNo,1);title.value='Day '+(i+1)+(date?'｜'+date:'')+'｜'+day.startTime+' 出發 → '+tl.endTime+' 結束';title.font={name:font,bold:true,size:11};title.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDDE9DF'}};title.alignment={vertical:'middle',wrapText:true};ws.getRow(rowNo).height=24;rowNo++;addHeader();
  for(const r of tl.rows){
   const e=r.incoming,actual=e?edgeActual(e,day.coefficient):'',f=byItem.get(r.id),m=f?terrainMetrics([f]):null;
   const isBridge=(terrain?.features||[]).some(x=>x.intermediateCoordinatesUnknown&&x.viaItemIds.includes(r.id));
   const note=[r.note||'',isBridge?'路徑連續・分段待定位':f?.intermediateCoordinatesUnknown?'跨未定位點合計':r.type!=='rest'&&e&&!f?'地形資料未收錄':''].filter(Boolean).join('；');
   const reference=e?.kind==='official'?referenceMinutes(e):null;
   const k=e?.kind==='official'&&actual!==null&&reference?(e.coefficient??round2(actual/reference)):'';
   const values=r.type==='rest'?['☕ 休息',r.endTime,excelDuration(Number(r.minutes)||0),'','','','','',r.note||'']:[placeLabel(r),r.arrival,e?excelDuration(actual):'',reference!==null?excelDuration(reference):'',k,f?f.distanceMeters/1000:'',m?.ascentMeters??'',m?.descentMeters??'',note];
   const rr=ws.getRow(rowNo);rr.values=values;rr.height=15.75;
   rr.eachCell((c,col)=>{c.font={name:col>=2&&col<=8?'Calibri':font,size:10};c.alignment={vertical:'middle',horizontal:col>=2&&col<=8?'center':'left',wrapText:false};c.border=border;if(col===1||col===2){c.font={...c.font,bold:true,color:{argb:'FF234936'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEAF2EC'}}}else if(col===3){c.font={...c.font,bold:true,color:{argb:'FF304F76'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEDF3F9'}}}else if(col>=6&&col<=8){c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF2F6FA'}}}else if(col===4||col===5)c.font={...c.font,color:{argb:'FF77837B'}}});
   rr.getCell(3).numFmt='[h]:mm';rr.getCell(4).numFmt='[h]:mm';rr.getCell(6).numFmt='0.00';rr.getCell(7).numFmt='0';rr.getCell(8).numFmt='0';

   rowNo++;
  }
  const note=(sum.missing?'未填路段 '+sum.missing+'；':'')+'行進 '+minutesHHMM(sum.movement)+'／休息 '+minutesHHMM(sum.rest)+(terrain?.gaps.length?'；地形僅計已知部分（缺 '+terrain.gaps.length+' 段）':'');
  const sr=ws.getRow(rowNo);sr.values=[terrain?.gaps.length?'每日統計（部分）':'每日統計','',excelDuration(sum.total),excelDuration(sum.official),sum.official&&!sum.missing?Math.round((sum.total/sum.official)*100)/100:'',terrain?.features.length?terrain.distanceMeters/1000:'',terrain?.ascentMeters??'',terrain?.descentMeters??'',note];sr.height=15.75;sr.getCell(3).numFmt='[h]:mm';sr.getCell(4).numFmt='[h]:mm';sr.getCell(6).numFmt='0.00';sr.getCell(7).numFmt='0';sr.getCell(8).numFmt='0';sr.eachCell((c,col)=>{c.font={name:col>=3&&col<=8?'Calibri':font,bold:true,size:10};c.alignment={horizontal:col===9?'left':'center',vertical:'middle',wrapText:false};c.border=border;c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDDE9DF'}}});rowNo++;
  if(day.note){ws.mergeCells(rowNo,1,rowNo,9);const c=ws.getCell(rowNo,1);c.value='Day '+(i+1)+' 備註：'+day.note;c.font={name:font,size:10};c.alignment={vertical:'middle',wrapText:true};ws.getRow(rowNo).height=15.75;rowNo++}rowNo++;
 }
 ws.pageSetup.printArea='A1:I'+Math.max(3,rowNo-1);
 const buf=await wb.xlsx.writeBuffer(),blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});await writeDownload(blob,name||route.route_id+'_'+route.route_name+'_行程.xlsx',handle);
}
function minutesHHMM(min){const m=Math.max(0,Math.round(Number(min)||0));return Math.floor(m/60)+':'+String(m%60).padStart(2,'0')}
