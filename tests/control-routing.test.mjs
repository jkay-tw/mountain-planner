import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGraph} from '../preview/js/osm-pilot-router.js';
import {routeIntervals,rememberIntervals} from '../preview/js/control-routing.js';
import {insertShapeControl} from '../preview/js/path-editor.js';
const graph=buildGraph({nodes:{a:[121,24],b:[121.02,24],c:[121.02,24.02],d:[121,24.02]},ways:[{id:1,refs:['a','b','c','d'],tags:{}}]});
test('mixed adjacent intervals preserve exact controls and keep an unaffected confirmed interval',()=>{
 const edit={controls:[{id:'A',coordinate:[121.015,24]},{id:'B',coordinate:[121.03,24.01]},{id:'C',coordinate:[121.02,24.015]}],intervalModes:{'A>B':'straight','B>C':'straight'}};
 const a=[121.005,24],b=[121.005,24.02],first=routeIntervals(edit,a,b,graph);assert.equal(first.intervals[0].network,true);assert.equal(first.intervals[1].network,false);
 edit.intervals=first.intervals;edit.controls[1].coordinate=[121.04,24.01];const next=routeIntervals(edit,a,b,graph);
 assert.strictEqual(next.intervals[0],first.intervals[0]);assert.strictEqual(next.intervals[3],first.intervals[3]);assert.deepEqual(next.shape.filter(p=>p.controlId).map(p=>p.controlId),['A','B','C']);assert.deepEqual(next.shape.find(p=>p.controlId==='B').coordinate,[121.04,24.01]);
});
test('inserting D into manual A-B inherits mode and preserves ordered geometry outside that interval',()=>{
 const edit={fromItemId:'s',mode:'straight',controls:[{id:'A',coordinate:[121.01,24]},{id:'B',coordinate:[121.02,24]},{id:'C',coordinate:[121.03,24]}],intervalModes:{'A>B':'straight'},shape:[{coordinate:[121,24]},{coordinate:[121.01,24],controlId:'A'},{coordinate:[121.02,24],controlId:'B'},{coordinate:[121.03,24],controlId:'C'},{coordinate:[121.04,24]}]};rememberIntervals(edit);
 const day={items:[{id:'s',type:'manual-location'},{id:'t',type:'manual-location',incoming:{kind:'manual',actualMinutes:null},pathEdit:edit}]};insertShapeControl(day,'t',edit.shape.map(p=>p.coordinate),[121.015,24],[121.015,24.01],'D');
 const e=day.items[1].pathEdit;assert.deepEqual(e.controls.map(c=>c.id),['A','D','B','C']);assert.equal(e.intervalModes['A>D'],'straight');assert.equal(e.intervalModes['D>B'],'straight');const r=routeIntervals(e,[121,24],[121.04,24],null);assert.deepEqual(r.intervals[0].coordinates,[[121,24],[121.01,24]]);
});
test('disconnected or absent network retains unknown manual geometry without inventing a route',()=>{const r=routeIntervals({controls:[]},[120,23],[122,25],graph);assert.equal(r.intervals[0].network,false);assert.deepEqual(r.shape.map(p=>p.coordinate),[[120,23],[122,25]]);});
test('inserting an on-line control retains both bent halves even without a routing graph',()=>{
 const shape=[[121,24],[121.005,24.005],[121.01,24],[121.02,24]].map(coordinate=>({coordinate}));
 const day={items:[{id:'s'},{id:'t',incoming:{kind:'manual',actualMinutes:null},pathEdit:{fromItemId:'s',mode:'straight',controls:[],shape}}]};
 insertShapeControl(day,'t',shape.map(p=>p.coordinate),[121.0075,24.0025],[121.0075,24.0025],'q');
 const edit=day.items[1].pathEdit,expected=structuredClone(edit.shape),r=routeIntervals(edit,[121,24],[121.02,24],null,{recalculate:true});
 assert.deepEqual(r.shape,expected);assert.equal(r.failures.length,2);
});
test('one selected interval can retry routing while unrelated geometry is retained',()=>{
 const edit={controls:[{id:'q',coordinate:[121.02,24]}],shape:[{coordinate:[121,24]},{coordinate:[121.01,24.005]},{coordinate:[121.02,24],controlId:'q'},{coordinate:[121.02,24.02]}]};rememberIntervals(edit);
 edit.intervals[0].retry=true;const untouched=edit.intervals[1];const r=routeIntervals(edit,[121,24],[121.02,24.02],graph);
 assert.equal(r.intervals[0].network,true);assert.strictEqual(r.intervals[1],untouched);
 const missing=routeIntervals(edit,[121,24],[121.02,24.02],null);assert.deepEqual(missing.intervals[0].coordinates,edit.intervals[0].coordinates);assert.equal(missing.intervals[0].retry,false);
});
