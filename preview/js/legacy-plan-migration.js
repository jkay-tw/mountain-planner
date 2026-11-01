// Safely migrate legacy single-chart itineraries into the global graph.
// Preserve historical official-minute snapshots; never recalculate on import.
import {buildNodeRegistry,isRetiredPreviewNode,canonicalReviewedId,acceptsReviewedName} from './node-identity.js?v=v0726';
export function migrateLegacyPlanDays(days, sourceRoute, globalRoute) {
  if(!Array.isArray(days)||!sourceRoute?.route_id||!globalRoute?.nodes)throw new Error('Invalid legacy migration inputs');
  const legacy=buildNodeRegistry(sourceRoute);
  const globalById=new Map(globalRoute.nodes.map(n=>[n.id,n]));
  return days.map(day=>({...day,items:day.items.map(item=>{
    if(item.type!=='location')return {...item};
    if(sourceRoute.route_id==='G07'&&isRetiredPreviewNode(item))return {...item,catalogStatus:'retired',incoming:item.incoming?{...item.incoming}:item.incoming};
    let original;
    if(item.nodeId){
      original=legacy.byId.get(item.nodeId)||legacy.byId.get(canonicalReviewedId(item.nodeId,item.name));
      if(!original)throw new Error('Unknown legacy node ID: '+item.nodeId);
    }else{
      if(legacy.ambiguousNames.has(item.name))throw new Error('Ambiguous legacy node name: '+item.name);
      original=legacy.byName.get(item.name);
      if(!original){
        const matches=legacy.nodes.filter(n=>acceptsReviewedName(n,item.name));
        if(matches.length===1)original=matches[0];
        else if(matches.length>1)throw new Error('Ambiguous legacy node name: '+item.name);
      }
      if(!original)throw new Error('Unknown legacy node name: '+item.name);
    }
    if(!acceptsReviewedName(original,item.name))throw new Error('Legacy node identity/name mismatch: '+item.name);
    const target=globalById.get(canonicalReviewedId(original.id,original.name));
    if(!target||!acceptsReviewedName(target,original.name))throw new Error('Legacy physical node not in global graph: '+item.name);
    const incoming=item.incoming?{...item.incoming}:item.incoming;
    // Preserve officialMinutes, actualMinutes, note, date, and time alternatives.
    // Legacy endpoint IDs (if present) are remapped only after exact source-ID checks.
    if(incoming?.kind==='official'){
      for(const [nodeKey,nameKey] of [['fromNodeId','from'],['toNodeId','to']]){
        const oldId=incoming[nodeKey];
        if(oldId){
          if(sourceRoute.route_id==='G07'&&isRetiredPreviewNode({nodeId:oldId,name:incoming[nameKey]}))continue;
          const old=legacy.byId.get(oldId)||legacy.byId.get(canonicalReviewedId(oldId,incoming[nameKey]));
          const targetId=canonicalReviewedId(oldId,incoming[nameKey]);
          if(!old||!acceptsReviewedName(old,incoming[nameKey])||!acceptsReviewedName(globalById.get(targetId),old.name))
            throw new Error('Unknown legacy edge endpoint: '+oldId);
          incoming[nodeKey]=targetId;
        }
      }
    }
    return {...item,nodeId:target.id,incoming};
  })}));
}
