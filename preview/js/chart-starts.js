// A chart may be split into several runtime datasets. Use its original map
// source URL to recover that coverage; route ownership is not chart coverage.
export function chartStartNodes(graph,catalog,manifest,scope){
 if(!catalog)return [];
 const selected=manifest.routes.find(r=>r.id===scope);
 if(scope!=='all'&&!selected)return [];
 const groups=new Set(manifest.routes.filter(r=>r.id===scope||selected?.source_url&&r.source_url===selected.source_url).map(r=>r.id));
 const endpoints=new Map();
 for(const entry of catalog.routes){
  if(!catalog.enabledRouteIds.includes(entry.routeId))continue;
  const occurrences=entry.forward.occurrences;if(occurrences.length<2)continue;
  // Out-and-back turnaround summits are interior occurrences, never endpoints.
  for(const o of [occurrences[0],occurrences.at(-1)]){
   if(!endpoints.has(o.nodeId))endpoints.set(o.nodeId,new Set());
   endpoints.get(o.nodeId).add(entry.routeId);
  }
 }
 return graph.nodes.filter(n=>!n.plannerHidden&&endpoints.has(n.id)&&(scope==='all'||n.groups?.some(g=>groups.has(g))))
  .map(n=>({...n,endpointRouteIds:[...endpoints.get(n.id)].sort()}))
  .sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant')||a.id.localeCompare(b.id));
}
