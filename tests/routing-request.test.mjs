import test from 'node:test';
import assert from 'node:assert/strict';
import {captureRoutingRequest,resolveRoutingRequest} from '../preview/js/routing-request.js';
import {syncLinkedDays} from '../preview/js/day-link.js';
const node=(id,coordinate)=>({id,type:'manual-location',name:id,coordinate,note:''});
function fixture(){const first=node('a',[121,24]),last=node('b',[121.01,24]),linked=node('linked',[121.01,24]),end=node('c',[121.02,24]);last.incoming={kind:'manual',fromId:'a',toId:'b',actualMinutes:null};linked._linkedSourceId='b';linked._linkedGenerated=true;end.incoming={kind:'manual',fromId:'linked',toId:'c',actualMinutes:null};return [{id:'day1',coefficient:1,items:[first,last]},{id:'day2',coefficient:1,linkedStart:true,items:[linked,end]}];}
test('a linked-day render must not cancel unchanged async routing inputs',()=>{
 const days=fixture(),oldTo=days[1].items[1],request=captureRoutingRequest(days[1],'c',{nodes:[]});
 syncLinkedDays(days,{nodes:[],segments:[]},()=> 'generated');
 assert.notStrictEqual(days[1].items[1],oldTo);assert.strictEqual(resolveRoutingRequest(days,request,{nodes:[]}).to,days[1].items[1]);
});
test('real endpoint, control, order and deletion changes invalidate pending routing',()=>{
 for(const change of [d=>d[1].items[1].coordinate[0]+=.001,d=>d[1].items[1].pathEdit={fromItemId:'linked',mode:'straight',controls:[]},d=>d[1].items.shift(),d=>d.pop()]){
  const days=fixture(),request=captureRoutingRequest(days[1],'c',{nodes:[]});change(days);assert.equal(resolveRoutingRequest(days,request,{nodes:[]}),null);
 }
});
test('routing resolves the current saved item and preserves independent name/time edits',()=>{
 const days=fixture(),request=captureRoutingRequest(days[1],'c',{nodes:[]}),restored=structuredClone(days);
 restored[1].items[1].name='改名';restored[1].items[1].incoming.actualMinutes=35;
 const current=resolveRoutingRequest(restored,request,{nodes:[]});assert.strictEqual(current.to,restored[1].items[1]);assert.equal(current.to.name,'改名');assert.equal(current.to.incoming.actualMinutes,35);
});
