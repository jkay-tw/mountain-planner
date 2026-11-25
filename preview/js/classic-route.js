// IDEA-002 data layer only. No UI, itinerary mutation or source approval.
const copy=value=>structuredClone(value);
const pair=(a,b)=>JSON.stringify([a,b]);
const fail=message=>{throw new Error(message)};
export function routeContext(graph,geometry,graphDigest){
 const nodes=new Map(graph.nodes.map(n=>[n.id,n])),edges=new Map(),manuals=new Map();
 for(const e of graph.segments){
  if(e.routingEnabled===false||e.travelMode!=='walking'||e.verificationStatus!=='verified')continue;
  if(!nodes.has(e.fromId)||!nodes.has(e.toId)||!Number.isFinite(e.minutes)||e.minutes<0)fail('Invalid source edge');
  const key=pair(e.fromId,e.toId),prior=edges.get(key);
  if(prior&&prior.minutes!==e.minutes)fail('Conflicting directed time');
  edges.set(key,e);
 }
 for(const e of graph.manualConnections||[])if(e.minutes===null&&e.manualTimeRequired===true&&e.travelMode==='walking'&&e.verificationStatus==='owner-confirmed-connection'&&e.routingEnabled!==false){
  if(!nodes.has(e.fromId)||!nodes.has(e.toId))fail('Invalid manual source edge');
  manuals.set(pair(e.fromId,e.toId),e);
 }
 if(typeof graphDigest!=='string'||!graphDigest)fail('Missing graph digest');
 const vehicles=new Map((graph.vehicleSegments||[]).map(e=>[pair(e.fromId,e.toId),e]));
 return {nodes,edges,manuals,vehicles,spans:geometry.spans,graphDigest};
}
function path(context,start,end,excluded){
 if(excluded.has(start)||excluded.has(end))return null;
 if(start===end)return [];
 const direct=context.manuals.get(pair(start,end));if(direct)return [direct];
 const distances=new Map([[start,0]]),previous=new Map(),pending=new Set([start]);
 while(pending.size){
  const at=[...pending].sort((a,b)=>distances.get(a)-distances.get(b)||a.localeCompare(b))[0];pending.delete(at);if(at===end)break;
  for(const e of context.edges.values()){
   if(e.fromId!==at||excluded.has(e.toId)||!Number.isFinite(e.minutes))continue;
   const next=distances.get(at)+e.minutes;
   if(next<(distances.get(e.toId)??Infinity)){distances.set(e.toId,next);previous.set(e.toId,e);pending.add(e.toId);}
  }
 }
 if(!previous.has(end))return null;
 const result=[];for(let at=end;at!==start;){const e=previous.get(at);result.unshift(e);at=e.fromId;}return result;
}
function bindGeometry(route,context){
 const bindings=[];let at=0;
 while(at<route.occurrences.length-1){
  if(route.directedSegments[at].edgeRef.kind==='vehicle'){at++;continue;}
  const matches=[];
  for(const span of context.spans)for(const reverse of [false,true]){
   // A retained historical aggregate may duplicate the newly approved direct
   // span after a database-only node is consolidated. Prefer the direct span
   // only when its endpoints, vertices AND DEM profile are exactly identical.
   if(span.viaNodeIds?.length&&span.viaNodeIds.every(id=>context.nodes.get(id)?.plannerHidden)&&context.spans.some(s=>!s.viaNodeIds?.length&&s.fromId===span.fromId&&s.toId===span.toId&&JSON.stringify(s.coordinates)===JSON.stringify(span.coordinates)&&JSON.stringify(s.profile)===JSON.stringify(span.profile)))continue;
   if(reverse&&!span.reversible)continue;
   let ids=[span.fromId,...(span.viaNodeIds||[]),span.toId];if(reverse)ids.reverse();
   if(ids.some(id=>route.excludedNodeIds.includes(id)))continue;
   for(const sequence of ids.length>2?[ids,[ids[0],ids.at(-1)]]:[ids]){
    if(sequence.every((id,j)=>route.occurrences[at+j]?.nodeId===id)&&route.directedSegments.slice(at,at+sequence.length-1).every(e=>e.edgeRef.kind!=='missing'))matches.push({spanId:span.id,reverse,fromPosition:at,toPosition:at+sequence.length-1});
   }
  }
  // Prefer the most specific full sequence, but never silently choose between spans.
  const longest=Math.max(0,...matches.map(m=>m.toPosition));
  const choices=matches.filter(m=>m.toPosition===longest);
  if(choices.length===1){bindings.push(choices[0]);at=choices[0].toPosition;}
  else {route.issues.push({code:choices.length?'AMBIGUOUS_GEOMETRY':'MISSING_GEOMETRY',fromPosition:at,toPosition:at+1});at++;}
 }
 return bindings;
}
function finish(route,context){
 if(route.type==='multi_segment'&&!route.source.multimodalRef)route.issues.push({code:'MULTI_SEGMENT_REVIEW_REQUIRED'});
 route.directedSegments=route.occurrences.slice(1).map((to,i)=>{
  const from=route.occurrences[i],key=pair(from.nodeId,to.nodeId),edge=context.edges.get(key)||context.manuals.get(key)||context.vehicles.get(key);
  const kind=context.edges.has(key)?'walking':context.manuals.has(key)?'owner-manual':context.vehicles.has(key)?'vehicle':'missing';
  if(!edge)route.issues.push({code:'MISSING_DIRECTION',fromPosition:i,toPosition:i+1});
  return {fromPosition:i,toPosition:i+1,edgeRef:{fromId:from.nodeId,toId:to.nodeId,kind,graphDigest:context.graphDigest},timeStatus:edge?(kind==='owner-manual'||kind==='vehicle'&&edge.minutes===null?'manual-required':'source-reference'):'unknown'};
 });
 route.geometryBindings=bindGeometry(route,context);
 route.directionStatus=route.issues.some(i=>['MISSING_DIRECTION','MULTI_SEGMENT_REVIEW_REQUIRED'].includes(i.code))?'blocked':route.directedSegments.some(s=>s.timeStatus==='manual-required')?'manual-time-required':'candidate';
 route.applicationStatus=route.issues.length?'blocked':'candidate-review';
 return route;
}
export function compileClassicRoute(input,context){
 if(!Array.isArray(input.anchors)||input.anchors.length<2)fail('At least two occurrences required');
 const excluded=new Set(input.excludedNodeIds||[]),occurrences=[],issues=[];
 for(const a of input.anchors)if(!context.nodes.has(a.nodeId)||typeof a.key!=='boolean'||excluded.has(a.nodeId))fail('Unknown or excluded anchor: '+a.nodeId);
 const add=(nodeId,key)=>occurrences.push({position:occurrences.length,nodeId,key});
 add(input.anchors[0].nodeId,input.anchors[0].key);
 for(let i=1;i<input.anchors.length;i++){
  const from=input.anchors[i-1],to=input.anchors[i];
  if(from.nodeId===to.nodeId)fail('Adjacent identical anchors require an explicit walking loop');
  const direct=context.edges.get(pair(from.nodeId,to.nodeId))||context.manuals.get(pair(from.nodeId,to.nodeId))||context.vehicles.get(pair(from.nodeId,to.nodeId));
  const edges=direct?[direct]:input.expandAnchors?path(context,from.nodeId,to.nodeId,excluded):null;
  if(!edges){issues.push({code:'NO_CONSTRAINED_PATH',fromAnchor:i-1,toAnchor:i});add(to.nodeId,to.key);continue;}
  edges.forEach((e,j)=>add(e.toId,j===edges.length-1?to.key:false));
 }
 return finish({schemaVersion:1,routeId:input.routeId,version:input.version??1,name:input.name,type:input.type,verification:'candidate',direction:'forward',excludedNodeIds:[...excluded].sort(),source:copy(input.source),occurrences,issues},context);
}
export function reverseClassicRoute(route,context){
 validateClassicRoute(route,context);
 const reversed={...copy(route),direction:route.direction==='forward'?'reverse':'forward',occurrences:[...route.occurrences].reverse().map((o,position)=>({...o,position})),issues:[]};
 finish(reversed,context); // Exact reverse only; never substitute a shortest path.
 const end=route.occurrences.length-1;
 for(const binding of route.geometryBindings){
  const expected={spanId:binding.spanId,reverse:!binding.reverse,fromPosition:end-binding.toPosition,toPosition:end-binding.fromPosition};
  if(!reversed.geometryBindings.some(b=>JSON.stringify(b)===JSON.stringify(expected)))reversed.issues.push({code:'REVERSE_GEOMETRY_REVIEW_REQUIRED',fromPosition:expected.fromPosition,toPosition:expected.toPosition});
 }
 reversed.applicationStatus=reversed.issues.length?'blocked':'candidate-review';
 return reversed;
}
export function validateClassicRoute(route,context,{requireVerified=false}={}){
 if(route.schemaVersion!==1||!/^R\d{3}$/.test(route.routeId)||!Number.isInteger(route.version)||route.version<1||typeof route.name!=='string'||!route.name||!['forward','reverse'].includes(route.direction)||!['candidate','verified'].includes(route.verification))fail('Invalid route identity or version');
 if(!route.source?.baseCommit||!route.source?.snapshotSha256||!route.source?.decisionRef)fail('Missing source provenance');
 if(!['out_and_back','traverse','loop','multi_segment'].includes(route.type)||!Array.isArray(route.excludedNodeIds)||route.excludedNodeIds.some(id=>!context.nodes.has(id))||!Array.isArray(route.issues)||!Array.isArray(route.geometryBindings))fail('Invalid route structure');
 if(!Array.isArray(route.occurrences)||route.occurrences.length<2||!Array.isArray(route.directedSegments)||route.directedSegments.length!==route.occurrences.length-1)fail('Invalid occurrence sequence');
 route.occurrences.forEach((o,i)=>{if(o.position!==i||!context.nodes.has(o.nodeId)||typeof o.key!=='boolean'||route.excludedNodeIds.includes(o.nodeId))fail('Invalid occurrence');});
 route.directedSegments.forEach((s,i)=>{
  const ref=s.edgeRef,key=pair(route.occurrences[i].nodeId,route.occurrences[i+1].nodeId);
  if(s.fromPosition!==i||s.toPosition!==i+1||pair(ref.fromId,ref.toId)!==key||ref.graphDigest!==context.graphDigest)fail('Invalid directed reference');
  const kind=context.edges.has(key)?'walking':context.manuals.has(key)?'owner-manual':context.vehicles.has(key)?'vehicle':'missing';
  if(ref.kind!==kind||s.timeStatus!==(kind==='walking'||kind==='vehicle'&&context.vehicles.get(key).minutes!==null?'source-reference':kind==='owner-manual'||kind==='vehicle'?'manual-required':'unknown'))fail('Invalid edge or time classification');
 });
 const check=finish({...copy(route),issues:[]},context);const bindings=check.geometryBindings;
 if(JSON.stringify(bindings)!==JSON.stringify(route.geometryBindings))fail('Invalid geometry references');
 if(check.directionStatus!==route.directionStatus||check.issues.some(issue=>!route.issues.some(i=>JSON.stringify(i)===JSON.stringify(issue)))||route.applicationStatus!==(route.issues.length?'blocked':'candidate-review'))fail('Invalid readiness status');
 if(route.verification==='verified'||requireVerified){
  if(route.verification!=='verified'||!route.source.reviewedBy||!route.source.reviewedAt||!route.source.evidenceRef||route.issues.length||check.issues.length||route.directedSegments.some(s=>s.edgeRef.kind==='missing'))fail('Source review and complete directed geometry required');
 }
 return route;
}
// Vehicle source minutes are not walking minutes. Never multiply by a DAY coefficient.
export function directedVehicleReference(transport,fromId,toId){
 if(typeof fromId!=='string'||typeof toId!=='string'||fromId===toId)fail('Invalid vehicle endpoints');
 const matches=(transport.segments||[]).filter(e=>e.fromId===fromId&&e.toId===toId&&e.travelMode==='vehicle'&&e.verificationStatus==='verified');
 if(matches.some(e=>!Number.isFinite(e.minutes)||e.minutes<0)||new Set(matches.map(e=>e.minutes)).size>1)fail('Conflicting vehicle source time');
 const edge=matches[0];
 return {fromId,toId,travelMode:'vehicle',minutes:edge?.minutes??null,timeStatus:edge?'source-reference':'manual-required',source:edge?.source??null};
}
export function vehiclePlannedMinutes({minutes,actualMinutes=null}){
 if(actualMinutes!==null&&actualMinutes!==undefined&&actualMinutes!==''){
  if(!Number.isFinite(actualMinutes)||actualMinutes<0)fail('Invalid vehicle override');return actualMinutes;
 }
 if(minutes===null)return null;
 if(!Number.isFinite(minutes)||minutes<0)fail('Invalid vehicle source time');return minutes;
}
