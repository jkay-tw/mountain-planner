import test from 'node:test';
import assert from 'node:assert/strict';
import {requestWithManualCore} from '../preview/js/osm-planner-integration.js';

test('core prompt appears only when a search reports it may help, and retries after consent',async()=>{
 let calls=[],prompts=0,enabled=false;
 const worker={request:async(kind,details)=>{calls.push({kind,details});if(kind==='manual'){enabled=true;return {}}return enabled?{result:['found'],manualRequired:false}:{result:[],manualRequired:true}}};
 const details={points:[[121.5,25],[121.51,25.01]]};
 const denied=await requestWithManualCore(worker,'intervals',details,()=>{prompts++;return false});
 assert.deepEqual(denied.result,[]);assert.deepEqual(calls.map(x=>x.kind),['intervals']);
 const accepted=await requestWithManualCore(worker,'intervals',details,()=>{prompts++;return true});
 assert.deepEqual(accepted.result,['found']);assert.deepEqual(calls.map(x=>x.kind),['intervals','intervals','manual','intervals']);assert.equal(prompts,2);
 await requestWithManualCore(worker,'intervals',details,()=>{throw Error('unnecessary prompt')});
});
