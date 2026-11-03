import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutProfileLabels,renderTerrainProfile} from '../js/itinerary-geometry.js';
test('label lanes are bounded and cannot collide; dense clusters use a numbered key',()=>{
 for(const distances of [[0,320,1330,1950,2060,2420,3430,4230,5710,6780,7080,10210],Array.from({length:25},(_,i)=>i*2)]){
  const nodes=distances.map((d,i)=>({name:'節點名稱'+i,distanceMeters:d,plotY:150}));
  const layout=layoutProfileLabels(nodes,10210);
  if(layout.numbered)assert.deepEqual(layout.boxes,[]);
  else for(const [i,b] of layout.boxes.entries()){
   assert.ok([-8,34,336,378].includes(b.y));assert.ok(b.x>=60&&b.x+b.w<=760);
   assert.ok(!layout.boxes.slice(0,i).some(a=>a.y===b.y&&a.x<b.x+b.w+6&&a.x+a.w+6>b.x));
  }
 }
 assert.equal(layoutProfileLabels(Array.from({length:25},(_,i)=>({name:'點'+i,distanceMeters:i})),10000).numbered,true);
});
test('many nearby labels preserve every name and data without increasing whitespace above plot',()=>{
 const features=Array.from({length:24},(_,i)=>({from:'點'+i,to:'點'+(i+1),distanceMeters:1,profile:[[0,3000],[1,2999]]}));
 const html=renderTerrainProfile({dayIndex:0,features,distanceMeters:24,ascentMeters:0,descentMeters:24,gaps:[]});
 assert.match(html,/viewBox="0 -80 800 /);
 for(let i=0;i<=24;i++)assert.ok(html.includes('點'+i));
 assert.match(html,/data-profile-export="download"/);assert.match(html,/約 3,000 m/);
});
