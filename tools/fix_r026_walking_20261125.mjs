// One-route owner-authorized amendment. No network or edits to other routes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {normalizeSnapshot,loadProject} from './route-validator/core.mjs';
import {hash,writeJson} from './route-validator/utils.mjs';
import {intentFingerprint,orderDependencies} from './route-validator/order-check.mjs';
const base='.route-validator/backups/r026-walking-',audit='data/audits/r026-walking-20261125',previous='data/route-validator/snapshots/sheet-20261125-order-complete.json',next='data/route-validator/snapshots/sheet-20261125-r026-walking.json';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const val=c=>Object.values(c?.effectiveValue||c?.userEnteredValue||{})[0]??'';
const literal=v=>v===''?{}:typeof v==='number'?{numberValue:v}:typeof v==='boolean'?{boolValue:v}:{stringValue:v};
export function planR026(before){
 const rs=before.sheets.find(s=>s.properties.title==='Routes_順序校核'),ns=before.sheets.find(s=>s.properties.title==='RouteNodes_順序校核');
 const rd=rs.data.find(d=>d.startRow===26),nd=ns.data.find(d=>d.startRow===428);
 assert.equal(val(rd.rowData[0].values[0]),'R026');assert.equal(nd.rowData.length,37);
 const input=normalizeSnapshot(read(previous)),old=input.routes.find(r=>r.routeId==='R026');
 for(let i=0;i<37;i++){const row=nd.rowData[i];assert.equal(val(row.values[0]),'R026');assert.deepEqual(row.values.map(val).slice(0,14),read(previous).sheets.RouteNodes_順序校核.rows[428+i].slice(0,14),'Live R026 differs from reviewed snapshot at '+(429+i));}
 assert.equal(old.occurrences.length,35);assert.equal(old.occurrences[0].nodeId,'g04-062');assert.equal(old.occurrences.at(-1).nodeId,'g04-062');
 const edits=[];
 const set=(sheetId,rowIndex,columnIndex,value)=>edits.push({sheetId,rowIndex,columnIndex,value});
 for(let i=0;i<35;i++)set(ns.properties.sheetId,428+i,2,i===0||i===34?'':i);
 const note='2026-11-25使用者確認：鎮西堡↔神木區登山口僅列交通，不納入步行序列；有效步行起終點為神木區登山口。保留原Node ID與歷史，不新增步行連線。';
 for(const [i,direction]of [[0,'去程'],[34,'回程']]){
  set(ns.properties.sheetId,428+i,6,'交通／排除');set(ns.properties.sheetId,428+i,9,'排除車行・歷史保留');set(ns.properties.sheetId,428+i,10,'交通（'+direction+'）');
  set(ns.properties.sheetId,428+i,11,val(nd.rowData[i].values[11])+'\n'+note+' 原有效position '+(i+1)+'。');set(ns.properties.sheetId,428+i,12,'使用者核准排除首尾車行；交通紀錄保留');
 }
 for(const [i,kind]of [[1,'起點'],[33,'終點']]){
  set(ns.properties.sheetId,428+i,6,kind);set(ns.properties.sheetId,428+i,10,kind+(i===33?'（第2次）':''));
  set(ns.properties.sheetId,428+i,11,val(nd.rowData[i].values[11])+'\n'+note);
 }
 for(const [col,value]of [[11,val(rd.rowData[0].values[11])+'\n交通備註：鎮西堡↔神木區登山口為車行，既有來源各10分鐘；步行模組從神木區登山口出發並返回，不計入首尾交通。'],[13,val(rd.rowData[0].values[13])+'\n'+note],[17,'2026-11-25 R026步行起終點修正；原有上河來源及其餘行走順序保留'],[18,'複合支線＋局部折返（步行；首尾交通另列）'],[20,'排除鎮西堡首尾車行；其他選峰、折返及排除政策保留'],[25,val(rd.rowData[0].values[25])+'\n'+note]])set(rs.properties.sheetId,26,col,value);
 for(const e of edits){const s=before.sheets.find(s=>s.properties.sheetId===e.sheetId),d=s.data.find(d=>e.rowIndex>=(d.startRow||0)&&e.rowIndex<(d.startRow||0)+d.rowData.length),cell=d.rowData[e.rowIndex-(d.startRow||0)].values[e.columnIndex];assert.ok(!cell?.userEnteredValue?.formulaValue,'Do not overwrite formulas');assert.ok(!cell?.dataValidation,'Do not change validated choices');}
 const requests=edits.map(e=>({updateCells:{start:{sheetId:e.sheetId,rowIndex:e.rowIndex,columnIndex:e.columnIndex},rows:[{values:[{userEnteredValue:literal(e.value)}]}],fields:'userEnteredValue'}}));
 return {schemaVersion:1,routeId:'R026',authorization:'使用者要求僅修正R026 Sheet及Preview，不重新檢查全路線',previousSnapshot:previous,nextSnapshot:next,beforeSha256:hash(before),edits,requests,before:old.occurrences.map(o=>o.nodeId),after:old.occurrences.slice(1,-1).map(o=>o.nodeId),note};
}
export function verifyR026(before,after,plan){
 const expected=structuredClone(before);
 for(const e of plan.edits){const s=expected.sheets.find(s=>s.properties.sheetId===e.sheetId),d=s.data.find(d=>e.rowIndex>=(d.startRow||0)&&e.rowIndex<(d.startRow||0)+d.rowData.length),c=d.rowData[e.rowIndex-(d.startRow||0)].values[e.columnIndex];c.userEnteredValue=literal(e.value);}
 // Compare all read cells, including formulas, validation, notes and formats.
 let cells=0,formulas=0;
 for(const s of expected.sheets)for(const d of s.data){const actual=after.sheets.find(x=>x.properties.sheetId===s.properties.sheetId).data.find(x=>(x.startRow||0)===(d.startRow||0));assert.ok(actual);assert.equal(actual.rowData.length,d.rowData.length);
  for(let i=0;i<d.rowData.length;i++)for(let j=0;j<d.rowData[i].values.length;j++){const a=actual.rowData[i].values[j]||{},e=d.rowData[i].values[j],clean=c=>Object.fromEntries(['userEnteredValue','userEnteredFormat','dataValidation','note'].filter(k=>c[k]!==undefined&&!(k==='userEnteredValue'&&!Object.keys(c[k]).length)).map(k=>[k,c[k]]));assert.deepEqual(clean(a),clean(e),s.properties.title+' '+((d.startRow||0)+i+1)+':'+j);assert.ok(!a.effectiveValue?.errorValue);cells++;if(a.userEnteredValue?.formulaValue)formulas++;}
 }
 const rs=after.sheets.find(s=>s.properties.title==='Routes_順序校核').data.find(d=>d.startRow===26).rowData[0].values;
 assert.equal(val(rs[5]),'神木區登山口');assert.equal(val(rs[6]),'神木區登山口');assert.equal(val(rs[9]),33);assert.equal(val(rs[24]),33);assert.ok(!val(rs[27]).includes('鎮西堡'));
 return {checkedCells:cells,preservedFormulas:formulas,formulaErrors:0,status:'APPLIED_AND_READBACK_VERIFIED'};
}
if(process.argv[2]==='--plan')writeJson(base+'plan.json',planR026(read(base+'before.json')));
if(process.argv[2]==='--verify-and-sync'){
 const before=read(base+'before.json'),after=read(base+'after.json'),plan=read(base+'plan.json'),verification=verifyR026(before,after,plan),snapshot=read(previous);
 snapshot.capturedAt=new Date().toISOString();snapshot.source='Google Sheets R026定點修正及原生回讀；其他路線沿用已完成核對快照';snapshot.previousSnapshotRef=previous;snapshot.previousSnapshotSha256=hash(fs.readFileSync(previous));snapshot.previousCorrectionRef=snapshot.correctionRef;snapshot.correctionRef=audit+'/applied.json';
 for(const s of after.sheets)for(const d of s.data.filter(d=>d.startRow))for(let i=0;i<d.rowData.length;i++)snapshot.sheets[s.properties.title].rows[d.startRow+i]=d.rowData[i].values.map(val);
 const normalized=normalizeSnapshot(snapshot),old=normalizeSnapshot(read(previous));assert.equal(normalized.problems.length,0);
 for(const r of normalized.routes)if(r.routeId!=='R026'){assert.deepEqual(r,old.routes.find(x=>x.routeId===r.routeId));assert.deepEqual(normalized.excluded.filter(e=>e.routeId===r.routeId),old.excluded.filter(e=>e.routeId===r.routeId));}
 const route=normalized.routes.find(r=>r.routeId==='R026');assert.deepEqual(route.occurrences.map(o=>o.nodeId),plan.after);assert.equal(normalized.excluded.length,26);
 writeJson(next,snapshot);writeJson('.route-validator/snapshot.json',snapshot);
 const prior=read('data/route-validator/order-review-20261125.json');writeJson(audit+'/order-review-before.json',prior);
 const record=prior.results.find(r=>r.routeId==='R026');record.previousAfter=record.after;record.after=plan.after;record.nodeNames=route.occurrences.map(o=>o.name);record.intentSha256=intentFingerprint(route,normalized.excluded);record.dependenciesSha256=orderDependencies(route,loadProject());record.amendmentRef=audit+'/applied.json';
 prior.snapshotSha256=hash(fs.readFileSync(next));prior.currentSnapshotRef=next;prior.amendments=[...(prior.amendments||[]),{routeId:'R026',sourceRef:audit+'/applied.json',previousSnapshotRef:previous,snapshotRef:next}];writeJson('data/route-validator/order-review-20261125.json',prior);
 writeJson(audit+'/applied.json',{...plan,requests:undefined,edits:plan.edits,source:'使用者明確確認；既有上河G04車行時間；非新外部查證',verification,snapshotSha256:prior.snapshotSha256,otherRoutesChanged:0,activeNodes:1469,excludedRows:26,formalDataChanged:false});console.log(JSON.stringify({verification,snapshot:next,sha256:prior.snapshotSha256,occurrences:route.occurrences.length}));
}
