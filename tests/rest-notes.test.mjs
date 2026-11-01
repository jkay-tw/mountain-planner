import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildTimeline,normalizeDay} from '../js/planner.js';
import {validatePlan} from '../js/validation.js';
test('rest notes survive timeline, JSON validation and normalization while old plans remain valid',()=>{
 const day={startTime:'06:00',coefficient:.8,note:'',linkedStart:false,items:[{id:'r',type:'rest',minutes:15,note:'取水拍照'}]};
 const data={format:'mountain-planner',schemaVersion:1,routeId:'G06',tripStartDate:'',days:[day]};
 assert.equal(validatePlan(data,['G06']).days[0].items[0].note,'取水拍照');
 assert.equal(buildTimeline(day).rows[0].note,'取水拍照');normalizeDay(day,{segments:[]});assert.equal(day.items[0].note,'取水拍照');
 delete day.items[0].note;assert.doesNotThrow(()=>validatePlan(data,['G06']));
 day.items[0].note=123;assert.throws(()=>validatePlan(data,['G06']),/休息備註/);
});
test('rest input and Excel output expose the note',()=>{
 const app=readFileSync(new URL('../js/unified-editor.js',import.meta.url),'utf8');const rest=app.slice(app.indexOf("if(r.type==='rest')"),app.indexOf('}else{',app.indexOf("if(r.type==='rest')")));
 assert.match(rest,/note-input/);assert.match(rest,/esc\(r.note/);
 const exporter=readFileSync(new URL('../js/exporter.js',import.meta.url),'utf8');assert.match(exporter,/r\.endTime,Number\(r\.minutes\)\|\|0,'','',r\.note\|\|''/);
});
