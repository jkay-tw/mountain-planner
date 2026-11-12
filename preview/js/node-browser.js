// UI-only browsing helpers. Routing remains inside crossmap-routing.js.
const normalizeSearch=value=>String(value||'').trim().toLocaleLowerCase().replace(/叉/g,'岔');
export function searchLocationLabel(node,query){
  const needle=normalizeSearch(query);
  const match=needle&&(node.aliases||[]).find(a=>normalizeSearch(a).includes(needle));
  const group=node.route?'｜'+node.route:'';
  return node.name+group+(match?'（符合別稱：'+match+'）':'');
}
export function filterLocations(options,query,limit=60,{includeRoute=true}={}){
  const needle=normalizeSearch(query);
  return options.filter(x=>[x.name,...(x.aliases||[]),...(includeRoute?[x.route||'']:[])]
    .some(value=>normalizeSearch(value).includes(needle))).slice(0,limit);
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
