// Physical identity is independent of labels. Never infer cross-route equivalence.
export function provisionalNodeId(routeId,name){
  if(typeof routeId!=='string'||!routeId.trim()||typeof name!=='string'||!name.trim())throw new Error('routeId and name are required');
  return routeId+'::'+encodeURIComponent(name);
}
export function buildNodeRegistry(route){
  if(!route||typeof route.route_id!=='string'||!Array.isArray(route.segments))throw new Error('Invalid route dataset');
  const names=[...new Set(route.segments.flatMap(s=>[s.from,s.to]))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
  const defined=route.nodes||[];
  const byName=new Map();
  const byId=new Map();
  for(const node of defined){
    if(!node?.id||!node?.name||byId.has(node.id)||byName.has(node.name))throw new Error('Duplicate or invalid node identity');
    byName.set(node.name,{...node,routeId:route.route_id});
    byId.set(node.id,byName.get(node.name));
  }
  for(const name of names){
    if(byName.has(name))continue;
    const node={id:provisionalNodeId(route.route_id,name),name,routeId:route.route_id,identityStatus:'provisional'};
    if(byId.has(node.id))throw new Error('Node ID collision');
    byName.set(name,node);byId.set(node.id,node);
  }
  return {nodes:[...byName.values()],byName,byId};
}
export function addRouteIdentity(route){
  const registry=buildNodeRegistry(route);
  const segments=route.segments.map(s=>{
    const fromId=s.fromId??registry.byName.get(s.from)?.id,toId=s.toId??registry.byName.get(s.to)?.id;
    if(!registry.byId.has(fromId)||!registry.byId.has(toId)||registry.byId.get(fromId).name!==s.from||registry.byId.get(toId).name!==s.to)throw new Error('Unresolved segment node identity');
    return {...s,fromId,toId};
  });
  return {...route,nodes:registry.nodes,segments};
}
export function findNodeById(route,nodeId){return route?.nodes?.find(n=>n.id===nodeId)||null;}
export function migrateDaysToNodeIds(rawDays,route){
  const registry=route?buildNodeRegistry(route):null;
  return rawDays.map(day=>({...day,items:day.items.map(item=>{
    if(item.type!=='location')return {...item};
    const byId=registry?.byId.get(item.nodeId);
    const node=byId||registry?.byName.get(item.name);
    // Do not silently map an unrecognized name or an existing ID to a different place.
    if(item.nodeId&&!byId)throw new Error('Unknown node ID: '+item.nodeId);
    if(node&&item.name!==node.name)throw new Error('Node identity and name disagree: '+item.name);
    const incoming=item.incoming?.kind==='official'?{...item.incoming,
      ...(registry?.byName.get(item.incoming.from)?{fromNodeId:registry.byName.get(item.incoming.from).id}:{}),
      ...(registry?.byName.get(item.incoming.to)?{toNodeId:registry.byName.get(item.incoming.to).id}:{})
    }:item.incoming?{...item.incoming}:item.incoming;
    return {...item,...(node?{nodeId:node.id}:{}),incoming};
  })}));
}
