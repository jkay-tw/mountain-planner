export async function exportExcel({route, items, rows, startTime, summary, datasetVersion}){
  if(!window.ExcelJS) throw new Error('ExcelJS 尚未載入');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mountain Planner';
  wb.created = new Date();
  const ws = wb.addWorksheet('登山行程', {views:[{state:'frozen', ySplit:5}]});

  ws.mergeCells('A1:I1');
  ws.getCell('A1').value = `${route.route_name}｜登山行程規劃`;
  ws.getCell('A1').font = {bold:true,size:18};
  ws.getCell('A1').alignment = {vertical:'middle'};
  ws.getRow(1).height = 28;

  ws.addRow(['出發時間',startTime,'資料版本',datasetVersion,'路線狀態',route.status,'資料來源',route.source.publisher,'']);
  ws.addRow(['上河原始合計',summary.sunriver,'預估步行合計',summary.adjusted,'休息合計',summary.rest,'總行程',summary.total,'分鐘']);
  ws.addRow([]);
  const header = ['#','抵達','地點','上河步程(分)','係數','預估步行(分)','休息(分)','離開','上河來源'];
  ws.addRow(header);

  rows.forEach(r => ws.addRow([r.index,r.arrive,r.to,r.minutes,r.coefficient,r.walk,r.rest,r.depart,route.source.image_url]));

  const headRow = ws.getRow(5);
  headRow.font = {bold:true};
  headRow.alignment = {vertical:'middle'};
  headRow.height = 22;
  headRow.eachCell(c=>{c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFDDE9DF'}};c.border={bottom:{style:'thin',color:{argb:'FFB7C7BA'}}};});

  [2,3].forEach(n=>{ws.getRow(n).eachCell((c,col)=>{ if(col%2===1) c.font={bold:true}; });});
  ws.columns = [
    {width:6},{width:10},{width:22},{width:15},{width:10},{width:16},{width:12},{width:10},{width:48}
  ];
  ws.eachRow((row,rowNumber)=>{
    row.alignment={vertical:'middle'};
    if(rowNumber>=6 && rowNumber%2===0){ row.eachCell(c=>c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF7F9F7'}}); }
  });
  rows.forEach((_,i)=>{const c=ws.getCell(6+i,9); c.value={text:'上河 G06 官方步程圖', hyperlink:route.source.image_url}; c.font={color:{argb:'FF315D42'},underline:true};});
  ws.autoFilter = {from:'A5',to:'I5'};

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${route.route_id}_${route.route_name}_行程.xlsx`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
