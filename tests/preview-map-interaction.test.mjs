import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bindRouteDrag} from '../preview/js/route-drag.js';
import {resolveItineraryGeometry,profileNodeRows,renderTerrainProfile,distanceMeters,geometryToGpx} from '../preview/js/itinerary-geometry.js';

function gesture(pointer=true){
 const element=new EventTarget(),document=new EventTarget();element.style={};element.ownerDocument=document;document.defaultView={};
 let pan=true,enabled=true;const inserted=[],taps=[],preview=[];let cancelled=0;
 const map={dragging:{enabled:()=>pan,disable:()=>pan=false,enable:()=>pan=true},mouseEventToLatLng:p=>({lng:p.clientX,lat:p.clientY})};
 const unbind=bindRouteDrag({element,map,document,pointer,enabled:()=>enabled,onFinish:(...a)=>inserted.push(a),onTap:(...a)=>taps.push(a),onPreview:(...a)=>preview.push(a),onCancel:()=>cancelled++});
 const fire=(target,type,x=10,y=20,id=1)=>{const e=new Event(type,{cancelable:true});Object.assign(e,pointer?{clientX:x,clientY:y,pointerId:id,pointerType:'touch',button:0}:{changedTouches:[{clientX:x,clientY:y,identifier:id}]});target.dispatchEvent(e);return e;};
 return {element,document,map,fire,inserted,taps,preview,unbind,setEnabled:v=>enabled=v,get pan(){return pan;},get cancelled(){return cancelled;}};
}
test('touch pointer owns only enabled line gestures; release and cancellation restore map pan',()=>{
 const g=gesture();g.setEnabled(false);assert.equal(g.fire(g.element,'pointerdown').defaultPrevented,false);assert.equal(g.pan,true);
 g.setEnabled(true);assert.equal(g.fire(g.element,'pointerdown').defaultPrevented,true);assert.equal(g.pan,false);
 g.fire(g.document,'pointermove',50,60,2);assert.equal(g.preview.length,0);
 g.fire(g.document,'pointermove',50,60);g.fire(g.document,'pointerup',70,80);assert.equal(g.pan,true);assert.deepEqual(g.inserted,[[{lng:10,lat:20},{lng:70,lat:80}]]);assert.equal(g.taps.length,0);
 g.fire(g.element,'pointerdown');g.fire(g.document,'pointercancel');assert.equal(g.pan,true);assert.equal(g.inserted.length,1);assert.equal(g.cancelled,1);g.unbind();
});
test('legacy touch fallback ignores another lifted finger and locates the active finger in multi-touch lists',()=>{
 const g=gesture(false);g.fire(g.element,'touchstart');
 g.fire(g.document,'touchend',30,30,2);assert.equal(g.inserted.length,0);assert.equal(g.pan,false);
 const e=new Event('touchend',{cancelable:true});e.changedTouches=[{clientX:30,clientY:30,identifier:2},{clientX:80,clientY:70,identifier:1}];g.document.dispatchEvent(e);
 assert.deepEqual(g.inserted,[[{lng:10,lat:20},{lng:80,lat:70}]]);assert.equal(g.pan,true);g.unbind();
});
test('touch fallback distinguishes tap from drag and removal ends an in-progress gesture',()=>{
 const g=gesture(false);g.fire(g.element,'touchstart');g.fire(g.document,'touchend',12,22);assert.equal(g.taps.length,1);assert.equal(g.inserted.length,0);assert.equal(g.pan,true);
 const click=new Event('click',{cancelable:true});g.element.dispatchEvent(click);assert.equal(click.defaultPrevented,true);
 g.fire(g.element,'touchstart');g.fire(g.document,'touchmove',40,50);g.fire(g.document,'touchend',50,60);assert.equal(g.inserted.length,1);assert.equal(g.pan,true);
 g.fire(g.element,'touchstart');g.unbind();g.fire(g.document,'touchend',90,90);assert.equal(g.inserted.length,1);assert.equal(g.pan,true);
});

const data=JSON.parse(readFileSync(new URL('../data/geometry/planner-terrain-v1.json',import.meta.url),'utf8'));
const a=[121,24],x=[121.001,24],y=[121.002,24],b=[121.003,24],end=[121.004,24];
const len=points=>points.slice(1).reduce((s,p,i)=>s+distanceMeters(points[i],p),0);
const manual=(id,name,coordinate)=>({id,type:'manual-location',name,coordinate,showInTable:true,incoming:null});
function mixed(){
 const first=manual('start','甲',a),last=manual('end','乙',b),coordinates=[a,x,y,b];
 last.incoming={kind:'manual',fromId:'start',toId:'end',actualMinutes:31};
 last.pathEdit={fromItemId:'start',mode:'straight',controls:[],shape:coordinates.map(coordinate=>({coordinate})),intervals:[{key:'start>end',coordinates,mode:'auto',network:true,accessSegments:true,networkProfile:[[0,2800],[len([x,y]),2900]]}]};
 return {items:[first,last]};
}
test('mixed profile labels true itinerary visits once, including full access distance, without borrowing remote heights',()=>{
 const plan=mixed(),before=JSON.stringify(plan),d=resolveItineraryGeometry([plan],data).days[0],rows=profileNodeRows(d),html=renderTerrainProfile(d);
 assert.equal(d.features.length,3);assert.deepEqual(rows.map(n=>n.name),['甲','乙']);assert.equal(rows[0].distanceMeters,0);assert.equal(rows[1].distanceMeters,d.distanceMeters);
 assert.deepEqual(rows.map(n=>n.elevationMeters),[null,null]);assert.equal((html.match(/class="profile-node-label"/g)||[]).length,2);assert.match(html,/高度未取得/);assert.doesNotMatch(html,/NaN/);
 assert.equal(JSON.stringify(plan),before);assert.equal(plan.items[1].incoming.actualMinutes,31);
 const gpx=geometryToGpx({days:[d],gaps:[],unlocated:[],waypoints:[]},data);for(const p of [a,x,y,b])assert.ok(gpx.includes('lon="'+p[0]+'"'));
});
test('coincident source heights are available, hidden visits stay absent and repeated names keep visit identities',()=>{
 const plan=mixed();plan.items[0].coordinate=x;plan.items[1].coordinate=y;const edit=plan.items[1].pathEdit;edit.shape=[x,x,y,y].map(coordinate=>({coordinate}));edit.intervals[0].coordinates=[x,x,y,y];
 plan.items[1].name='甲';let rows=profileNodeRows(resolveItineraryGeometry([plan],data).days[0]);assert.equal(rows.length,2);assert.deepEqual(rows.map(n=>n.elevationMeters),[2800,2900]);assert.notEqual(rows[0].itemId,rows[1].itemId);
 plan.items[0].showInTable=false;rows=profileNodeRows(resolveItineraryGeometry([plan],data).days[0]);assert.deepEqual(rows.map(n=>n.itemId),['end']);
});
test('real Junda source profile labels use source DEM for selected nodes and exact feature distance',()=>{
 const ids=['g03-007','g03-006'],items=ids.map((nodeId,i)=>({id:'real-'+i,type:'location',nodeId,name:data.nodes.find(n=>n.nodeId===nodeId).name,incoming:i?{kind:'official',fromNodeId:ids[0],toNodeId:nodeId}:null}));
 const day=resolveItineraryGeometry([{items}],data).days[0],rows=profileNodeRows(day);assert.equal(day.gaps.length,0);assert.deepEqual(rows.map(n=>n.name),['郡大山北峰','郡大山']);assert.deepEqual(rows.map(n=>n.elevationMeters),ids.map(id=>data.nodes.find(n=>n.nodeId===id).elevationMeters));assert.equal(rows[1].distanceMeters,day.distanceMeters);
 assert.ok(day.features.every(f=>f.profile?.length>1));assert.ok(Math.abs(day.distanceMeters-day.features.reduce((s,f)=>s+len(f.coordinates),0))<.001);
});
test('GPX map naming remains identical to the actual production map entry, distinct from dated plan exports',()=>{
 const production=readFileSync(new URL('../js/itinerary-map.js',import.meta.url),'utf8'),preview=readFileSync(new URL('../preview/js/itinerary-map.js',import.meta.url),'utf8');
 const name=s=>s.match(/const name=`(mountain-planner-candidate[^`]+)`/)[1];assert.equal(name(preview),name(production));
 const editor=readFileSync(new URL('../js/unified-editor.js',import.meta.url),'utf8');assert.match(editor,/function exportName/);assert.match(editor,/tripStartDate\.replaceAll/);
});
