import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reportCatalog} from '../tools/report-route-coverage.mjs';

test('unified-preview catalog has unique directional edges, stable physical IDs and no candidate walking shortcuts',()=>{
 const load=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
 const summary=reportCatalog(load('data/unified-editor-manifest.json'),load);
 assert.equal(summary.datasetCount,10);
 assert.equal(summary.inputDirectedEdges,552);
 assert.ok(summary.uniqueDirectedEdges<=summary.inputDirectedEdges);
 assert.ok(summary.physicalNodes<=summary.inputNodes);
 assert.ok(summary.charts.some(r=>r.id==='G04'&&r.directedEdges===146));
 assert.ok(summary.charts.some(r=>r.id==='G17G18-PREVIEW'&&r.directedEdges===46));
});
test('coverage validator rejects duplicate chart IDs and illegal walking edge metadata',()=>{
 const base={route_id:'X',nodes:[{id:'a',name:'A'},{id:'b',name:'B'}],
   segments:[{from:'A',to:'B',fromId:'a',toId:'b',minutes:10,travelMode:'walking',verificationStatus:'verified'}]};
 const manifest={dataset_version:'test',routes:[{id:'X',file:'x.json',status:'test'}]};
 const load=()=>JSON.parse(JSON.stringify(base));
 assert.equal(reportCatalog(manifest,load).uniqueDirectedEdges,1);
 assert.throws(()=>reportCatalog({...manifest,routes:[manifest.routes[0],manifest.routes[0]]},load),/Duplicate manifest/);
 assert.throws(()=>reportCatalog(manifest,()=>({...base,segments:[{...base.segments[0],verificationStatus:'pending'}]})),/Candidate edge/);
 assert.throws(()=>reportCatalog(manifest,()=>({...base,segments:[{...base.segments[0],travelMode:'vehicle'}]})),/Vehicle edge/);
});
