import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadProject,normalizeSnapshot} from './route-validator/core.mjs';
import {accessIssues,importantNode} from './route-validator/sequence-review.mjs';
import {hash} from './route-validator/utils.mjs';
const dir='.route-validator/backups/',plan=JSON.parse(fs.readFileSync(dir+'round2-plan.json')),actual=JSON.parse(fs.readFileSync(dir+'round2-readback-complete.json')),baseline=JSON.parse(fs.readFileSync(dir+'round2-before.json'));
const formulaRepairs=JSON.parse(fs.readFileSync(dir+'round2-formula-fix.json'));
for(const c of formulaRepairs)plan.expectedRoutes[c.row][c.col]={userEnteredValue:c.value};
for(const c of JSON.parse(fs.readFileSync(dir+'round2-final-field-fixes.json')))plan.expectedRoutes[c.row][c.col]={userEnteredValue:c.value};
const ns=actual.sheets.find(s=>s.properties.sheetId===1144715032),rs=actual.sheets.find(s=>s.properties.sheetId===967124143);
const cells=s=>s.data[0].rowData.map(r=>r.values||[]),nodes=cells(ns),routes=cells(rs);
const entered=v=>v?.stringValue===''?{}:v||{}; // Sheets normalizes empty-string literals to blank cells.
let formulas=0,validations=0,notes=0,checked=0;
for(let i=0;i<plan.expectedNodes.length;i++)for(let j=0;j<14;j++){
 const c=nodes[i]?.[j]||{},e=plan.expectedNodes[i].values[j];assert.deepEqual(entered(c.userEnteredValue),entered(e.userEnteredValue),`RouteNodes row${i+1} col${j+1}`);assert.equal(c.note||'',e.note||'');
 if(c.userEnteredValue?.formulaValue)formulas++;if(c.note)notes++;
 if(i&&[7,13].includes(j)){assert.equal(c.dataValidation?.condition?.type,'BOOLEAN',`Checkbox validation row${i+1} col${j+1}`);validations++;if(c.userEnteredValue?.boolValue!==undefined)assert.equal(typeof c.userEnteredValue.boolValue,'boolean');}
 checked++;
}
for(let i=0;i<plan.expectedRoutes.length;i++)for(let j=0;j<29;j++){
 const c=routes[i]?.[j]||{},e=plan.expectedRoutes[i][j]||{};assert.deepEqual(entered(c.userEnteredValue),entered(e.userEnteredValue),`Routes row${i+1} col${j+1}`);if(c.userEnteredValue?.formulaValue)formulas++;checked++;
}
for(const s of actual.sheets)for(const r of cells(s))for(const c of r)assert.ok(!c.effectiveValue?.errorValue,JSON.stringify(c.effectiveValue?.errorValue));
const val=c=>c?.effectiveValue?.stringValue??c?.effectiveValue?.numberValue??c?.effectiveValue?.boolValue??c?.formattedValue??'';
const snapshot={schemaVersion:1,capturedAt:new Date().toISOString(),spreadsheetId:actual.spreadsheetId,source:'第2輪Google Sheets native readback；保留R064線上序列；只修改順序校核分頁',correctionRef:'data/audits/route-review-20261125-round2/corrections.json',sheets:Object.fromEntries(actual.sheets.map(s=>[s.properties.title,{sheetId:s.properties.sheetId,rows:cells(s).map(r=>r.map(val))}]))};
const normalized=normalizeSnapshot(snapshot),p=loadProject();assert.equal(normalized.problems.length,0);assert.equal(normalized.routes.filter(r=>r.occurrences.length).length,60);assert.equal(normalized.excluded.length,24);
for(const r of normalized.routes.filter(r=>r.occurrences.length)){
 assert.equal(accessIssues(r.occurrences.map(o=>o.nodeId)).length,0,r.routeId);
 assert.equal(Number(r.row['實際有效節點數']),r.occurrences.length,r.routeId+' formula count');
 for(const o of r.occurrences)assert.ok(o.key||!importantNode(p.nodes.get(o.nodeId),o.source['點位類型']),r.routeId+' missing important '+o.nodeId);
}
const bnodes=cells(baseline.sheets.find(s=>s.properties.sheetId===1144715032));
const get64=rows=>rows.filter(r=>val(r[0])==='R064'&&Number(val(r[2]))>0).sort((a,b)=>val(a[2])-val(b[2])).map(r=>val(r[3]));assert.deepEqual(get64(nodes),get64(bnodes));
const file='data/route-validator/snapshots/sheet-20261125-round2-applied.json';fs.writeFileSync(file,JSON.stringify(snapshot,null,2));fs.writeFileSync('.route-validator/snapshot.json',JSON.stringify(snapshot,null,2));
const record={status:'APPLIED_AND_READBACK_VERIFIED',verifiedAt:new Date().toISOString(),spreadsheetId:actual.spreadsheetId,sheetIds:[967124143,1144715032],snapshot:file,snapshotSha256:hash(fs.readFileSync(file)),checkedCells:checked,formulas,checkboxValidations:validations,notes,formulaErrors:0,counts:plan.counts,routeIdsChanged:JSON.parse(fs.readFileSync('data/audits/route-review-20261125-round2/corrections.json')).results.filter(r=>r.changes.length).map(r=>r.routeId),historicalSheetsModified:false,formalProjectDataModified:false};
fs.writeFileSync('data/audits/route-review-20261125-round2/sheet-applied.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record,null,2));
