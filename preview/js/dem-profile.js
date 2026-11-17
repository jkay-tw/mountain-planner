export function joinLegCoordinates(features){const out=[];for(const feature of features)for(const point of feature.coordinates){const previous=out.at(-1);if(!previous||previous[0]!==point[0]||previous[1]!==point[1])out.push(point.slice(0,2));}return out;}
function heightAt(profile,distance){const index=profile.findIndex(p=>p[0]>=distance-.0001);if(index<0)return null;const b=profile[index],a=profile[Math.max(0,index-1)];if(Math.abs(b[0]-distance)<.001)return b[1];if(!Number.isFinite(a[1])||!Number.isFinite(b[1]))return null;return a[1]+(b[1]-a[1])*(distance-a[0])/(b[0]-a[0]||1);}
export function applyDemSnapshots(items,features){
 for(const item of items){const snapshot=item.demSnapshot;if(!snapshot?.profile?.length)continue;const leg=features.filter(f=>f.toItemId===item.id);if(JSON.stringify(joinLegCoordinates(leg))!==JSON.stringify(snapshot.shape))continue;
  let offset=0;for(const feature of leg){const end=offset+feature.distanceMeters;feature.profile=[[0,heightAt(snapshot.profile,offset)],...snapshot.profile.filter(p=>p[0]>offset+.001&&p[0]<end-.001).map(([d,z])=>[d-offset,z]),[feature.distanceMeters,heightAt(snapshot.profile,end)]];feature.demSource=snapshot.source;feature.sourceName+='；沿目前線形約30m DEM估算';offset=end;}
 }
}
