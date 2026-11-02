import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {resolveItineraryGeometry,terrainMetrics,formatTerrain,renderTerrainProfile} from '../js/itinerary-geometry.js';
import {exportExcel} from '../js/exporter.js';
const data=JSON.parse(readFileSync(new URL('../data/geometry/xueshan-terrain-v1.json',import.meta.url)));
const ids=['g04-045','shared:cw-v07-003','g04-027','g04-044','shared:cw-v07-004','g04-039','shared:cw-v07-074'];
const day=(sequence=ids)=>({startTime:'06:00',coefficient:1,note:'保留每日備註',items:sequence.map((nodeId,i)=>({id:String(i),type:'location',nodeId,name:data.nodes.find(n=>n.nodeId===nodeId).name,note:'原始備註',incoming:i?{kind:'official',fromNodeId:sequence[i-1],toNodeId:nodeId,officialMinutes:60,actualMinutes:45}:null}))});
test('DEM profile computes ascent and descent, reverses exactly, and does not change notes',()=>{
 const d=day(),before=JSON.stringify(d),f=resolveItineraryGeometry([d],data).days[0],r=resolveItineraryGeometry([day([...ids].reverse())],data).days[0];
 assert.equal(JSON.stringify(d),before);assert.equal(f.features.length,6);assert.equal(f.gaps.length,0);
 assert.ok(Math.abs(f.ascentMeters-r.descentMeters)<1e-7);assert.ok(Math.abs(f.descentMeters-r.ascentMeters)<1e-7);
 assert.ok(f.ascentMeters>1800&&f.ascentMeters<1950);assert.ok(f.descentMeters>100&&f.descentMeters<200);
 const m=terrainMetrics([{profile:[[0,2500],[1,2800],[2,2700],[3,3000]]}]);assert.deepEqual(m,{ascentMeters:600,descentMeters:100});
 assert.equal(terrainMetrics([{profile:[[0,null]]}]).ascentMeters,null);
});
test('confirmed circle splits add up to historical direct edge, and spans across days stay additive',()=>{
 const full=resolveItineraryGeometry([day()],data).days[0];
 const split=resolveItineraryGeometry([day(ids.slice(0,6)),day(ids.slice(5))],data);
 assert.ok(Math.abs(full.ascentMeters-split.days.reduce((n,d)=>n+d.ascentMeters,0))<1e-7);
 const direct=resolveItineraryGeometry([day([ids[4],ids[6]])],data).days[0];
 const explicit=resolveItineraryGeometry([day(ids.slice(4))],data).days[0];
 assert.ok(Math.abs(direct.ascentMeters-explicit.ascentMeters)<1e-7);
 assert.ok(Math.abs(direct.distanceMeters-explicit.distanceMeters)<0.01);
});
test('manual gap excluded from totals and profile never creates a connecting line',()=>{
 const d=day();d.items[3].incoming.kind='manual';const r=resolveItineraryGeometry([d],data).days[0];
 assert.equal(r.gaps.length,1);assert.equal(r.features.length,5);assert.match(formatTerrain(r,{partial:true}),/已知部分/);
 assert.equal((renderTerrainProfile(r).match(/<polyline/g)||[]).length,5);assert.match(renderTerrainProfile(r),/缺漏未計入/);
});
test('Excel export includes per-leg metrics and daily totals without rewriting user notes',async()=>{
 const cells=new Map(),rows=new Map();const cell=k=>{if(!cells.has(k))cells.set(k,{});return cells.get(k)};
 const row=n=>{if(!rows.has(n))rows.set(n,{values:[],getCell:c=>cell(n+','+c),eachCell(fn){this.values.forEach((v,i)=>fn(cell(n+','+(i+1)),i+1))}});return rows.get(n)};
 const sheet={mergeCells(){},getCell:(a,b)=>cell(b===undefined?a:a+','+b),getRow:row};
 const Workbook=class{constructor(){this.xlsx={writeBuffer:async()=>new ArrayBuffer(0)}}addWorksheet(){return sheet}};
 const oldWindow=globalThis.window,oldDocument=globalThis.document;
 globalThis.window={ExcelJS:{Workbook}};globalThis.ExcelJS={Workbook};globalThis.document={createElement:()=>({click(){}})};
 const d=day();d.items.splice(2,0,{id:'rest',type:'rest',minutes:12,note:'休息備註保留'});const before=JSON.stringify(d);
 try{await exportExcel({route:{route_name:'測試',route_id:'TEST',source:{publisher:'上河',image_url:'https://example.com'}},days:[d],datasetVersion:'test',terrainData:data});
 const values=[...rows.values()].map(r=>r.values);
 assert.ok(values.some(r=>r[8]==='原始備註'&&r[5]>1.8&&r[5]<1.81&&r[6]>360));
 assert.equal(values.find(r=>r[0]==='☕ 休息')[8],'休息備註保留');
 const summary=values.find(r=>r[0]==='每日統計');assert.ok(summary[5]>10.1&&summary[5]<10.11);assert.equal(Math.round(summary[6]),1874);assert.equal(Math.round(summary[7]),143);
 assert.equal(JSON.stringify(d),before);
 }finally{globalThis.window=oldWindow;globalThis.document=oldDocument;delete globalThis.ExcelJS}
});
test('profile has gridlines and node distance/elevation lookup, including origin',async()=>{
 const {profileNodeRows}=await import('../js/itinerary-geometry.js');const d=resolveItineraryGeometry([day()],data).days[0],nodes=profileNodeRows(d),html=renderTerrainProfile(d);
 assert.equal(nodes.length,7);assert.equal(nodes[0].distanceMeters,0);assert.equal(nodes.at(-1).name,'雪山主峰');assert.ok(nodes.at(-1).distanceMeters>10100);
 assert.match(html,/profile-grid/);assert.match(html,/累計距離 km/);assert.match(html,/海拔 m/);assert.match(html,/10\.10/);
});
