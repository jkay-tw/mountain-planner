import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {migrateDaysToNodeIds} from '../js/node-identity.js';
import {toTwd97} from '../js/twd97.js';
const load=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));

test('owner G04 correction keeps identity and changes only explicitly directed links',()=>{
 const r=load('data/routes/owner-reviewed/G04.json');
 const n=r.nodes.find(n=>n.id==='g04-007');
 assert.equal(n.name,'大霸霸基');assert.deepEqual(n.aliases,['大霸尖山霸基']);
 assert.ok(n.legacyAliases.includes('大霸尖山'));
 const expected=new Map([['g04-011>g04-007',30],['g04-007>g04-011',35],['g04-007>g04-010',10],['g04-010>g04-007',10]]);
 for(const [key,minutes] of expected){const e=r.segments.find(s=>s.fromId+'>'+s.toId===key);assert.equal(e.minutes,minutes);assert.equal(e.verificationBasis,'owner_explicit_chat_20261112');assert.equal(e.sources[0].kind,'owner-chat');}
 for(const [a,b] of [['g04-007','g04-fork-daba'],['g04-fork-daba','g04-007'],['g04-011','g04-010'],['g04-010','g04-011']])assert.ok(!r.segments.some(s=>s.fromId===a&&s.toId===b));
 const terrain=load('preview/data/geometry/planner-terrain-v1.json');
 assert.deepEqual(toTwd97(terrain.nodes.find(n=>n.nodeId==='g04-007').coordinate),[276194,2706000]);
 for(const id of ['g04-010','g04-011'])assert.ok(terrain.spans.some(s=>[s.fromId,s.toId].includes(id)&&[s.fromId,s.toId].includes('g04-007')));
 const days=[{items:[{type:'location',nodeId:'g04-007',name:'大霸尖山',note:'保留'}]}];
 assert.equal(migrateDaysToNodeIds(days,r)[0].items[0].note,'保留');
});

test('sheet removal hides aliases but preserves old itinerary imports',()=>{
 const r=load('data/routes/owner-reviewed/G19.json'),n=r.nodes.find(n=>n.id==='local:G19::shenchi-camp');
 assert.deepEqual(n.aliases,[]);assert.ok(n.legacyAliases.includes('第一水源'));
 assert.equal(migrateDaysToNodeIds([{items:[{type:'location',nodeId:n.id,name:'第一水源'}]}],r)[0].items[0].nodeId,n.id);
});
