import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadProject} from './route-validator/core.mjs';
import {routeContext,compileClassicRoute} from '../preview/js/classic-route.js';
const base='.route-validator/backups/';
const before=JSON.parse(fs.readFileSync(base+'sheet-before-approved-update-20261125.json'));
const report=JSON.parse(fs.readFileSync('data/audits/route-review-20261125/report.json'));
const project=loadProject(),string=v=>({stringValue:String(v)}),num=v=>({numberValue:v});
const val=c=>c?.v?.stringValue??c?.v?.numberValue??c?.v?.boolValue??'';
const routes=before.sheets.find(s=>s.title==='Routes_順序校核'),sheet=before.sheets.find(s=>s.title==='RouteNodes_順序校核');
assert.ok(sheet.rows.every(r=>r.slice(14).every(c=>!Object.keys(c.v).length)),'Unexpected extra data columns');
const groups=new Map();for(const row of sheet.rows.slice(1)){const id=val(row[0]);if(!id)continue;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(structuredClone(row.slice(0,14)));}
const selected=new Map(report.staged.map(s=>[s.routeId,s.after.map(o=>o.nodeId)]));
const old64=groups.get('R064'),idByName=name=>{const n=[...project.nodes.values()].filter(n=>n.name===name&&n.groups.includes('G14'));assert.equal(n.length,1);return n[0].id;};
selected.set('R064',['林道舊登山口','林道入口','林道舊登山口','2897公尺峰','六順山','2897公尺峰','林道舊登山口'].map(idByName));
for(const [id,ids]of selected){
  const original=groups.get(id),used=new Set(),rows=[];
  for(let i=0;i<ids.length;i++){
    let at=original.findIndex((r,j)=>!used.has(j)&&val(r[3])===ids[i]);
    const row=at>=0?structuredClone(original[at]):Array.from({length:14},()=>({v:{}}));if(at>=0)used.add(at);
    const node=project.nodes.get(ids[i]);assert.ok(node&&project.nodeAuthority.has(node.id));
    const oldPosition=val(row[2]);row[0]={v:string(id)};row[2]={v:num(i+1)};row[3]={v:string(node.id)};row[4]={v:string(node.name)};row[5]={v:string(node.groups[0])};
    row[6]={v:string(i===0?'起點':i===ids.length-1?'終點':'途經／支線')};row[7]={v:{boolValue:at>=0?val(original[at][7])===true:['R066','R064'].includes(id)&&[0,ids.length-1].includes(i)}};
    row[8]={v:string('2026-11-25使用者核准；沿用原始Node ID')};row[9]={v:string('既有精確路段／線形；主序已核對')};row[10]={v:string(i===0?'起點':i===ids.length-1?'終點':'依position行走')};
    row[11]={v:string([val(row[11]),'2026-11-25核准修正；原position '+(oldPosition||'空白／新增')+(id==='R064'&&node.name==='林道入口'?'；此既有線形最近點視為到達七彩湖湖區，不另拉線至湖心。':'')].filter(Boolean).join('\n'))};
    row[12]={v:string([val(row[12]),'使用者已核准本次走法'].filter(Boolean).join('；'))};if(at<0)row[13]={v:{boolValue:false}};
    rows.push(row);
  }
  original.forEach((r,j)=>{if(used.has(j))return;const row=structuredClone(r);row[11]={v:string([val(row[11]),'2026-11-25改線排除；原position '+(val(row[2])||'空白')+'；保留歷史不刪除'].filter(Boolean).join('\n'))};row[2]={v:{}};row[9]={v:string('依使用者決策排除・歷史保留')};rows.push(row);});
  groups.set(id,rows);
}
for(const id of ['R013','R025','R026']){
  const ids=selected.get(id);for(let i=0;i<ids.length;i++)if(ids[i]==='g04-019'){assert.equal(ids[i-1],'g04-002');assert.equal(ids[i+1],'g04-002');}
  assert.ok(!ids.some((id,i)=>i&&new Set([id,ids[i-1]]).has('g04-019')&&new Set([id,ids[i-1]]).has('g04-020')));
}
const newRows=[sheet.rows[0].slice(0,14)];for(const [id,rows]of groups){for(const r of rows){const active=Number(val(r[2]))>0;if(active&&!selected.has(id))r[9]={v:string(['R052','R057','R081'].includes(id)?'沿用已接受特殊連接／手填政策':'既有路網線形／時間已檢查・外部主要順序已核對')};newRows.push(r);}}
newRows.slice(1).forEach((row,i)=>row[1]={v:{formulaValue:`=IF($A${i+2}="","",IFNA(VLOOKUP($A${i+2},'Routes_順序校核'!$A:$B,2,FALSE),""))`}});
const verify=[];for(const [id,rows]of groups){const active=rows.filter(r=>Number(val(r[2]))>0).sort((a,b)=>val(a[2])-val(b[2]));if(!active.length)continue;
  const ids=active.map(r=>val(r[3]));if(!selected.has(id)){const orig=sheet.rows.filter(r=>val(r[0])===id&&Number(val(r[2]))>0).map(r=>val(r[3]));assert.deepEqual(ids,orig);}
  if(selected.has(id)){const graph={...project.graph,vehicleSegments:[...project.graph.vehicleSegments,...(id==='R026'?project.catalog.supplement.vehicleSegments||[]:[])]};const c=compileClassicRoute({routeId:id,name:id,type:id==='R026'?'multi_segment':'traverse',anchors:ids.map(nodeId=>({nodeId,key:true})),excludedNodeIds:[],expandAnchors:false,source:{baseCommit:'working-tree',snapshotSha256:'approved-edit',decisionRef:'user-20261125',...(id==='R026'?{multimodalRef:'existing-vehicle-policy'}:{})}},routeContext(graph,project.geometry,project.digest));assert.equal(c.issues.length,0,id);verify.push({id,count:ids.length,bindings:c.geometryBindings.length});}
}
const routeUpdates=[],snapshotRoutes=[];
for(let i=1;i<routes.rows.length;i++){
 const row=structuredClone(routes.rows[i]);const id=val(row[0]);if(!/^R\d{3}$/.test(id)){snapshotRoutes.push(row);continue;}
 const rr=report.results.find(r=>r.routeId===id),active=(groups.get(id)||[]).filter(r=>Number(val(r[2]))>0).sort((a,b)=>val(a[2])-val(b[2]));
 const changes={};if(rr){
  changes[8]='主要順序與既有路段已核對';changes[10]=['R052','R057','R081'].includes(id)?'沿用已接受特殊連接／車行／手填時間政策':'表內精確有向路段、線形與既有方向時間已檢查';
  changes[11]=rr.external.finding;changes[12]=selected.has(id)?'2026-11-25使用者已核准修正':'主要錨點與走法核對完成';
  changes[17]='2026-11-25 Preview工作樹／原始Node ID表；非新官方實測';changes[23]=selected.has(id)?'已依使用者決策修正':'主要走法核對完成・保留合理變體';
  changes[25]=rr.external.finding+' 本輪以GPX／行程核對主要順序，路徑重用既有OSM／來源線形；非1400點獨立實測。';
  changes[26]=[...new Set([...rr.external.sources,...JSON.parse(fs.readFileSync('.route-validator/sources.json')).sources.filter(s=>s.routeIds.includes(id)).map(s=>s.sourceUrl)])].join('\n');
  changes[28]='候選已校核；正式匯入／發布另行執行';
 }else{changes[8]='未展開';changes[10]='無有效節點，不納入通過統計';changes[23]='未展開・未驗證';changes[25]='2026-11-25全量盤點：尚無有效序列，不自動生成。';changes[28]='禁止匯入・未展開';}
 if(selected.has(id)){changes[20]='2026-11-25已依使用者決策修改';changes[13]=[val(row[13]),id==='R064'?'林道舊登山口步行往返；孫海橋至此一般為機車交通，不併入純步行序列；既有線形最近點即視為抵達七彩湖湖區。':id==='R066'?'14.6K水泥路止起步，經傳統無雙部落／吊橋至郡大林道33K；保留丹大及東巒合法折返。':'補列伊澤山第二登山口；伊澤山僅由8.8K岔路登頂並返回8.8K，不使用伊澤山直連第二登山口。'].filter(Boolean).join('\n');changes[11]=changes[13];changes[25]=changes[13]+' 已檢查完整有效序列的精確路段與既有線形／時間；無新增全域ID、座標或時間。';}
 if(id==='R066'){changes[18]='完整步行縱走＋丹大／內嶺爾／東巒支線折返';changes[19]='順行（瑞穗往郡大）';}
 if(id==='R064'){changes[18]='林道舊登山口往返＋湖區最近線形點';changes[19]='往返';}
 for(const [j,value]of Object.entries(changes)){assert.ok(!row[j]?.v?.formulaValue,'Preserve existing formula');row[j]={...row[j],v:string(value)};routeUpdates.push({row:i,col:+j,value:row[j].v});}
 snapshotRoutes.push(row);
}
const asCells=row=>({values:row.map(c=>({userEnteredValue:c.v||{},note:c.note||''}))});
const requests=[];const delta=newRows.length-sheet.rows.length;
if(delta>0){requests.push({appendDimension:{sheetId:sheet.sheetId,dimension:'ROWS',length:delta}});requests.push({copyPaste:{source:{sheetId:sheet.sheetId,startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:14},destination:{sheetId:sheet.sheetId,startRowIndex:sheet.rows.length,endRowIndex:newRows.length,startColumnIndex:0,endColumnIndex:14},pasteType:'PASTE_FORMAT'}});for(const col of [7,13])requests.push({setDataValidation:{range:{sheetId:sheet.sheetId,startRowIndex:sheet.rows.length,endRowIndex:newRows.length,startColumnIndex:col,endColumnIndex:col+1},rule:{condition:{type:'BOOLEAN'},strict:true}}});}
requests.push({updateCells:{range:{sheetId:sheet.sheetId,startRowIndex:0,endRowIndex:newRows.length,startColumnIndex:0,endColumnIndex:14},rows:newRows.map(asCells),fields:'userEnteredValue,note'}});
for(const c of routeUpdates)requests.push({updateCells:{start:{sheetId:routes.sheetId,rowIndex:c.row,columnIndex:c.col},rows:[{values:[{userEnteredValue:c.value}]}],fields:'userEnteredValue'}});
const plan={schemaVersion:1,status:'PREPARED',requests,expectedNodes:newRows,expectedRoutes:snapshotRoutes,verify,counts:{nodeRows:newRows.length-1,active:newRows.slice(1).filter(r=>Number(val(r[2]))>0).length,excluded:newRows.slice(1).filter(r=>!Number(val(r[2]))).length},routeUpdates};
fs.writeFileSync(base+'approved-update-plan.json',JSON.stringify(plan));console.log(JSON.stringify({verify,counts:plan.counts,requests:requests.length,delta}));
