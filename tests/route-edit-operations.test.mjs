import test from 'node:test';import assert from 'node:assert/strict';
import {dragRoute,moveRouteControl,deleteRouteControl,switchRouteInterval,seedRouteEdit} from '../preview/js/route-edit-operations.js';
import {routeIntervals,intervalShape} from '../preview/js/control-routing.js';
import {buildGraph} from '../preview/js/osm-pilot-router.js';
import {projectOnShape,proposeDetour,applyDetour} from '../preview/js/local-detour.js';
import {editSegment,promoteShapeControl,splitManualShape} from '../preview/js/path-editor.js';
import {resolveItineraryGeometry,geometryToGpx} from '../preview/js/itinerary-geometry.js';
import {validatePlan} from '../preview/js/validation.js';
const geometry=[[121,24],[121.004,24.002],[121.008,24],[121.012,24.003],[121.02,24]],mid=geometry[2];
const edit=()=>({mode:'auto',controls:[],fromItemId:'a'});
test('automatic drag directly creates ordinary P/B/Q with manual inner edges and unchanged automatic exterior',()=>{
 const e=edit();dragRoute(e,geometry,mid,[121.009,24.007],'B',{manual:false,scope:geometry,sourceName:'原來源'});
 assert.equal(e.detour,undefined);assert.deepEqual(e.controls.map(c=>c.label),['P','B','Q']);assert.deepEqual(e.intervals.map(p=>p.network),[true,false,false,true]);assert.deepEqual(e.intervals.map(p=>p.mode),['auto','straight','straight','auto']);assert.deepEqual(e.shape[0].coordinate,geometry[0]);assert.deepEqual(e.shape.at(-1).coordinate,geometry.at(-1));
 for(const c of e.controls.filter(c=>c.label!=='B'))assert.ok(projectOnShape(geometry.map(coordinate=>({coordinate})),c.coordinate).distance<.001);
 const outside=structuredClone([e.intervals[0],e.intervals.at(-1)]);moveRouteControl(e,1,[121.01,24.008]);assert.deepEqual([e.intervals[0],e.intervals.at(-1)],outside);
 const before=e.controls[0].coordinate;moveRouteControl(e,0,[121.003,24.006]);assert.notDeepEqual(e.controls[0].coordinate,before);assert.equal(e.intervals[0].retry,true);
});
test('manual drag adds only B and makes both sides manual; deleting it reconnects directly',()=>{
 const e=edit();dragRoute(e,geometry,mid,[121.009,24.007],'B',{manual:true,scope:geometry});assert.equal(e.controls.length,1);assert.deepEqual(e.intervals.map(p=>p.mode),['straight','straight']);assert.deepEqual(e.shape.map(p=>p.coordinate),[geometry[0],[121.009,24.007],geometry.at(-1)]);deleteRouteControl(e,0);assert.equal(e.controls.length,0);assert.deepEqual(e.shape.map(p=>p.coordinate),[geometry[0],geometry.at(-1)]);
});
test('unchanged itinerary coordinates preserve reference-shape endpoints without snapping them',()=>{
 const e=edit(),endpoints=[[121.00005,24.00005],[121.02005,24.00005]];dragRoute(e,geometry,mid,[121.009,24.007],'B',{manual:false,scope:geometry,endpointCoordinates:endpoints});const outside=[e.intervals[0],e.intervals.at(-1)];const r=routeIntervals(e,...endpoints,null);assert.strictEqual(r.intervals[0],outside[0]);assert.strictEqual(r.intervals.at(-1),outside[1]);assert.deepEqual(r.shape,e.shape);
});
test('delete automatic+automatic requests routing; every mixed combination stays manual',()=>{
 for(const modes of [['auto','auto'],['auto','straight'],['straight','auto'],['straight','straight']]){
  const e={...edit(),controls:[{id:'X',coordinate:mid}],shape:[{coordinate:geometry[0]},{coordinate:mid,controlId:'X'},{coordinate:geometry.at(-1)}],intervalModes:{'start>X':modes[0],'X>end':modes[1]}};seedRouteEdit(e,e.shape.map(p=>p.coordinate),{manual:false});deleteRouteControl(e,0);const expected=modes.every(m=>m==='auto')?'auto':'straight';assert.equal(e.intervals[0].mode,expected);assert.equal(!!e.intervals[0].retry,expected==='auto');
 }
});
test('failed automatic switch retains manual shape, reason and dashed classification',()=>{
 const e=edit();seedRouteEdit(e,geometry,{manual:true});const before=structuredClone(e.shape);switchRouteInterval(e,geometry,mid,{manual:true,scope:geometry});const result=routeIntervals(e,geometry[0],geometry.at(-1),null);assert.deepEqual(result.shape,before);assert.equal(result.intervals[0].network,false);assert.match(result.intervals[0].failureReason,/尚無/);
 const graph=buildGraph({nodes:{a:[121,24,100],b:[121.02,24,200]},ways:[{id:1,refs:['a','b'],tags:{}}]});const r=routeIntervals({...e,intervals:result.intervals.map(p=>({...p,retry:true}))},geometry[0],geometry.at(-1),graph);assert.equal(r.intervals[0].network,true);assert.equal(r.intervals[0].failureReason,undefined);assert.ok(r.intervals[0].networkProfile.every(p=>Number.isFinite(p[1])));
});
test('saved legacy detour becomes editable ordinary controls without changing its geometry',()=>{
 const e=edit();applyDetour(e,proposeDetour(geometry.map(coordinate=>({coordinate})),mid,[121.009,24.007],'B'));const before=structuredClone(e.shape);seedRouteEdit(e,e.shape.map(p=>p.coordinate),{manual:true});assert.equal(e.detour,undefined);assert.deepEqual(e.shape,before);deleteRouteControl(e,0);assert.equal(e.controls.length,2);assert.deepEqual(e.shape,intervalShape(e.intervals,e.controls));
});
function planDay(){return {id:'day',startTime:'06:00',coefficient:1,note:'',linkedStart:false,items:[{id:'a',type:'manual-location',name:'A',coordinate:geometry[0],incoming:null,note:''},{id:'b',type:'manual-location',name:'C',coordinate:geometry.at(-1),note:'',incoming:{kind:'official',from:'A',to:'C',fromId:'a',toId:'b',officialMinutes:65,actualMinutes:null}}]};}
const terrain={schemaVersion:1,nodes:[],spans:[],source:{attribution:'測試來源',license:'測試',copyrightUrl:'https://example.com',retrievedDate:'2026-11-17',url:'https://example.com'}};
test('promote B preserves mixed modes, original source time and full geometry through save and GPX',()=>{
 const day=planDay();editSegment(day,'b',e=>dragRoute(e,geometry,mid,[121.009,24.007],'B',{manual:false,scope:geometry,sourceName:'測試原線形',sourceUrl:'https://example.com/source',endpointCoordinates:[geometry[0],geometry.at(-1)]}));const before=day.items[1].pathEdit.shape.map(p=>p.coordinate);
 const item=promoteShapeControl(day,'b','B','營地');assert.deepEqual(item.pathEdit.intervals.map(p=>p.network),[true,false]);assert.deepEqual(day.items[2].pathEdit.intervals.map(p=>p.network),[false,true]);assert.equal(day.items[2].splitOriginalPathIncoming.officialMinutes,65);assert.equal(item.incoming.actualMinutes,null);
 const plan=JSON.parse(JSON.stringify({format:'mountain-planner',schemaVersion:1,routeId:null,days:[day]}));validatePlan(plan,[]);const resolved=resolveItineraryGeometry(plan.days,terrain),all=resolved.days[0].features.flatMap((f,i)=>f.coordinates.slice(i?1:0));assert.deepEqual(all,before);assert.ok(resolved.days[0].features.some(f=>f.fromItemId===item.id&&!f.manual));
 const gpx=geometryToGpx(resolved,terrain);assert.ok(gpx.includes('營地'));assert.ok(gpx.includes('手動幾何連接'));assert.ok(gpx.includes('測試原線形'));assert.equal((gpx.match(/<wpt /g)||[]).length,3);
 const bad=structuredClone(plan);bad.days[0].items[1].pathEdit.intervals[0].networkProfile=[[0,100],[1,NaN]];assert.throws(()=>validatePlan(bad,[]),/高程/);
});
test('adding a route itinerary point uses explicit arclength on a crossing and retains mode/source',()=>{
 const cross=[[121,24],[121.02,24.02],[121,24.02],[121.02,24],[121.03,24]],day=planDay();day.items[0].coordinate=cross[0];day.items[1].coordinate=cross.at(-1);const base=cross.map(coordinate=>({coordinate})),at=[121.01,24.01];
 const prefix=base.slice(0,3),walk=prefix.slice(1).reduce((n,p,i)=>n+Math.hypot(p.coordinate[0]-prefix[i].coordinate[0],p.coordinate[1]-prefix[i].coordinate[1]),0);
 const d=proposeDetour(base,at,[121.015,24.015],'unused',cross.slice(2,4));const position=projectOnShape(base.slice(2,4),at).along+projectOnShape(base.slice(0,3),cross[2]).total;
 assert.ok(walk>0&&d.start>0);const item=splitManualShape(day,'b',cross,at,'交叉分支','middle',position,{manual:false,scope:cross.slice(2,4),sourceName:'測試來源'});assert.deepEqual(item.pathEdit.shape.slice(0,3).map(p=>p.coordinate),cross.slice(0,3));assert.equal(item.pathEdit.intervals[0].network,true);assert.equal(day.items[2].splitOriginalIncoming.officialMinutes,65);
});
