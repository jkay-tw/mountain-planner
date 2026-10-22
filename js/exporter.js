import {buildTimeline, summarizeDay, edgeActual} from './planner.js';

export async function exportExcel({route, days, defaultCoefficient, datasetVersion}){
  if(!window.ExcelJS) throw new Error('ExcelJS 尚未載入');
  const wb=new ExcelJS.Workbook();
  wb.creator='Mountain Planner';
  wb.created=new Date();

  for(let d=0; d<days.length; d++){
    const day=days[d];
    const {rows}=buildTimeline(day,defaultCoefficient);
    const sum=summarizeDay(day,defaultCoefficient);
    const ws=wb.addWorksheet(`Day ${d+1}`,{views:[{state:'frozen',ySplit:5}]});
    ws.mergeCells('A1:I1');
    ws.getCell('A1').value=`Day ${d+1}｜${route.route_name}`;
    ws.getCell('A1').font={bold:true,size:17};
    ws.addRow(['出發',day.startTime,'總行程(分)',sum.total,'行進(分)',sum.movement,'休息(分)',sum.rest,'']);
    ws.addRow(['上河原始(分)',sum.official,'平均上河係數',sum.coefficient ?? '—','手動段(分)',sum.manual,'資料版本',datasetVersion,'']);
    ws.addRow([]);
    ws.addRow(['時間','類型','地點 / 事件','規劃時間(分)','上河時間(分)','係數','休息至','來源','備註']);

    for(const r of rows){
      if(r.type==='rest'){
        ws.addRow([r.startTime,'休息','休息',r.minutes,'','',r.endTime,'','']);
      }else{
        const incoming=r.incoming;
        const actual=incoming?edgeActual(incoming,defaultCoefficient):'';
        const coef=incoming?.kind==='official' ? Math.round((actual/incoming.officialMinutes)*100)/100 : '';
        ws.addRow([
          r.arrival,
          r.type==='manual-location'?'手動節點':'上河節點',
          r.name,
          incoming?actual:'',
          incoming?.kind==='official'?incoming.officialMinutes:'',
          coef,
          '',
          incoming?.kind==='official'?route.source.image_url:'',
          incoming?.kind==='manual'?'手動設定':''
        ]);
      }
    }

    ws.columns=[{width:10},{width:12},{width:24},{width:15},{width:15},{width:10},{width:11},{width:44},{width:16}];
    const hr=ws.getRow(5); hr.font={bold:true};
    hr.eachCell(c=>c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDDE9DF'}});
    ws.autoFilter={from:'A5',to:'I5'};
    ws.eachRow((row,n)=>{
      row.alignment={vertical:'middle'};
      if(n>=6 && n%2===0) row.eachCell(c=>c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF7F9F7'}});
    });
    for(let n=6;n<=ws.rowCount;n++){
      const c=ws.getCell(n,8);
      if(c.value){c.value={text:`上河 ${route.route_id}`,hyperlink:route.source.image_url};c.font={color:{argb:'FF315D42'},underline:true};}
    }
  }

  const buf=await wb.xlsx.writeBuffer();
  const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`${route.route_id}_${route.route_name}_多日行程.xlsx`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
