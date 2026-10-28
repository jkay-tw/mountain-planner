// Safely migrate legacy single-chart itineraries into the global graph.
// Preserve historical official-minute snapshots; never recalculate on import.
import {buildNodeRegistry} from './node-identity.js';
export function migrateLegacyPlanDays(days, sourceRoute, globalRoute) {
  if(!Array.isArray(days)||!sourceRoute?.route_id||!globalRoute?.nodes)throw new Error('Invalid legacy migration inputs');
  const legacy=buildNodeRegistry(sourceRoute);
  const globalById=new Map(globalRoute.nodes.map(n=>[n.id,n]));
  return days.map(day=>({...day,items:day.items.map(item=>{
    if(item.type!=='location')return {...item};
    let original;
    if(item.nodeId){
      original=legacy.byId.get(item.nodeId);
      if(!original)throw new Error('Unknown legacy node ID: '+item.nodeId);
    }else{
      if(legacy.ambiguousNames.has(item.name))throw new Error('Ambiguous legacy node name: '+item.name);
      original=legacy.byName.get(item.name);
      if(!original)throw new Error('Unknown legacy node name: '+item.name);
    }
    if(original.name!==item.name)throw new Error('Legacy node identity/name mismatch: '+item.name);
    const target=globalById.get(original.id);
    if(!target||target.name!==original.name)throw new Error('Legacy physical node not in global graph: '+item.name);
    const incoming=item.incoming?{...item.incoming}:item.incoming;
    // Preserve officialMinutes, actualMinutes, note, date, and time alternatives.
    // Legacy endpoint IDs (if present) are remapped only after exact source-ID checks.
    if(incoming?.kind==='official'){
      for(const [nodeKey,nameKey] of [['fromNodeId','from'],['toNodeId','to']]){
        const oldId=incoming[nodeKey];
        if(oldId){
          const old=legacy.byId.get(oldId);
          if(!old||old.name!==incoming[nameKey]||!globalById.has(old.id))
            throw new Error('Unknown legacy edge endpoint: '+oldId);
          incoming[nodeKey]=old.id;
        }
      }
    }
    return {...item,nodeId:target.id,incoming};
  })}));
}
