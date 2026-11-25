#!/usr/bin/env node
// Offline deterministic Sheet snapshot -> candidate catalog. Never publishes.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,relative} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {withClassicSources} from '../preview/js/classic-route-source.js';
import {sampleBilinear,alongLine} from '../preview/js/mainland-dem.js';
import {routeContext,compileClassicRoute,reverseClassicRoute,validateClassicRoute} from '../preview/js/classic-route.js';
import {normalizeSnapshot} from './route-validator/core.mjs';
import {mergeReviewedRoutes} from '../preview/js/global-route.js';
import {reviewedBindings} from './classic_route_bindings.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const json=p=>JSON.parse(read(p));
const hash=s=>createHash('sha256').update(s).digest('hex');
export function buildLegacyCatalog(){
 const snapshotPath='data/staging/idea002/sheet-snapshot-20261120.json',decisionPath='data/staging/idea002/decisions-20261120.json';
 const snapshot=json(snapshotPath),decisions=json(decisionPath);
 const enabledPath='data/staging/idea002/all-enabled-sheet-20261123.json',enabled=json(enabledPath);
 if(!/^[a-f0-9]{40}$/.test(decisions.baseCommit)||snapshot.baseCommit!==decisions.baseCommit)throw Error('Invalid or inconsistent base commit');
 // Read the approved commit, never another task's dirty geometry or datasets.
 const baseline=p=>execFileSync('git',['show',(decisions.dataCommit||decisions.baseCommit)+':'+p],{cwd:root,encoding:'utf8',maxBuffer:30_000_000});
 const manifest=JSON.parse(baseline('preview/data/unified-editor-manifest.json'));
 const datasets=manifest.routes.map(m=>JSON.parse(baseline('preview/'+m.file.split('?')[0])));
 const graph={nodes:[...new Map(datasets.flatMap(r=>r.nodes.map(n=>[n.id,n]))).values()],segments:datasets.filter(r=>r.routingEnabled!==false).flatMap(r=>r.segments),manualConnections:datasets.filter(r=>r.routingEnabled!==false).flatMap(r=>r.manualConnections||[])};
 const geometryText=baseline('preview/data/geometry/planner-terrain-v1.json');
 const evidencePath='data/staging/idea002/r057-osm-evidence-20261120.json',evidence=json(evidencePath),track=evidence.directions[0],dem=json('preview/data/dem-mainland/manifest.json'),tiles=new Map();
 const samples=alongLine(track.coordinates),profile=samples.map(s=>{const [lon,lat]=s.coordinate,x=Math.floor(lon*20),y=Math.floor(lat*20),key=x+'_'+y;if(!tiles.has(key)){const tile=dem.tiles.find(t=>t.x===x&&t.y===y);if(!tile)throw Error('Missing R057 DEM tile');const packed=readFileSync(resolve(root,'preview/data/dem-mainland/'+tile.file));if(hash(packed)!==tile.sha256)throw Error('R057 DEM source mismatch');const bytes=gunzipSync(packed);tiles.set(key,new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength));}return [s.distance,sampleBilinear(tiles.get(key),lon,lat,x,y)];});
 const supplement={source:{evidencePath,evidenceSha256:hash(read(evidencePath)),decision:'User confirmed OSM northern ridge and requested R057 integration, 2026-11-20; candidate only',demSource:dem.source},edges:evidence.directions.map(d=>({fromId:d.fromNodeId,toId:d.toNodeId,minutes:null,travelMode:'walking',manualTimeRequired:true,verificationStatus:'owner-confirmed-connection',source:'OSM 北稜試作；時間待手填；'+evidencePath})),spans:[{id:'classic-R057-osm-north-ridge-20261120',fromId:track.fromNodeId,toId:track.toNodeId,reversible:true,ownerConfirmed:true,fromAnchor:track.coordinates[0],toAnchor:track.coordinates.at(-1),coordinates:track.coordinates,profile,distanceMeters:samples.at(-1).distance,sourceName:'OSM 北稜試作；DEM 估算；非現地通行核實',sourceUrl:'https://www.openstreetmap.org/way/220625143'}]};
 const multimodal=json('data/staging/idea002/multimodal-20261123.json');supplement.vehicleSegments=multimodal.vehicles;
 const augmented=withClassicSources(graph,JSON.parse(geometryText),supplement);
 const context=routeContext(augmented.graph,augmented.geometry,hash(JSON.stringify(datasets)));
 const source={baseCommit:decisions.baseCommit,snapshotRef:snapshotPath,snapshotSha256:hash(read(snapshotPath)),decisionRef:decisionPath,decisionSha256:hash(read(decisionPath)),geometrySha256:hash(geometryText),spreadsheetId:snapshot.spreadsheetId};
 if(snapshot.schemaVersion!==1||decisions.schemaVersion!==1||new Set(snapshot.routes.map(r=>r.routeId)).size!==snapshot.routes.length)throw Error('Invalid snapshot or duplicate Route ID');
 for(const row of snapshot.routes){
  if(row.nodes.some((n,i)=>n.position!==i+1||!context.nodes.has(n.nodeId)||typeof n.key!=='boolean'))throw Error('Invalid Sheet position or Node ID: '+row.routeId);
 }
 const directionReview=json('data/staging/idea002/sheet-direction-20261123.json');
 const nodeReview=json('data/staging/idea002/route-node-ids-20261123.json');
 const changedRows=Object.entries(directionReview.changedOrders).filter(([id])=>!snapshot.routes.some(r=>r.routeId===id)).map(([routeId,order])=>{
  const rows=nodeReview.rows.slice(1).filter(r=>r[0]===routeId),labels=order.split('→').map(s=>s.trim()),keyIds=labels.map(name=>{const hits=rows.filter(r=>r[3]===name);if(hits.length!==1)throw Error('Ambiguous changed Sheet anchor '+name);return hits[0][2];});
  return {routeId,name:routeId==='R028'?'志佳陽上雪主':routeId,type:directionReview.rows.find(r=>r.routeId===routeId).type,originalStatus:'Sheet ID sequence; source review pending',nodes:rows.map(r=>({position:Number(r[1]),nodeId:r[2],key:keyIds.includes(r[2])}))};
 });
 const existing=new Map([...snapshot.routes,...changedRows].map(r=>[r.routeId,r]));
 const selectedRows=enabled.routes.slice(1).filter(r=>r[2]==='TRUE').map((r,i)=>{
  const prior=existing.get(r[0]);
  const nodes=enabled.nodes.slice(1).flatMap((n,j)=>n[0]===r[0]?[{position:Number(n[1]),nodeId:n[2],name:n[3],key:enabled.keys[j]?.[0]==='是'}]:[]);
  return prior||{routeId:r[0],name:r[1],type:r[3],originalStatus:enabled.statuses[enabled.routes.indexOf(r)-1]?.[0]||'',nodes};
 });
 const routes=selectedRows.map(row=>{
  const excludedNodeIds=decisions.excludedNodeIds[row.routeId]||[];
  const override=row.routeId==='R052'?multimodal.R052.anchors.map(n=>n.nodeId):decisions.anchorOverrides[row.routeId];
  const anchors=(override?override.map(nodeId=>({nodeId,key:true})):row.nodes.filter(n=>!excludedNodeIds.includes(n.nodeId)).map(n=>({nodeId:n.nodeId,key:n.key}))).filter(n=>!context.nodes.get(n.nodeId)?.plannerHidden);
  const type=({'往返':'out_and_back','縱走':'traverse','環狀':'loop','環線':'loop','多段行程':'multi_segment'})[row.type];
  if(!type)throw Error('Unsupported route type: '+row.type);
  const routeSource=row.routeId==='R052'?{...source,multimodalRef:'data/staging/idea002/multimodal-20261123.json'}:source;
  const input={routeId:row.routeId,name:row.name,type,anchors,excludedNodeIds,expandAnchors:!!override||excludedNodeIds.length>0||row.originalStatus.includes('僅重要錨點'),source:{...routeSource,enabledSnapshotRef:enabledPath,enabledSnapshotSha256:hash(read(enabledPath))}};
  const forward=compileClassicRoute(input,context);
  validateClassicRoute(forward,context);
  const reverse=reverseClassicRoute(forward,context);
  validateClassicRoute(reverse,context);
  const sheetIndex=enabled.routes.findIndex(r=>r[0]===row.routeId);
  const review={routeId:row.routeId,direction:enabled.directions[sheetIndex]?.[0]||''};
  if(review?.direction==='逆行'&&['traverse','loop'].includes(type))return {routeId:row.routeId,pilot:decisions.pilotRouteIds.includes(row.routeId),directionReview:review,forward:{...reverse,direction:'forward'},reverse:{...forward,direction:'reverse'}};
  return {routeId:row.routeId,pilot:decisions.pilotRouteIds.includes(row.routeId),directionReview:review,forward,reverse};
 });
 const used=new Set(routes.flatMap(r=>[r.forward,r.reverse].flatMap(d=>d.geometryBindings.map(b=>b.spanId))));
 const spanDigests=Object.fromEntries(context.spans.filter(s=>used.has(s.id)).map(s=>[s.id,hash(JSON.stringify(s))]));
 return {schemaVersion:1,verification:'candidate',enabledRouteIds:selectedRows.map(r=>r.routeId),baseCommit:decisions.baseCommit,dataCommit:decisions.dataCommit,supplement,graphDigest:context.graphDigest,geometryDigest:hash(geometryText),spanDigests,vehicleTimePolicy:decisions.vehicleTimePolicy,routes};
}
export function buildCatalog(){
 const snapshotPath='data/route-validator/snapshots/sheet-20261125-r026-walking.json',snapshot=json(snapshotPath),input=normalizeSnapshot(snapshot);
 if(input.problems.length)throw Error(JSON.stringify(input.problems));
 const manifest=json('preview/data/unified-editor-manifest.json'),datasets=manifest.routes.map(m=>json('preview/'+m.file.split('?')[0])),graph=mergeReviewedRoutes(datasets);
 const geometryText=read('preview/data/geometry/planner-terrain-v1.json'),geometry=JSON.parse(geometryText),supplement=json('data/staging/idea002/classic-sources-20261125.json').supplement;
 const timeRef='data/audits/route-review-20261125-round2/missing-edge-source.json';reviewedBindings(geometry,supplement,json(timeRef),timeRef,hash(read(timeRef)));
 const augmented=withClassicSources(graph,geometry,supplement),context=routeContext(augmented.graph,augmented.geometry,hash(JSON.stringify(datasets))),decisions=json('data/staging/idea002/decisions-20261120.json');
 const source={baseCommit:decisions.baseCommit,snapshotRef:snapshotPath,snapshotSha256:hash(read(snapshotPath)),decisionRef:snapshot.correctionRef,decisionSha256:hash(read(snapshot.correctionRef)),geometrySha256:hash(geometryText),spreadsheetId:snapshot.spreadsheetId};
 const rows=input.routes.filter(r=>r.enabled&&r.occurrences.length>1);
 const routes=rows.map(row=>{
  const type=({'往返':'out_and_back','縱走':'traverse','環狀':'loop','環線':'loop','多段行程':'multi_segment'})[row.type];if(!type)throw Error('Unsupported route type '+row.type);
  const active=new Set(row.occurrences.map(n=>n.nodeId)),excludedNodeIds=[...new Set(input.excluded.filter(n=>n.routeId===row.routeId&&!active.has(n.nodeId)).map(n=>n.nodeId))];
  const forward=compileClassicRoute({routeId:row.routeId,name:row.name,type,version:2,anchors:row.occurrences.map(n=>({nodeId:n.nodeId,key:n.key})),excludedNodeIds,expandAnchors:false,source:{...source,...(type==='multi_segment'?{multimodalRef:'data/staging/idea002/multimodal-20261123.json'}:{})}},context);
  validateClassicRoute(forward,context);const reverse=reverseClassicRoute(forward,context);validateClassicRoute(reverse,context);
  return {routeId:row.routeId,pilot:decisions.pilotRouteIds.includes(row.routeId),directionReview:{routeId:row.routeId,direction:row.row['目前順序屬於順行或逆行?']},forward,reverse};
 });
 const used=new Set(routes.flatMap(r=>[r.forward,r.reverse].flatMap(d=>d.geometryBindings.map(b=>b.spanId))));
 return {schemaVersion:1,verification:'candidate',enabledRouteIds:rows.map(r=>r.routeId),baseCommit:decisions.baseCommit,dataSource:'current-preview-working-tree',snapshotRef:snapshotPath,snapshotSha256:source.snapshotSha256,supplement,graphDigest:context.graphDigest,geometryDigest:hash(geometryText),spanDigests:Object.fromEntries(context.spans.filter(s=>used.has(s.id)).map(s=>[s.id,hash(JSON.stringify(s))])),vehicleTimePolicy:decisions.vehicleTimePolicy,routes};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),output='data/staging/idea002/classic-routes.candidate.json';
 if(args.length!==1||!['--check','--write'].includes(args[0]))throw Error('Usage: node tools/compile_classic_routes.mjs --check|--write');
 const text=JSON.stringify(buildCatalog(),null,2)+'\n';
 if(args[0]==='--write')writeFileSync(resolve(root,output),text);
 else if(read(output)!==text)throw Error('Candidate catalog is stale: '+relative(root,resolve(root,output)));
 console.log(args[0]==='--check'?'Candidate catalog reproducible':'Candidate catalog written; candidate status unchanged');
}
