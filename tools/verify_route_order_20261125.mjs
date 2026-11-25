import fs from 'node:fs';
import assert from 'node:assert/strict';
import {hash,writeJson} from './route-validator/utils.mjs';
import {normalizeSnapshot,loadProject} from './route-validator/core.mjs';
import {accessIssues,importantNode} from './route-validator/sequence-review.mjs';
import {orderDependencies} from './route-validator/order-check.mjs';
const root='.route-validator/backups/',before=JSON.parse(fs.readFileSync(root+'round3-before-complete.json')),actual=JSON.parse(fs.readFileSync(root+'round3-after-native.json')),plan=JSON.parse(fs.readFileSync(root+'round3-plan.json'));
const review=JSON.parse(fs.readFileSync(plan.sourceReview)),p=loadProject();
const expected=new Map(before.sheets.map(s=>[s.properties.sheetId,structuredClone(s.data[0].rowData)]));
const expectedNodes=expected.get(1144715032);expectedNodes.splice(plan.insertAt,0,{values:[]});
// Only RouteNodes' own row-reference formulas move. Route summary formulas use
// whole-column ranges and stay in their original rows.
for(let i=plan.insertAt+1;i<expectedNodes.length;i++)for(const cell of expectedNodes[i].values||[])if(cell.userEnteredValue?.formulaValue)cell.userEnteredValue.formulaValue=cell.userEnteredValue.formulaValue.replace(/\$A(\d+)/g,(_,n)=>'$A'+(Number(n)>=plan.insertAt+1?Number(n)+1:n));
for(const request of plan.requests){
 if(request.insertDimension)continue;
 if(request.copyPaste){const {source,destination,pasteType}=request.copyPaste;assert.equal(pasteType,'PASTE_DATA_VALIDATION');const rows=expected.get(source.sheetId),from=rows[source.startRowIndex]?.values?.[source.startColumnIndex];rows[destination.startRowIndex].values[destination.startColumnIndex].dataValidation=structuredClone(from.dataValidation);continue;}
 const u=request.updateCells,rows=expected.get(u.start.sheetId);u.rows.forEach((r,i)=>{rows[u.start.rowIndex+i]??={values:[]};const target=rows[u.start.rowIndex+i];target.values??=[];r.values.forEach((cell,j)=>{target.values[u.start.columnIndex+j]??={};target.values[u.start.columnIndex+j].userEnteredValue=cell.userEnteredValue;});});
}
const empty=v=>v?.stringValue===''?{}:v||{},val=c=>c?.effectiveValue?Object.values(c.effectiveValue)[0]??'':'';
let checked=0,formulas=0,notes=0,validations=0;
for(const sheet of actual.sheets){const rows=sheet.data[0].rowData,wanted=expected.get(sheet.properties.sheetId),cols=sheet.properties.sheetId===1144715032?14:29;assert.equal(rows.length,wanted.length,sheet.properties.title+' row count');
 for(let i=0;i<rows.length;i++)for(let j=0;j<cols;j++){
  const a=rows[i].values?.[j]||{},e=wanted[i].values?.[j]||{};
  assert.deepEqual(empty(a.userEnteredValue),empty(e.userEnteredValue),sheet.properties.title+' '+(i+1)+','+(j+1));
  assert.equal(a.note||'',e.note||'','Preserve notes');assert.deepEqual(a.dataValidation,e.dataValidation,'Preserve validation '+i+','+j);
  assert.ok(!a.effectiveValue?.errorValue,'No formula error');if(a.userEnteredValue?.formulaValue)formulas++;if(a.note)notes++;if(a.dataValidation)validations++;checked++;
 }
}
// Extra historical cells outside the 14-column node schema are left untouched,
// and shift with their original row rather than being discarded by a rewrite.
const oldSnapshot=JSON.parse(fs.readFileSync('data/route-validator/snapshots/sheet-20261125-round2-applied.json')),ns=actual.sheets.find(s=>s.properties.sheetId===1144715032);
for(const extra of ns.data.slice(1))for(let i=0;i<extra.rowData.length;i++)for(let j=0;j<(extra.rowData[i].values||[]).length;j++)assert.equal(val(extra.rowData[i].values[j]),oldSnapshot.sheets.RouteNodes_順序校核.rows[extra.startRow+i-1]?.[extra.startColumn+j]??'');
const capturedAt=fs.existsSync('data/route-validator/snapshots/sheet-20261125-order-complete.json')?JSON.parse(fs.readFileSync('data/route-validator/snapshots/sheet-20261125-order-complete.json')).capturedAt:new Date().toISOString();
const snapshot={schemaVersion:1,capturedAt,spreadsheetId:actual.spreadsheetId,source:'Google Sheets native write/readback；完成現有上河節點指定走法順序核對；未改原始歷史分頁或正式路網',correctionRef:plan.sourceReview,sheets:Object.fromEntries(actual.sheets.map(s=>[s.properties.title,{sheetId:s.properties.sheetId,rows:s.data[0].rowData.map(r=>(r.values||[]).map(val))}]))};
for(const extra of ns.data.slice(1))for(let i=0;i<extra.rowData.length;i++){const row=snapshot.sheets.RouteNodes_順序校核.rows[extra.startRow+i];while(row.length<extra.startColumn)row.push('');extra.rowData[i].values.forEach((c,j)=>row[extra.startColumn+j]=val(c));}
const normalized=normalizeSnapshot(snapshot);assert.equal(normalized.problems.length,0);assert.equal(normalized.excluded.length,24);
for(const r of normalized.routes.filter(r=>r.occurrences.length)){
 const checked=review.results.find(z=>z.routeId===r.routeId);assert.deepEqual(r.occurrences.map(o=>o.nodeId),checked.after,r.routeId);
 assert.equal(Number(r.row['實際有效節點數']),r.occurrences.length,r.routeId+' summary count');assert.equal(accessIssues(checked.after).length,0);
 for(const o of r.occurrences){assert.ok(p.nodeAuthority.has(o.nodeId));assert.ok(!importantNode(p.nodes.get(o.nodeId),o.source['點位類型'])||o.key,r.routeId+' important '+o.nodeId);}
 checked.routeType=r.type;checked.nodeNames=r.occurrences.map(o=>o.name);checked.intentSha256=hash({name:r.name,type:r.type,nodes:r.occurrences.map(o=>({nodeId:o.nodeId,name:o.name})),excluded:normalized.excluded.filter(e=>e.routeId===r.routeId).map(e=>e.nodeId)});
 checked.dependenciesSha256=orderDependencies(r,p);
}
const file='data/route-validator/snapshots/sheet-20261125-order-complete.json';writeJson(file,snapshot);writeJson('.route-validator/snapshot.json',snapshot);
review.snapshotSha256=hash(fs.readFileSync(file));review.verification={status:'APPLIED_AND_READBACK_VERIFIED',verifiedAt:new Date().toISOString(),checkedCells:checked,formulas,notes,validations,formulaErrors:0,activeNodes:normalized.routes.reduce((n,r)=>n+r.occurrences.length,0),excludedRows:24,reviewedRoutes:review.results.length,unexpandedRoutes:26,historicalSheetsModified:false,formalProjectDataModified:false};
writeJson('data/route-validator/order-review-20261125.json',review);writeJson('data/audits/route-order-20261125/applied.json',{snapshot:file,snapshotSha256:review.snapshotSha256,...review.verification});
console.log(JSON.stringify(review.verification,null,2));
