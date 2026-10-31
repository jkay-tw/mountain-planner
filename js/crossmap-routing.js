// Standalone v0.7 cross-map graph. Not wired into the production planner UI.
// No display-name joins, no unverified segments and no vehicle segments.
const key=(group,name)=>JSON.stringify([group,name]);
const validMinutes=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
export function buildVerifiedWalkingGraph(routes,crosswalk,{allowCrossMap=false}={}){
  if(!Array.isArray(routes)||!crosswalk||!Array.isArray(crosswalk.canonicalNodes))
    throw new Error('Invalid cross-map graph input');
  const identities=new Map(),seen=new Set(),nodes=new Map(),edges=new Map();
  for(const cluster of crosswalk.canonicalNodes){
    if(typeof cluster.canonicalId!=='string'||!cluster.canonicalId)throw new Error('Invalid canonical ID');
    if(seen.has(cluster.canonicalId))throw new Error('Duplicate canonical ID');
    seen.add(cluster.canonicalId);
    if(!Array.isArray(cluster.members)||cluster.members.length<2)throw new Error('Invalid identity group');
    for(const m of cluster.members){
      const k=key(m.group,m.name);
      if(identities.has(k))throw new Error('Duplicate cross-map membership');
      identities.set(k,cluster.canonicalId);
    }
  }
  // Review decisions identify the same place but do NOT alone authorize connecting maps.
  // Separate explicit flag is required, and every traversed edge must be source-verified.
  const routeNames=new Set(),locationId=new Map();
  for(const route of routes){
    if(!route?.route_id||!route?.route_name||!Array.isArray(route.nodes)||!Array.isArray(route.segments))
      throw new Error('Invalid loaded route');
    if(routeNames.has(route.route_id))throw new Error('Duplicate route ID');
    routeNames.add(route.route_id);
    for(const node of route.nodes){
      if(!node.id||!node.name)throw new Error('Invalid node');
      const local=key(route.route_id,node.id),source=key(route.route_name,node.name);
      const canonical=allowCrossMap?identities.get(source):null;
      const id=canonical?'shared:'+canonical:'local:'+local;
      locationId.set(local,id);
      if(!nodes.has(id))nodes.set(id,{id,name:node.name});
    }
  }
  for(const route of routes){
    for(const seg of route.segments){
      // Source approval is per-direction, not inherited from the route or name.
      if(seg.travelMode!=='walking'||seg.verificationStatus!=='verified'||!validMinutes(seg.minutes))continue;
      const from=locationId.get(key(route.route_id,seg.fromId));
      const to=locationId.get(key(route.route_id,seg.toId));
      if(!from||!to)throw new Error('Verified edge references unknown nodes');
      if(from===to)continue;
      if(!edges.has(from))edges.set(from,[]);
      edges.get(from).push({from,to,minutes:seg.minutes,routeId:route.route_id,
        source:seg.source||route.source?.image_url||null});
    }
  }
  // Enforce all user-supplied exclusions even if crosswalk metadata is corrupted.
  for(const denied of crosswalk.deniedPairRecords||[]){
    const a=identities.get(key(denied.groupA,denied.name));
    const b=identities.get(key(denied.groupB,denied.name));
    if(a&&a===b)throw new Error('Denied cross-map merge: '+denied.name);
  }
  return {nodes,edges,locationId,enabled:allowCrossMap};
}
export function shortestVerifiedWalkingPath(graph,start,end){
  if(!graph.nodes.has(start)||!graph.nodes.has(end))return null;
  if(start===end)return {nodes:[start],segments:[],minutes:0};
  const distances=new Map([[start,0]]),previous=new Map(),pending=new Set([start]);
  while(pending.size){
    let current=null,best=Infinity;
    for(const candidate of pending){const d=distances.get(candidate);if(d<best){best=d;current=candidate}}
    pending.delete(current);
    if(current===end)break;
    for(const edge of graph.edges.get(current)||[]){
      const next=best+edge.minutes;
      if(next<(distances.get(edge.to)??Infinity)){
        distances.set(edge.to,next);previous.set(edge.to,edge);pending.add(edge.to);
      }
    }
  }
  if(!previous.has(end))return null;
  const path=[end],segments=[];let at=end;
  while(at!==start){const edge=previous.get(at);if(!edge)return null;
    segments.unshift(edge);at=edge.from;path.unshift(at)}
  return {nodes:path,segments,minutes:distances.get(end)};
}
