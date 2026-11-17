import test from 'node:test';
import assert from 'node:assert/strict';
import {promoteShapeControl} from '../preview/js/path-editor.js';

test('promote a control on a crossing line at its stored position without losing shape or source time',()=>{
 const points=[[121,24],[121.02,24.02],[121,24.02],[121.02,24],[121.03,24]];
 const shape=points.map((coordinate,i)=>({coordinate,...(i===3?{controlId:'b'}:{})}));
 const day={items:[{id:'a',type:'manual-location',coordinate:points[0]},{id:'z',type:'manual-location',coordinate:points[4],incoming:{kind:'manual',actualMinutes:23},pathOriginalIncoming:{kind:'official',officialMinutes:10},pathEdit:{fromItemId:'a',mode:'straight',controls:[{id:'b',coordinate:points[3]}],shape}}]};
 const item=promoteShapeControl(day,'z','b','營地');
 assert.equal(item.name,'營地');assert.deepEqual(item.coordinate,points[3]);assert.deepEqual(item.pathEdit.shape.map(p=>p.coordinate),points.slice(0,4));assert.deepEqual(day.items[2].pathEdit.shape.map(p=>p.coordinate),points.slice(3));assert.equal(day.items[2].splitOriginalIncoming.actualMinutes,23);assert.equal(day.items[2].splitOriginalPathIncoming.officialMinutes,10);assert.equal(item.incoming.actualMinutes,null);assert.equal(day.items[2].incoming.actualMinutes,null);
});
