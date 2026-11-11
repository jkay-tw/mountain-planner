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
  const ambiguousNames=new Set();
  const definedNodes=[];
  for(const node of defined){
    if(!node?.id||!node?.name||byId.has(node.id))throw new Error('Duplicate or invalid node identity');
    const normalized={...node,routeId:route.route_id};
    definedNodes.push(normalized);byId.set(node.id,normalized);
    if(ambiguousNames.has(node.name))continue;
    if(byName.has(node.name)){
      byName.delete(node.name);
      ambiguousNames.add(node.name);
    }else byName.set(node.name,normalized);
  }
  for(const name of names){
    if(byName.has(name)||ambiguousNames.has(name))continue;
    const node={id:provisionalNodeId(route.route_id,name),name,routeId:route.route_id,identityStatus:'provisional'};
    if(byId.has(node.id))throw new Error('Node ID collision');
    definedNodes.push(node);byName.set(name,node);byId.set(node.id,node);
  }
  return {nodes:definedNodes,byName,byId,ambiguousNames};
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
// Explicit owner-confirmed 2026-11-01 identities, scoped by old ID and label.
const snowLegacyIds={
  'node:1c91e71b467300e90b6c':['雪山登山口','g04-045'],
  'node:fba428b6693c1f3ff1b9':['武陵農場','node:f6f2ba4c01559d0ff632'],
  // Explicit Sheet decisions plus owner confirmation on 2026-11-11.
  // These redirects are scoped to the retired ID AND its historical label.
  'node:1e33d65d02cee63e0cd4':['三岔路口','shared:cw-v07-015'],
  'node:351f4b260c8941f8d7e4':['玉林橋大崩壁','node:1670c3f1247b747ba02a'],
  'node:c68a6096c4fde85a1b28':['杜鵑營地','node:8426704609cea5d43db4']
};
export function canonicalReviewedId(id,name){
  const record=snowLegacyIds[id];
  return record&&record[0]===name?record[1]:id;
}
export const acceptsReviewedName=(node,name)=>node?.name===name||(node?.aliases||[]).includes(name);
// Retired preview-only catalog entry: retain user itinerary snapshots without reintroducing a selectable graph node.
const retiredPreviewNames={'g07-043':'黑水塘','node:5432a0accfa0ca8738af':'鐵杉營地','node:c286f1b8b14919f6bc37':'登山口','node:2073e5ef3ab7ef6fb2f1':'凹谷營地','node:413453c06804769a3470':'東南鞍營地'};
export const isRetiredPreviewNode=item=>!!item&&retiredPreviewNames[item.nodeId]===item.name;
export function migrateDaysToNodeIds(rawDays,route){
  const registry=route?buildNodeRegistry(route):null;
  return rawDays.map(day=>({...day,items:day.items.map(item=>{
    if(item.type!=='location')return {...item};
    if(['GLOBAL-PREVIEW','G07','G19','G13'].includes(route?.route_id)&&isRetiredPreviewNode(item))return {...item,catalogStatus:'retired'};
    const mappedId=canonicalReviewedId(item.nodeId,item.name);
    const byId=registry?.byId.get(mappedId);
    if(!item.nodeId&&registry?.ambiguousNames?.has(item.name))throw new Error('Ambiguous node name requires nodeId: '+item.name);
    const node=byId||registry?.byName.get(item.name);
    // Do not silently map an unrecognized name or an existing ID to a different place.
    if(item.nodeId&&!byId)throw new Error('Unknown node ID: '+item.nodeId);
    if(node&&!acceptsReviewedName(node,item.name))throw new Error('Node identity and name disagree: '+item.name);
    const incoming=item.incoming?.kind==='official'?{...item.incoming,
      ...(item.incoming.fromNodeId?{fromNodeId:canonicalReviewedId(item.incoming.fromNodeId,item.incoming.from)}:registry?.byName.get(item.incoming.from)?{fromNodeId:registry.byName.get(item.incoming.from).id}:{}),
      ...(item.incoming.toNodeId?{toNodeId:canonicalReviewedId(item.incoming.toNodeId,item.incoming.to)}:registry?.byName.get(item.incoming.to)?{toNodeId:registry.byName.get(item.incoming.to).id}:{})
    }:item.incoming?{...item.incoming}:item.incoming;
    return {...item,...(node?{nodeId:node.id}:{}),incoming};
  })}));
}
