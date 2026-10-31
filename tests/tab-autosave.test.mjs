import test from 'node:test';
import assert from 'node:assert/strict';
import {createTabAutosave} from '../js/tab-autosave.js';
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)}};
const plan=name=>({format:'mountain-planner',routeId:'GLOBAL-PREVIEW',scope:'all',tripStartDate:'',days:[{note:name}]});
test('A/B refresh independently; new tab loads last edit; refresh and scope do not overwrite backup',()=>{
 const local=memory(),a=memory(),b=memory();const make=session=>createTabAutosave({local,session,key:'production'});
 const A=make(a);assert.equal(A.load(),null);A.save(plan('empty'),{shared:false});A.save(plan('A'));
 const B=make(b);assert.equal(B.load().days[0].note,'A');B.save(plan('B'));
 const refreshed=make(a);assert.equal(refreshed.load().days[0].note,'A');refreshed.save(plan('A'),{shared:false});
 refreshed.save({...plan('A'),scope:'G13'});assert.equal(make(memory()).load().days[0].note,'B');
 assert.equal(make(b).load().days[0].note,'B');refreshed.save(plan('A2'));assert.equal(make(memory()).load().days[0].note,'A2');
});
test('duplicated tab copies initial session but subsequent edits are isolated',()=>{
 const local=memory(),s=memory();const init=createTabAutosave({local,session:s,key:'x'});init.save(plan('A'),{shared:false});
 const duplicate=memory();duplicate.setItem('x.tab',s.getItem('x.tab'));
 const b=createTabAutosave({local,session:duplicate,key:'x'});b.load();b.save(plan('B'));
 assert.equal(createTabAutosave({local,session:s,key:'x'}).load().days[0].note,'A');
});
test('legacy migration and reset preserve legacy; preview and production remain separate',()=>{
 const local=memory();local.setItem('legacy',JSON.stringify(plan('old')));
 const prod=createTabAutosave({local,session:memory(),key:'prod',legacyKey:'legacy'});
 assert.equal(prod.load().days[0].note,'old');prod.save(plan('migrated'),{shared:false});
 assert.equal(local.getItem('prod'),null);prod.save(plan('reset'));
 assert.equal(JSON.parse(local.getItem('legacy')).days[0].note,'old');
 assert.equal(createTabAutosave({local,session:memory(),key:'preview'}).load(),null);
});
test('unavailable storage does not crash; corrupt tab cache falls back to valid backup',()=>{
 const bad={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};
 const store=createTabAutosave({local:bad,session:bad,key:'x'});assert.equal(store.load(),null);store.save(plan('x'),{shared:false});
 const local=memory(),session=memory();local.setItem('x',JSON.stringify(plan('valid')));session.setItem('x.tab','broken');
 assert.equal(createTabAutosave({local,session,key:'x'}).load().days[0].note,'valid');
});
