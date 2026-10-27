// v0.7 foundation: stable identity is distinct from the display label.
// Unverified routes are always isolated; sharing an id requires explicit review.
export function provisionalNodeId(routeId,name){
  if(typeof routeId!=='string'||!routeId.trim()||typeof name!=='string'||!name.trim()){
    throw new Error('routeId and node name are required');
  }
  return routeId+'::'+encodeURIComponent(name);
}
export function buildNodeRegistry(route){
  if(!route||typeof route.route_id!=='string'||!Array.isArray(route.segments)){
    throw new Error('Invalid route dataset');
  }
  const names=new Set(route.segments.flatMap(s=>[s.from,s.to]));
  const nodes=[...names].sort((a,b)=>a.localeCompare(b,'zh-Hant')).map(name=>({
    id:provisionalNodeId(route.route_id,name),name,routeId:route.route_id,
    identityStatus:'provisional'
  }));
  return {nodes,byName:new Map(nodes.map(n=>[n.name,n])),byId:new Map(nodes.map(n=>[n.id,n]))};
}
export function addRouteIdentity(route){
  const registry=buildNodeRegistry(route);
  return {
    ...route,
    nodes:registry.nodes,
    segments:route.segments.map(s=>({
      ...s,fromId:registry.byName.get(s.from).id,toId:registry.byName.get(s.to).id
    }))
  };
}
export function findNodeById(route,nodeId){
  return route.nodes?.find(n=>n.id===nodeId)||null;
}
