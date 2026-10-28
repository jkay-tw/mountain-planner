// UI-only browsing helpers. Routing remains inside crossmap-routing.js.
export function filterLocations(options,query,limit=60,{includeRoute=true}={}){
  const needle=String(query||'').trim().toLocaleLowerCase();
  return options.filter(x=>(includeRoute?(x.name+' '+(x.route||'')):x.name).toLocaleLowerCase().includes(needle)).slice(0,limit);
}
export function adjacentLocations(graph,nodeId){
  if(!graph?.nodes?.has(nodeId))return [];
  const outgoing=graph.edges.get(nodeId)||[];
  const byTarget=new Map();
  for(const edge of outgoing){
    const record=byTarget.get(edge.to)||{id:edge.to,name:graph.nodes.get(edge.to)?.name||edge.to,edges:[]};
    record.edges.push(edge);
    byTarget.set(edge.to,record);
  }
  return [...byTarget.values()].map(record=>({
    ...record,
    minutes:Math.min(...record.edges.map(x=>x.minutes)),
    sources:[...new Set(record.edges.map(x=>x.routeId))]
  })).sort((a,b)=>a.minutes-b.minutes||a.name.localeCompare(b.name,'zh-Hant'));
}
