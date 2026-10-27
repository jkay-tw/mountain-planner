// Reviewed identities are metadata; the route graph must never auto-connect them.
// Input is data/crosswalk-reviewed.json, intentionally separate from route segments.
export function verifyCrosswalk(crosswalk) {
  if(crosswalk?.schemaVersion!==1||!Array.isArray(crosswalk.canonicalNodes))throw Error('Invalid crosswalk');
  const used=new Map(),canonical=new Set();
  for(const group of crosswalk.canonicalNodes){
    if(!group.canonicalId||canonical.has(group.canonicalId))throw Error('Repeated canonical ID');
    canonical.add(group.canonicalId);
    if(group.routingEnabled!==false)throw Error('Cross-map routing is not approved');
    if(!Array.isArray(group.members)||group.members.length<2)throw Error('Empty group');
    for(const member of group.members){
      if(!member.group||!member.name)throw Error('Invalid crosswalk member');
      const key=JSON.stringify([member.group,member.name]);
      if(used.has(key))throw Error('Conflicting memberships: '+key);
      used.set(key,group.canonicalId);
    }
  }
  return {groups:canonical.size,members:used.size};
}
export function canonicalIdFor(crosswalk,group,name){
  for(const node of crosswalk.canonicalNodes){
    if(node.members.some(m=>m.group===group&&m.name===name))return node.canonicalId;
  }
  return null;
}
// Only when both datasets have independently verified walking edges may a future
// feature build an explicit cross-group route graph. This module never creates edges.
