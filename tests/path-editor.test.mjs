import '../preview/js/path-editor-ui.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {editSegment,recalculateSegment,visibleTimelineRows,aggregateTerrain} from '../preview/js/path-editor.js';
import {resolveItineraryGeometry,geometryToGpx,distanceMeters} from '../preview/js/itinerary-geometry.js';
import {recalcConnections,buildTimeline,summarizeDay,shortestPath} from '../preview/js/planner.js';
import {validatePlan} from '../preview/js/validation.js';
import {toTwd97} from '../preview/js/twd97.js';
import {syncLinkedDays} from '../preview/js/day-link.js';
import {exportExcel} from '../preview/js/exporter.js';
const data={schemaVersion:1,nodes:['a','b','c','d'].map((nodeId,i)=>({nodeId,name:nodeId,coordinate:[121+i*.01,24],anchor:[121+i*.01,24]})),spans:[],source:{url:'https://example.org',attribution:'test',license:'test',copyrightUrl:'https://example.org'}};
data.spans=data.nodes.slice(1).map((n,i)=>({id:String(i),fromId:data.nodes[i].nodeId,toId:n.nodeId,coordinates:[data.nodes[i].coordinate,n.coordinate],reversible:true,profile:[[0,100],[1000,110]],distanceMeters:1000}));
const route={nodes:data.nodes.map(n=>({id:n.nodeId,name:n.name})),segments:data.spans.map(s=>({fromId:s.fromId,toId:s.toId,from:s.fromId,to:s.toId,minutes:10}))};
const day=()=>({id:'day',startTime:'06:00',coefficient:1,linkedStart:false,note:'',items:data.nodes.map((n,i)=>({id:n.nodeId,type:'location',nodeId:n.nodeId,name:n.name,note:'',incoming:i?{kind:'official',from:n.nodeId==='b'?'a':n.nodeId==='c'?'b':'c',to:n.nodeId,fromId:data.nodes[i-1].nodeId,toId:n.nodeId,fromNodeId:data.nodes[i-1].nodeId,toNodeId:n.nodeId,officialMinutes:10,actualMinutes:null,source:'preserved'}:null}))});
const resolve=d=>resolveItineraryGeometry([d],data);
test('T01/T02 manual coordinates remain exact; same name and position gain no global identity',()=>{
 const d=day();d.items.push({id:'manual',type:'manual-location',name:'d',coordinate:[121.03,24],note:'',incoming:{kind:'manual',fromId:'d',toId:'manual',actualMinutes:null}});
 const before=JSON.stringify(d);const r=resolve(d);assert.equal(r.days[0].features.at(-1).manual,true);assert.equal(JSON.stringify(d),before);assert.ok(r.waypoints.some(w=>w.nodeId==='manual'));assert.deepEqual(toTwd97([121,24]),[250000,2655023]);
 const single={...d,items:[{...d.items.at(-1),incoming:null}]};assert.equal(resolve(single).waypoints.length,1);assert.match(geometryToGpx(resolve(single),data,{allowWaypointsOnly:true}),/使用者指定位置/);
});
test('T03 connected nodes retain existing routing, geometry and directional time',()=>{
 const d=day(),r=resolve(d);assert.equal(shortestPath(route,'a','d').segments.length,3);assert.equal(r.days[0].features.length,3);assert.ok(r.days[0].features.every(f=>!f.manual));assert.equal(summarizeDay(d).total,30);
});
test('T04 disconnected manual connection has explicit straight warning and unknown time',()=>{
 const d=day();d.items[1].incoming={kind:'manual',fromId:'a',toId:'b',actualMinutes:null,connectionStatus:'unverified'};
 const r=resolve(d),f=r.days[0].features[0];assert.equal(f.manual,true);assert.match(f.sourceName,/不代表實際步道/);assert.equal(f.distanceMeters,distanceMeters([121,24],[121.01,24]));assert.equal(summarizeDay(d).total,null);
});
test('T05/T06/T07 controls insert, move, delete with geometry and distance updates',()=>{
 const d=day();editSegment(d,'b',e=>e.controls.push({id:'control',coordinate:[121.005,24.01]}));const initial=resolve(d).days[0].features[0];assert.deepEqual(initial.coordinates[1],[121.005,24.01]);
 editSegment(d,'b',e=>{e.controls[0].coordinate=[121.005,24.02]});assert.ok(resolve(d).days[0].features[0].distanceMeters>initial.distanceMeters);
 editSegment(d,'b',e=>e.controls.splice(0,1));assert.equal(resolve(d).days[0].features[0].manual,undefined);assert.equal(d.items[1].incoming.officialMinutes,10);
});
test('T08 confirmed local geometry survives refresh/recalculation; neighboring edges stay byte identical',()=>{
 const d=day(),before=structuredClone(d.items.slice(2));editSegment(d,'b',e=>{e.mode='straight'});recalcConnections(d,route);assert.deepEqual(d.items.slice(2),before);assert.equal(resolve(d).days[0].features[0].manual,true);assert.equal(d.items[1].pathOriginalIncoming.source,'preserved');
});
test('explicit auto recalculation uses only the selected pair and hides inserted network nodes',()=>{
 const d=day(),other=structuredClone(d.items.slice(2)),graph=structuredClone(route);graph.nodes.push({id:'x',name:'x'});graph.segments=graph.segments.filter(s=>s.fromId!=='a');graph.segments.push({fromId:'a',toId:'x',from:'a',to:'x',minutes:3},{fromId:'x',toId:'b',from:'x',to:'b',minutes:4});
 recalculateSegment(d,'b',graph);assert.deepEqual(d.items.slice(3),other);assert.equal(d.items[1].nodeId,'x');assert.equal(d.items[1].showInTable,false);assert.equal(d.items[2].incoming.fromNodeId,'x');assert.equal(d.items[2].incoming.officialMinutes,4);
});
test('T09 hidden rows preserve all timing and geometry, aggregate into next visible node',()=>{
 const d=day();d.items[1].showInTable=false;d.items[2].showInTable=false;const before=resolve(d),rows=visibleTimelineRows(buildTimeline(d).rows,d);assert.deepEqual(rows.map(r=>r.name),['a','d']);assert.equal(rows[1].incoming.actualMinutes,30);assert.equal(rows[1].arrival,'06:30');assert.equal(summarizeDay(d).total,30);assert.equal(aggregateTerrain(before.days[0].features,rows[1].aggregateItemIds).distanceMeters,before.distanceMeters);assert.equal(resolve(d).distanceMeters,before.distanceMeters);assert.equal(d.items[1].incoming.source,'preserved');
});
test('T10 mixed GPX keeps ordered full coordinates including controls and hidden nodes',()=>{
 const d=day();d.items[1].showInTable=false;editSegment(d,'c',e=>e.controls.push({id:'x',coordinate:[121.015,24.02]}));const r=resolve(d),gpx=geometryToGpx(r,data);const expected=r.days[0].features.flatMap(f=>f.coordinates.map(p=>`lat="${p[1]}" lon="${p[0]}"`));let offset=gpx.indexOf('<trk>');for(const p of expected){offset=gpx.indexOf(p,offset);assert.ok(offset>=0);offset+=p.length;}assert.match(gpx,/手動幾何連接/);assert.match(gpx,/<wpt/);
});
test('T11/T12 manual geometry has no invented elevations or source time, manual time survives changes',()=>{
 const d=day();editSegment(d,'b',e=>{e.mode='straight'});assert.equal(d.items[1].incoming.actualMinutes,null);d.items[1].incoming.actualMinutes=37;editSegment(d,'b',e=>e.controls.push({id:'x',coordinate:[121.005,24.01]}));assert.equal(d.items[1].incoming.actualMinutes,37);const r=resolve(d);assert.equal(r.days[0].ascentMeters,null);assert.equal(r.days[0].features[0].profile,null);const xml=geometryToGpx(r,data).split('<trkseg>')[1].split('</trkseg>')[0];assert.doesNotMatch(xml,/<ele>/);
});
test('T13 JSON restore and undo snapshots preserve edited geometry',()=>{
 const d=day(),undo=JSON.stringify(d);editSegment(d,'b',e=>{e.mode='straight'});const redo=JSON.stringify(d);const plan={format:'mountain-planner',schemaVersion:1,routeId:'GLOBAL-PREVIEW',days:[JSON.parse(redo)]};assert.equal(validatePlan(plan,['GLOBAL-PREVIEW']),plan);assert.deepEqual(resolve(JSON.parse(redo)),resolve(d));assert.equal(resolve(JSON.parse(undo)).days[0].features[0].manual,undefined);assert.equal(resolve(JSON.parse(redo)).days[0].features[0].manual,true);
});
test('import rejects malformed and oversized coordinates/controls',()=>{
 const d=day();editSegment(d,'b',e=>{e.mode='straight'});const plan={format:'mountain-planner',schemaVersion:1,routeId:null,days:[d]};d.items[1].pathEdit.controls=[{id:'bad',coordinate:[181,24]}];assert.throws(()=>validatePlan(plan,[]),/控制點/);assert.throws(()=>editSegment(day(),'b',e=>e.controls.push({id:'bad',coordinate:[NaN,24]})),/無效/);
});
test('mode switches preserve manual time separately from original directional source time',()=>{
 const d=day();editSegment(d,'b',e=>{e.mode='straight'});d.items[1].incoming.actualMinutes=37;editSegment(d,'b',e=>{e.mode='auto'});assert.equal(d.items[1].incoming.officialMinutes,10);editSegment(d,'b',e=>{e.mode='straight'});assert.equal(d.items[1].incoming.actualMinutes,37);
 const m=day();m.items[1].incoming={kind:'manual',fromId:'a',toId:'b',actualMinutes:29};editSegment(m,'b',e=>{e.mode='straight'});m.items[1].incoming.actualMinutes=41;editSegment(m,'b',e=>{e.mode='auto'});assert.equal(m.items[1].incoming.actualMinutes,41);
 const invalid=day();invalid.items[1].incoming={kind:'manual',fromId:'other',toId:'b',actualMinutes:null};assert.equal(resolve(invalid).gaps.length,1);
});
test('linked manual day starts copy exact coordinates and distinguish same-name positions',()=>{
 const a=day();a.items=[{id:'m',type:'manual-location',name:'same',coordinate:[121,24],incoming:null,note:''}];const b={...day(),linkedStart:true,items:[]};syncLinkedDays([a,b],route,()=> 'linked');assert.deepEqual(b.items[0].coordinate,[121,24]);a.items[0].coordinate=[121.1,24];syncLinkedDays([a,b],route,()=> 'linked2');assert.deepEqual(b.items[0].coordinate,[121.1,24]);
});
test('T14 editing affordances are explicit and mobile inputs avoid focus/auto-pan jumps',()=>{
 const s=readFileSync(new URL('../preview/js/path-editor-ui.js',import.meta.url),'utf8');assert.match(s,/編輯路徑模式/);assert.match(s,/map.getContainer\(\).append\(box\)/);assert.match(s,/draggable:true/);assert.match(s,/iconSize:\[44,44\]/);assert.doesNotMatch(s,/\.focus\(/);
});
test('Excel exports visible rows with complete hidden distance/time and leaves unknown manual time blank',async()=>{
 let sheet;
 class Row{
  constructor(){this.values=[];this.cells=new Map();}
  getCell(i){if(!this.cells.has(i))this.cells.set(i,{});return this.cells.get(i);}
  eachCell(fn){this.values.forEach((v,i)=>fn(this.getCell(i+1),i+1));}
 }
 class Workbook{
  constructor(){this.xlsx={writeBuffer:async()=>new ArrayBuffer(0)};}
  addWorksheet(){sheet={rows:new Map(),pageSetup:{},properties:{},mergeCells(){},getCell(){return {};},getRow(i){if(!this.rows.has(i))this.rows.set(i,new Row());return this.rows.get(i);}};return sheet;}
 }
 globalThis.window={ExcelJS:{Workbook}};globalThis.ExcelJS=window.ExcelJS;
 const handle={createWritable:async()=>({write:async()=>{},close:async()=>{}})},d=day();d.items[1].showInTable=false;d.items[2].showInTable=false;
 await exportExcel({route:{route_id:'test',route_name:'test'},days:[d],terrainData:data,handle});
 const row=[...sheet.rows.values()].find(r=>r.values[0]==='d');assert.equal(row.values[2],30/1440);assert.equal(row.values[3],30/1440);assert.equal(row.values[5],resolve(d).distanceMeters/1000);assert.equal([...sheet.rows.values()].filter(r=>['b','c'].includes(r.values[0])).length,0);
 editSegment(d,'b',e=>{e.mode='straight'});
 await exportExcel({route:{route_id:'test',route_name:'test'},days:[d],terrainData:data,handle});
 const mixed=[...sheet.rows.values()].find(r=>r.values[0]==='d');assert.equal(mixed.values[2],'');assert.equal(mixed.values[6],'');assert.match(mixed.values[8],/手動水平直線距離/);
 delete globalThis.window;delete globalThis.ExcelJS;
});
import {attachmentCandidates,attachmentPath} from '../preview/js/network-attachment.js';
test('confirmed attachment preserves manual position and follows source geometry before network routing',()=>{
 const d=day(),original=[120.999,24.002];d.items[0]={...d.items[0],type:'manual-location',coordinate:original};delete d.items[0].nodeId;
 assert.match(recalculateSegment(d,'b',route),/尚未確認/);
 const candidate=attachmentCandidates(d.items[0],data).find(c=>c.nodeId==='a');assert.ok(candidate);
 d.items[0].networkConnection={spanId:candidate.spanId,nodeId:candidate.nodeId};
 assert.match(recalculateSegment(d,'b',route),/已沿確認/);
 const r=resolve(d);assert.deepEqual(r.days[0].features[0].coordinates[0],original);assert.equal(r.days[0].features[0].manual,true);assert.ok(r.days[0].features.some(f=>!f.manual));assert.equal(r.days[0].ascentMeters,null);assert.equal(d.items[0].nodeId,undefined);
 assert.deepEqual(resolve(JSON.parse(JSON.stringify(d))),r);
 delete d.items[0].networkConnection;assert.equal(resolve(d).days[0].features[0].manual,true);assert.equal(resolve(d).days[0].features.filter(f=>f.toItemId==='b').length,1);
});
test('attachment follows a bent reference span; point is never replaced by projection',()=>{
 const span={fromId:'a',toId:'b',coordinates:[[121,24],[121.01,24.01],[121.02,24]]},p=[121.015,24.006];
 const a=attachmentPath(p,span,'a');assert.deepEqual(a.coordinates[0],p);assert.ok(a.coordinates.some(c=>c[0]===121.01&&c[1]===24.01));assert.deepEqual(a.coordinates.at(-1),[121,24]);assert.throws(()=>attachmentPath(p,span,'other'),/來源/);
});
test('recalculation reports disconnected attachment without changing other legs',()=>{
 const d=day();d.items[0]={...d.items[0],type:'manual-location',coordinate:[121,24],networkConnection:{spanId:'0',nodeId:'unconnected'}};const before=JSON.stringify(d);assert.match(recalculateSegment(d,'b',route),/不連通/);assert.equal(JSON.stringify(d),before);
});
