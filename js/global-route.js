// Build one non-inferred physical graph across separately reviewed route datasets.
// Scoped selector affects node discovery only, never the walking connectivity.
export function mergeReviewedRoutes(routes) {
  if(!Array.isArray(routes)||!routes.length)throw new Error('At least one reviewed route required');
  const nodes=new Map(),segments=[],sourceIds=new Set();
  for(const route of routes) {
    if(!route?.route_id||sourceIds.has(route.route_id))throw new Error('Duplicate or missing route ID');
    sourceIds.add(route.route_id);
    const ids=new Set();
    for(const n of route.nodes||[]) {
      if(!n.id||ids.has(n.id))throw new Error('Repeated local node identity');
      ids.add(n.id);
      const existing=nodes.get(n.id);
      if(existing&&existing.name!==n.name)throw new Error('Conflicting physical-node ID: '+n.id);
      if(existing)existing.groups=[...new Set([...existing.groups,route.route_id])];
      else nodes.set(n.id,{...n,groups:[route.route_id]});
    }
    // Keep identities available for saved plans and manual connections while quarantined.
    if(route.routingEnabled===false)continue;
    for(const s of route.segments||[]) {
      if(s.routingEnabled===false)continue;
      if(!ids.has(s.fromId)||!ids.has(s.toId))throw new Error('Dangling segment identity');
      const existing=segments.find(x=>x.fromId===s.fromId&&x.toId===s.toId);
      if(existing) {
        if(existing.minutes!==s.minutes)throw new Error('Different directed times for one physical edge');
        existing.sourceGroups=[...new Set([...existing.sourceGroups,route.route_id])];
        continue;
      }
      segments.push({...s,sourceGroups:[route.route_id],travelMode:s.travelMode||'walking',
        verificationStatus:s.verificationStatus|| (s.status==='checked'?'verified':'unverified')});
    }
  }
  return {route_id:'GLOBAL-PREVIEW',route_name:'已收錄圖組的共同路網',
    routingPolicy:'verified-walking-only',status:'preview-only',
    nodes:[...nodes.values()],segments,source:{image_url:'https://www.sunriver.com.tw/step2020.htm'},
    includedRoutes:[...sourceIds]};
}
export function nodesInScope(route,scope){
  if(!route)return [];
  if(!scope||scope==='all')return route.nodes||[];
  return (route.nodes||[]).filter(n=>(n.groups||[]).includes(scope));
}
export function appendDisconnectedNode(day,selected,uid) {
  const previous=[...day.items].reverse().find(x=>x.type!=='rest');
  if(!previous){day.items.push({id:uid(),type:'location',name:selected.name,nodeId:selected.id,
    note:'',isPeak:false,hasWater:false,incoming:null});return;}
  const id=uid();
  day.items.push({id,type:'location',name:selected.name,nodeId:selected.id,
    note:'',isPeak:false,hasWater:false,
    incoming:{kind:'manual',connectionStatus:'unverified',fromId:previous.id,toId:id,
      actualMinutes:null}});
}
