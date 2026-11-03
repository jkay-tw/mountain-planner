import test from 'node:test';
import assert from 'node:assert/strict';
import {placeMapLabels} from '../js/map-label-layout.js';
const collision=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
test('out-and-back day labels and node labels are placed without overlap or route cover',()=>{
 const labels=[{name:'Day 1',point:{x:200,y:150},w:54,h:30},{name:'Day 2',point:{x:200,y:150},w:54,h:30},{name:'node',point:{x:210,y:150},w:90,h:32}];
 const placed=placeMapLabels(labels,[{x:210,y:150}],[[{x:0,y:150},{x:400,y:150}]],{x:400,y:300});
 assert.equal(placed.length,3);
 for(const [i,l] of placed.entries()){
  assert.ok(!placed.slice(0,i).some(p=>collision(l.box,p.box)));
  assert.ok(l.box.y+l.box.h<150||l.box.y>150);
 }
});
test('selected label is placed first and very dense maps omit labels instead of overlaps',()=>{
 const labels=[{selected:true,point:{x:50,y:50},w:60,h:45},...Array.from({length:15},()=>({point:{x:50,y:50},w:60,h:45}))];
 const placed=placeMapLabels(labels,[{x:50,y:50}],[],{x:140,y:120});
 assert.ok(placed[0].selected);assert.ok(placed.length<labels.length);
 for(const [i,l] of placed.entries())assert.ok(!placed.slice(0,i).some(p=>collision(l.box,p.box)));
});
