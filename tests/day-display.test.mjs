import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDayDisplay,applyDayDisplay,displayCount} from '../preview/js/day-display.js';
const day=()=>({displayMode:'important',items:[{id:'a',type:'location',nodeId:'A',classicRoute:{key:true},showInTable:true,incoming:null},{id:'b',type:'location',nodeId:'B',classicRoute:{key:false},showInTable:false,incoming:{actualMinutes:117}},{id:'r',type:'rest',minutes:15},{id:'c',type:'location',nodeId:'A',classicRoute:{key:true},showInTable:true,incoming:{actualMinutes:53}}]});
test('counts use occurrence identity, exclude rests and protect both endpoints',()=>{
 const d=day();assert.deepEqual(displayCount(d),{shown:2,total:3});applyDayDisplay(d,'custom',[]);assert.deepEqual(displayCount(d),{shown:2,total:3});assert.equal(d.items[0].showInTable,true);assert.equal(d.items.at(-1).showInTable,true);
});
test('all then important reveals individual segments without changing times or the full sequence',()=>{
 const d=day(),before=d.items.map(i=>JSON.stringify(i.incoming));applyDayDisplay(d,'all');assert.equal(displayCount(d).shown,3);applyDayDisplay(d,'important');assert.equal(displayCount(d).shown,2);assert.deepEqual(d.items.map(i=>JSON.stringify(i.incoming)),before);
});
test('legacy hidden choices are preserved and old Route importance falls back to waypoint',()=>{
 const d=day();delete d.displayMode;normalizeDayDisplay(d);assert.equal(d.displayMode,'custom');assert.equal(d.items[1].showInTable,false);
 delete d.items[1].classicRoute.key;d.items[1].waypoint=true;applyDayDisplay(d,'important');assert.equal(d.items[1].showInTable,true);
});
test('custom survives refresh, JSON and manual insertions; DAYs remain independent',()=>{
 const d=day(),other=day();applyDayDisplay(d,'custom',['a','b','c']);const copy=JSON.parse(JSON.stringify(d));normalizeDayDisplay(copy);assert.equal(copy.items[1].showInTable,true);assert.equal(other.items[1].showInTable,false);
 copy.items.splice(2,0,{id:'manual',type:'manual-location',showInTable:true});normalizeDayDisplay(copy);assert.equal(displayCount(copy).shown,4);
});
test('important keeps manual additions but not newly generated intermediate points',()=>{
 const d=day();d.items.splice(2,0,{id:'new',type:'manual-location'},{id:'auto',type:'location',auto:true,waypoint:false});normalizeDayDisplay(d);assert.equal(d.items[2].showInTable,true);assert.equal(d.items[3].showInTable,false);
});
