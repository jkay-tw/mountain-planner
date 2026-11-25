import test from 'node:test';
import {Script} from 'node:vm';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseGpx,sampleComponents} from '../tools/route-validator/gpx.mjs';
import {sequenceMatch,matchBothDirections,compareGeometry,DEFAULTS} from '../tools/route-validator/match.mjs';
import {normalizeSnapshot,loadSnapshot,loadProject,loadLibrary,registerGpx,evidenceGroups,auditRoute,runAudit,importCsv,WORK} from '../tools/route-validator/core.mjs';
import {parseCsv,hash,ROOT} from '../tools/route-validator/utils.mjs';
import {groupIssues,reportHtml,writeReports} from '../tools/route-validator/reports.mjs';
import {startServer} from '../tools/route-validator/server.mjs';
import {publicAddress,publicDownload} from '../tools/route-validator/network.mjs';

// Constructed fixtures test the algorithm, never count as external route evidence.
const A=[121,24],B=[121.003,24],C=[121.006,24.003],D=[121.006,24];
const points=coords=>coords.map(coordinate=>({coordinate,ele:null,time:null}));
const occ=coords=>coords.map((coordinate,i)=>({position:i+1,nodeId:String(i),coordinate}));
function gpx(coords,{name='synthetic',segments=null,times=false}={}) {
  return `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name>${(segments||[coords]).map(s=>'<trkseg>'+s.map((p,i)=>`<trkpt lon="${p[0]}" lat="${p[1]}">${times?`<time>2020-01-01T00:00:${String(i).padStart(2,'0')}Z</time>`:''}</trkpt>`).join('')+'</trkseg>').join('')}</trk></gpx>`;
}
function synthetic(sequence=['A','B','C']) {
  const coords={A,B,C,D},nodes=Object.keys(coords).map(id=>({id,name:id,aliases:[]})),segments=[],spans=[];
  for(let i=1;i<sequence.length;i++)for(const [a,b] of [[sequence[i-1],sequence[i]],[sequence[i],sequence[i-1]]])if(!segments.some(s=>s.fromId===a&&s.toId===b))segments.push({fromId:a,toId:b,minutes:20,travelMode:'walking',verificationStatus:'verified'});
  for(let i=1;i<sequence.length;i++)if(!spans.some(s=>new Set([s.fromId,s.toId]).has(sequence[i-1])&&new Set([s.fromId,s.toId]).has(sequence[i])))spans.push({id:'span'+i,fromId:sequence[i-1],toId:sequence[i],coordinates:[coords[sequence[i-1]],coords[sequence[i]]],reversible:true});
  const project={digest:'synthetic-fixture',inputs:[],source:'constructed test',graph:{nodes,segments,manualConnections:[],vehicleSegments:[]},geometry:{nodes:[],spans},nodes:new Map(nodes.map(n=>[n.id,n])),coordinates:new Map(Object.entries(coords).map(([id,coordinate])=>[id,{nodeId:id,coordinate}]))};
  const route={routeId:'R900',name:'constructed test route',type:'縱走',enabled:true,row:{sheetRow:2},occurrences:sequence.map((id,i)=>({position:i+1,nodeId:id,name:id,key:true}))};
  return {project,route,coords};
}
const source=(id,coords,extra={})=>{const parsed=parseGpx(gpx(coords));parsed.date=new Date().toISOString().slice(0,10);/* Synthetic source date for qualification tests, never real external evidence. */return {id,sha256:parsed.sha256,routeIds:['R900'],author:id,sourceUrl:'https://example.com/'+id,scope:'complete',variant:'defined-route',travelMode:'walking',parsed,...extra};};
const temp=()=>{const base=resolve(WORK,'tests');mkdirSync(base,{recursive:true});return mkdtempSync(resolve(base,'run-'));};
const cleanup=work=>{const base=resolve(WORK,'tests');assert.ok(work.startsWith(base+'\\run-')||work.startsWith(base+'/run-'));rmSync(work,{recursive:true,force:true});};

test('CSV header mapping, multiline notes and blank position history; summaries are not routes',()=>{
  assert.deepEqual(parseCsv('\uFEFFa,b\r\n"x,y","line1\nline2"\r\n'),[['a','b'],['x,y','line1\nline2']]);
  assert.throws(()=>parseCsv('a\n"unterminated'),/引號/);
  const snapshot={schemaVersion:1,sheets:{Routes_順序校核:{rows:[['類型','使用該路線','經典登山路線名稱','Route ID'],['往返','TRUE','Test','R900'],['','60','','']]},RouteNodes_順序校核:{rows:[['Node ID','節點名稱','Route ID','position'],['a','A','R900','2'],['b','B','R900',''],['c','C','R900','1']]}}};
  const n=normalizeSnapshot(snapshot);assert.equal(n.routes.length,1);assert.deepEqual(n.routes[0].occurrences.map(o=>o.nodeId),['c','a']);assert.equal(n.excluded.length,1);assert.equal(n.excluded[0].nodeId,'b');
  const duplicate=structuredClone(snapshot);duplicate.sheets.Routes_順序校核.rows.push(['往返','TRUE','Duplicate','R900']);assert.equal(normalizeSnapshot(duplicate).problems[0].code,'DUPLICATE_ROUTE_ID');
  const invalid=structuredClone(snapshot);invalid.sheets.RouteNodes_順序校核.rows[0][3]='錯誤欄位';assert.throws(()=>normalizeSnapshot(invalid),/position/);
});
test('GPX validates XML, coordinates and observations; no HTML, DTD, route points or silent truncation',()=>{
  const p=parseGpx(gpx([A,B,C],{name:'A &amp; B'}));assert.equal(p.label,'A & B');assert.equal(p.summary.points,3);
  for(const xml of ['<html>login</html>',gpx([A,B]).replace('</trk>',''),gpx([A,B]).replace('lat="24"','lat="NaN"'),gpx([A,B]).replace('<trk>','<!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///secret">]><trk>'),'<gpx version="1.1"><rte><rtept lat="24" lon="121"/></rte></gpx>',gpx([A,B]).replace('lon="121"','lon="121" lon="122"')])assert.throws(()=>parseGpx(xml));
  assert.throws(()=>parseGpx(gpx([A,B,C]),{maxPoints:2}),/點數/);
});
test('GPX segments and long jumps remain discontinuities; suspicious speed blocks walking evidence',()=>{
  const p=parseGpx(gpx(null,{segments:[[A,B],[C,D]]}));assert.equal(p.components.length,2);assert.equal(p.warnings[0].code,'MULTI_SEGMENT');
  const jump=parseGpx(gpx([A,B,[121.1,24],[121.103,24]]));assert.equal(jump.components.length,2);assert.ok(jump.warnings.some(w=>w.code==='TRACK_GAP'));
  assert.ok(parseGpx(gpx([A,B,C],{times:true})).warnings.some(w=>w.code==='SUSPECT_VEHICLE_OR_GPS'));
  assert.throws(()=>sampleComponents([points([A,B])],1,2),/SAMPLE_BUDGET/);
});
test('monotone global match supports correct and reverse GPX, and finds a deliberately swapped order',()=>{
  const components=[points([A,B,C])];
  const correct=sequenceMatch(occ([A,B,C]),components);assert.equal(correct.matched,3);assert.ok(correct.endpointComplete);
  const reverse=matchBothDirections(occ([A,B,C]),[points([C,B,A])]);assert.equal(reverse.matched,3);assert.equal(reverse.direction,'reverse');
  const wrong=matchBothDirections(occ([A,C,B]),components);assert.ok(wrong.matched<3);assert.ok(wrong.unmatchedButNearby.length);
});
test('repeated legal branch visits survive, unnecessary large backtracking cannot reuse one visit',()=>{
  const legal=[A,B,C,B,D];assert.equal(sequenceMatch(occ(legal),[points(legal)]).matched,5);
  const illegal=sequenceMatch(occ([A,B,C,B,C,D]),[points([A,B,C,D])]);assert.ok(illegal.matched<6);
  const repeated=sequenceMatch(occ([A,B,A]),[points([A,B,A])]);assert.equal(repeated.matched,3);assert.ok(repeated.matches[2].along>repeated.matches[0].along);
  const short=[A,B,[B[0],B[1]+.0006],B,D];assert.equal(sequenceMatch(occ(short),[points(short)]).matched,5);
});
test('offset coordinates, absent nodes, split tracks and candidate budget never turn into confident pass',()=>{
  assert.equal(sequenceMatch(occ([A,[B[0],B[1]+.0001],C]),[points([A,B,C])]).matched,3);
  const far=sequenceMatch(occ([A,[B[0],B[1]+.01],C]),[points([A,B,C])]);assert.equal(far.matched,2);
  const split=sequenceMatch(occ([A,B,C]),[points([A,B]),points([B,C])]);assert.equal(split.matched,3);assert.ok(split.segmentCrossings);
  assert.throws(()=>sequenceMatch(occ([A,B,C]),[points([A,B,C])],{maxChecks:1}),/BUDGET/);
  const crowded=sequenceMatch(occ([A]),[points([A,B,A,B,A,B])],{maxCandidates:1});assert.ok(crowded.truncated);
});
test('multiple feasible visits are reported as ambiguous rather than picking one silently',()=>{
  const result=sequenceMatch(occ([A,B,C]),[points([A,B,A,B,C])]);assert.ok(result.ambiguousPositions.includes(1)||result.ambiguousPositions.includes(0));
});
test('geometry compares both directions and detects an extra branch, not just node proximity',()=>{
  assert.ok(compareGeometry([A,B,C],[points([A,B,C])]).withinTolerance);
  const extra=[121.003,24.003];assert.ok(!compareGeometry([A,B,D],[points([A,B,extra,B,D])],{geometryMaxMeters:30}).withinTolerance);
  const repeat=compareGeometry([A,B],[points([A,B,A,B])]);assert.equal(repeat.toTrack.overLimit,0);assert.equal(repeat.toGeometry.overLimit,0);assert.ok(!repeat.withinTolerance);assert.ok(repeat.lengthDifferenceMeters>repeat.lengthDifferenceLimitMeters);
});
test('independence merges authors, identical/reversed shapes, repost URLs and near copies',()=>{
  const a=source('one',[A,B,C]),b=source('two',[C,B,A]),c=source('three',[A,D,C],{author:'one'}),d=source('four',[A,D,B],{sourceUrl:a.sourceUrl}),e=source('five',[[A[0],A[1]+.00001],[B[0],B[1]+.00001],[C[0],C[1]+.00001]]);
  const groups=evidenceGroups([a,b,c,d,e]);assert.equal(new Set(groups.map(g=>g.group)).size,1);
  assert.equal(evidenceGroups([source('unknown',[A,B,C],{author:''})])[0].eligible,false);
});
test('no GPX and reasonable variants remain unpassed; partial records do not accuse the full sequence',()=>{
  const {route,project}=synthetic();let r=auditRoute(route,project,{entries:[],errors:[]});assert.equal(r.status,'INSUFFICIENT_GPX');assert.equal(r.eligibleForImport,false);
  r=auditRoute(route,project,{entries:[source('variant',[A,D,C],{variant:'another-ridge'})],errors:[]});assert.equal(r.variants.length,1);assert.notEqual(r.status,'PASS');assert.ok(!r.issues.some(i=>i.code==='SUSPECT_SEQUENCE'));
  r=auditRoute(route,project,{entries:[source('partial',[A,B],{scope:'partial'})],errors:[]});assert.ok(!r.issues.some(i=>['SUSPECT_SEQUENCE','MANUAL_REVIEW'].includes(i.code)));
});
test('three qualified distinct recordings can satisfy checks without changing official verification',()=>{
  const {route,project}=synthetic();
  const entries=[.00011,-.00011,.00024].map((offset,i)=>source('independent-'+i,[[A[0],A[1]+offset],[B[0],B[1]+offset],[C[0],C[1]+offset]]));
  const r=auditRoute(route,project,{entries,errors:[]},{...DEFAULTS,geometryMaxMeters:30});
  assert.equal(r.independentSupporting,3);assert.equal(r.status,'PASS');assert.equal(r.eligibleForImport,false);assert.equal(r.proposal.after,null);
});
test('a uniquely corroborated reorder becomes a suggestion, never an automatic mutation',()=>{
  const {project}=synthetic(['A','B','C','D']),{route}=synthetic(['A','C','B','D']);
  const original=structuredClone(route),entries=[.00011,-.00011,.00024].map((offset,i)=>source('reorder-'+i,[A,B,C,D].map(p=>[p[0],p[1]+offset])));
  const result=auditRoute(route,project,{entries,errors:[]});
  assert.deepEqual(result.proposal.after?.map(o=>o.nodeId),['A','B','C','D']);assert.deepEqual(route,original);assert.equal(result.status,'MANUAL_REVIEW');assert.equal(result.eligibleForImport,false);
  assert.equal(auditRoute(route,project,{entries:entries.slice(0,2),errors:[]}).proposal.after,null);
});

test('old or undated recordings cannot pass, vote against, or propose a reorder even in large numbers',()=>{
  const entries=[.00011,-.00011,.00024].map((offset,i)=>source('historical-'+i,[A,B,C,D].map(p=>[p[0],p[1]+offset])));
  for(const entry of entries)entry.parsed.date='2018-01-01';
  const {project}=synthetic(['A','B','C','D']);
  let r=auditRoute(synthetic(['A','B','C','D']).route,project,{entries,errors:[]});
  assert.equal(r.independentSupporting,0);assert.notEqual(r.status,'PASS');
  r=auditRoute(synthetic(['A','C','B','D']).route,project,{entries,errors:[]});
  assert.equal(r.independentOpposing,0);assert.equal(r.proposal.after,null);
  assert.ok(!r.issues.some(issue=>issue.code==='SUSPECT_SEQUENCE'));
  for(const entry of entries)entry.parsed.date=null;
  r=auditRoute(synthetic(['A','B','C','D']).route,project,{entries,errors:[]});
  assert.equal(r.independentSupporting,0);assert.notEqual(r.status,'PASS');
});
test('reverse missing minutes, source-lineage reuse and fast/mixed recordings block positive conclusions',()=>{
  const {route,project}=synthetic();
  const a=source('one',[A,B,C]);project.geometry.spans[0].sourceFileSha256=a.parsed.sha256;
  let r=auditRoute(route,project,{entries:[a],errors:[]});assert.ok(r.sources[0].qualityReasons.some(s=>s.includes('獨立外部')));
  project.graph.segments=project.graph.segments.filter(e=>!(e.fromId==='C'&&e.toId==='B'));
  r=auditRoute(route,project,{entries:[],errors:[]});assert.ok(r.issues.some(i=>i.code==='MISSING_TIME'&&i.details.direction==='reverse'));
  const fast=source('fast',[A,B,C],{parsed:parseGpx(gpx([A,B,C],{times:true}))});r=auditRoute(route,synthetic().project,{entries:[fast],errors:[]});assert.equal(r.independentSupporting,0);
  r=auditRoute(route,synthetic().project,{entries:[source('mixed',[A,B,C],{travelMode:'mixed'})],errors:[]});assert.equal(r.independentSupporting,0);
});
test('invalid structure, explicit incomplete intent, ID/name discrepancy and nearby nodes block pass',()=>{
  const {route,project}=synthetic();route.occurrences[1].position=1;let r=auditRoute(route,project,{entries:[],errors:[]});assert.equal(r.status,'INVALID_DATA');
  const clean=synthetic();clean.route.row.notes='目前僅核心片段';r=auditRoute(clean.route,clean.project,{entries:[],errors:[]});assert.ok(r.issues.some(i=>i.code==='INCOMPLETE_ROUTE'));
  clean.route.occurrences[1].name='C';r=auditRoute(clean.route,clean.project,{entries:[],errors:[]});assert.ok(r.issues.some(i=>i.code==='NAME_DIFFERENCE'));assert.equal(r.proposal.after,null);
  const unknown=synthetic();unknown.route.type='猜測類型';assert.equal(auditRoute(unknown.route,unknown.project,{entries:[],errors:[]}).status,'INVALID_DATA');
});
test('GPX library is immutable by hash, reimports reuse files and cache invalidates on corruption',()=>{
  const work=temp();try{
    const bytes=Buffer.from(gpx([A,B,C]));const first=registerGpx(bytes,{routeIds:['R900'],sourceUrl:'https://example.com/first',author:'甲'},work),second=registerGpx(bytes,{routeIds:['R901'],sourceUrl:'https://example.com/repost',author:'乙'},work);assert.equal(first.id,second.id);
    assert.deepEqual(second.sourceRecords.map(s=>s.sourceUrl),['https://example.com/first','https://example.com/repost']);
    const index=JSON.parse(readFileSync(resolve(work,'sources.json')));assert.equal(index.sources.length,1);assert.deepEqual(index.sources[0].routeIds,['R900','R901']);
    const found=loadLibrary(work);assert.ok(found.entries.some(s=>s.id===first.id));
    const cache=resolve(work,'cache/gpx',readdirSync(resolve(work,'cache/gpx')).find(name=>name.startsWith(first.sha256)));writeFileSync(cache,'{broken cache');assert.equal(loadLibrary(work).entries.find(s=>s.id===first.id).parsed.summary.points,3);
    writeFileSync(resolve(work,first.file),gpx([A,D,C]));assert.ok(loadLibrary(work).errors.some(e=>e.sourceId===first.id));
  }finally{cleanup(work);}
});
test('public downloader rejects private hosts and unsafe schemes without following login gates',async()=>{
  for(const address of ['127.0.0.1','10.1.2.3','172.16.1.2','192.168.1.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1'])assert.equal(publicAddress(address),false,address);
  assert.equal(publicAddress('8.8.8.8'),true);
  await assert.rejects(publicDownload('http://example.com/x.gpx'),/HTTPS/);
  await assert.rejects(publicDownload('https://127.0.0.1/x.gpx'),/私人/);
  await assert.rejects(publicDownload('https://example.com/login'),/登入/);
});
test('local dashboard protects mutations from cross-origin/unauthenticated callers and path traversal',async()=>{
  const work=temp();const {server,url}=await startServer({work,open:false});
  try{
    const html=await (await fetch(url)).text();assert.ok(html.includes('更新 Google Sheet'));assert.doesNotThrow(()=>new Script(html.split('<script>')[1].split('</script>')[0]));
    assert.equal((await fetch(url+'/api/status')).status,200);
    assert.equal((await fetch(url+'/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
    const token=/const token="([a-f0-9]+)"/.exec(html)[1];
    assert.equal((await fetch(url+'/api/run',{method:'POST',headers:{'Content-Type':'application/json','X-Route-Validator':token,Origin:'https://malicious.example'},body:'{}'})).status,403);
    assert.equal((await fetch(url+'/reports/..%2f..%2fdata/route-validator/sources.json')).status,404);
    const invalid=await fetch(url+'/api/import-csv',{method:'POST',headers:{'Content-Type':'application/json','X-Route-Validator':token},body:JSON.stringify({routes:'bad',nodes:'bad'})});assert.equal(invalid.status,400);assert.ok(!existsSync(resolve(work,'snapshot.json')));
  }finally{await new Promise(r=>server.close(r));cleanup(work);}
});
test('latest actual Sheet snapshot has 60 enabled routes, 1469 valid occurrences, 26 excluded rows and R031',()=>{
  const work=temp();const input=loadSnapshot(work);cleanup(work); // fallback is the immutable checked-in snapshot
  assert.equal(input.routes.length,86);assert.equal(input.routes.filter(r=>r.enabled).length,60);assert.equal(input.routes.reduce((n,r)=>n+r.occurrences.length,0),1469);assert.equal(input.excluded.length,26);assert.ok(input.routes.some(r=>r.routeId==='R031'&&r.name==='志雪劍'));assert.ok(!input.routes.some(r=>r.routeId==='R089'));
});
test('real pilot audit distinguishes concrete ID conflict from unproven GPX conclusions; cache is reproducible',()=>{
  const work=temp();try{
    const project=loadProject(),options={work,project,snapshotPath:resolve(ROOT,'data/route-validator/snapshots/sheet-20261124.json'),routeIds:['R001','R015','R030','R066','R077','R031']};
    const first=runAudit(options),second=runAudit(options);assert.equal(first.counts.pass,0);assert.deepEqual(first.results,second.results);assert.equal(second.counts.cachedRoutes,6);
    const yushan=first.results.find(r=>r.routeId==='R001');assert.ok(yushan.issues.some(i=>i.code==='NAME_DIFFERENCE'&&i.nodeIds.includes('g02-002')));assert.ok(yushan.proposal.changes.some(c=>c.candidates.some(n=>n.nodeId==='g02-006')));
    const south=first.results.find(r=>r.routeId==='R066');assert.ok(south.issues.some(i=>i.code==='INCOMPLETE_ROUTE'));
    const corrected=runAudit({...options,snapshotPath:resolve(ROOT,'data/route-validator/snapshots/sheet-20261124-corrected.json')});assert.ok(!corrected.results.find(r=>r.routeId==='R001').issues.some(i=>['NAME_DIFFERENCE','MISSING_EDGE'].includes(i.code)));assert.equal(corrected.provenance.nodeAuthority.sheetId,102);assert.equal(corrected.counts.pass,0);
    const known=runAudit({work,project,routeIds:['R057']}).results[0];assert.ok(known.issues.filter(i=>i.code==='MISSING_TIME').every(i=>i.severity==='data'&&i.details.knownManualPolicy));assert.equal(known.timeStatus,'MISSING_TIME');assert.notEqual(known.status,'PASS');
    const integrated=runAudit({work,project,routeIds:['R057','R069']});
    assert.ok(integrated.results.every(r=>!r.issues.some(i=>['MISSING_EDGE','MISSING_GEOMETRY','SOURCE_DIFFERENCE'].includes(i.code))));
    assert.ok(groupIssues(first).length<first.results.flatMap(r=>r.issues.filter(i=>['review','error'].includes(i.severity))).length);
    const out=resolve(work,'output');writeReports(first,out,{project,library:loadLibrary(work)});assert.ok(existsSync(resolve(out,'index.html')));assert.ok(existsSync(resolve(out,'anomalies.csv')));
    const malicious=structuredClone(first);malicious.results[0].name='<script>alert(1)</script>';malicious.results[0].issues[0].message='<img src=x onerror=alert(1)>';
    const html=reportHtml(malicious);assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('&lt;script&gt;'));
    assert.equal(hash(readFileSync(resolve(ROOT,'data/route-validator/snapshots/sheet-20261124.json'))),first.provenance.sheetSnapshotSha256);
  }finally{cleanup(work);}
});
