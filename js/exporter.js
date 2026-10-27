import {buildTimeline,summarizeDay,edgeActual} from './planner.js';

const placeLabel=r=>(r.isPeak?'⛰ ':'')+r.name+(r.hasWater?' 💧':'');
const excelDuration=min=>Number(min||0)/1440;
const dateForDay=(startDate,index)=>{
  if(!startDate)return '';
  const d=new Date(startDate+'T00:00:00');d.setDate(d.getDate()+index);
  return d.getFullYear()+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0');
};

export async function exportExcel({route,days,datasetVersion,tripStartDate}){
  if(!window.ExcelJS)throw new Error('ExcelJS 尚未載入');
  const wb=new ExcelJS.Workbook();wb.creator='Mountain Planner';wb.created=new Date();
  const ws=wb.addWorksheet('登山行程',{views:[{state:'frozen',ySplit:3}]});
  ws.columns=[{width:10},{width:27},{width:14},{width:14},{width:10},{width:30},{width:24}];

  ws.mergeCells('A1:G1');ws.getCell('A1').value=route.route_name+'｜登山行程規劃';
  ws.getCell('A1').font={name:'Microsoft JhengHei',bold:true,size:18};ws.getCell('A1').alignment={horizontal:'center',vertical:'middle'};ws.getRow(1).height=28;
  ws.mergeCells('A2:G2');ws.getCell('A2').value='資料版本 '+datasetVersion+'｜來源：'+route.source.publisher;
  ws.getCell('A2').font={name:'Microsoft JhengHei',size:10,color:{argb:'FF6C756E'}};ws.getCell('A2').alignment={horizontal:'center'};

  let rowNo=4;
  for(let i=0;i<days.length;i++){
    const day=days[i];if(!day.items.length)continue;
    const tl=buildTimeline(day),sum=summarizeDay(day),date=dateForDay(tripStartDate,i);

    ws.mergeCells(rowNo,1,rowNo,7);
    const title=ws.getCell(rowNo,1);
    title.value='Day '+(i+1)+(date?'｜'+date:'')+'｜'+day.startTime+' 出發 → '+tl.endTime+' 結束';
    title.font={name:'Microsoft JhengHei',bold:true,size:13};title.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDDE9DF'}};title.alignment={horizontal:'left',vertical:'middle'};
    rowNo++;

    const hr=ws.getRow(rowNo);hr.values=['時間','地點 / 事件','規劃時間','上河時間','係數','備註','來源'];
    hr.eachCell(c=>{c.font={name:'Microsoft JhengHei',bold:true};c.alignment={horizontal:'center',vertical:'middle'};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEAF0EB'}}});
    rowNo++;

    for(const r of tl.rows){
      if(r.type==='rest'){
        ws.getRow(rowNo).values=[r.endTime,'☕ 休息',Number(r.minutes)||0,'','','',''];
      }else{
        const e=r.incoming,actual=e?edgeActual(e,day.coefficient):'';
        const k=e?.kind==='official'?Math.round((actual/e.officialMinutes)*100)/100:'';
        ws.getRow(rowNo).values=[r.arrival,placeLabel(r),e?Number(actual):'',e?.kind==='official'?Number(e.officialMinutes):'',k,r.note||'',e?.kind==='official'?'上河 '+route.route_id:''];
        if(e?.kind==='official'){
          const c=ws.getCell(rowNo,7);c.value={text:'上河 '+route.route_id,hyperlink:route.source.image_url};c.font={name:'Microsoft JhengHei',color:{argb:'FF315D42'},underline:true,size:10};
        }
      }
      const rr=ws.getRow(rowNo);
      rr.eachCell((c,col)=>{c.font={...(c.font||{}),name:col===1||col===3||col===4||col===5?'Calibri':'Microsoft JhengHei'};c.alignment={vertical:'middle',horizontal:col<=5?'center':'left',wrapText:true}});
      rowNo++;
    }

    const sr=ws.getRow(rowNo);
    sr.values=['','每日統計',excelDuration(sum.total),excelDuration(sum.official),sum.official?Math.round((sum.total/sum.official)*100)/100:'','行進 '+minutesHHMM(sum.movement)+'　休息 '+minutesHHMM(sum.rest),''];
    sr.getCell(3).numFmt='[h]:mm';sr.getCell(4).numFmt='[h]:mm';
    sr.eachCell((c,col)=>{c.font={name:col===3||col===4||col===5?'Calibri':'Microsoft JhengHei',bold:true};c.alignment={horizontal:'center',vertical:'middle'};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF3F6F3'}}});
    rowNo++;

    if(day.note){
      ws.mergeCells(rowNo,1,rowNo,7);const c=ws.getCell(rowNo,1);c.value='Day '+(i+1)+' 備註：'+day.note;c.font={name:'Microsoft JhengHei',size:10};c.alignment={vertical:'middle',wrapText:true};rowNo++;
    }
    rowNo++;
  }

  const buf=await wb.xlsx.writeBuffer(),blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=route.route_id+'_'+route.route_name+'_行程.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function minutesHHMM(min){
  const m=Math.max(0,Math.round(Number(min)||0));
  return String(Math.floor(m/60))+':'+String(m%60).padStart(2,'0');
}
