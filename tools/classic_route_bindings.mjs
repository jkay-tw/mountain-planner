// Bind reviewed new occurrences to an explicitly selected EXISTING line.
// Never route between coordinates or create a straight connector.
import {project} from './route-validator/match.mjs';
import {meters} from './route-validator/utils.mjs';
import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function clipSourceSpan(span,from,to,id){
 if(!span||!from||!to||span.coordinates?.length<2||span.profile?.length<2||!Number.isFinite(span.distanceMeters)||span.distanceMeters<=0||span.profile.some(p=>!p.every(Number.isFinite)))throw Error('Missing source geometry/profile: '+id);
 const cumulative=[0];for(let i=1;i<span.coordinates.length;i++)cumulative.push(cumulative.at(-1)+meters(span.coordinates[i-1],span.coordinates[i]));
 const locate=node=>span.coordinates.slice(1).map((p,i)=>({...project(node.coordinate,span.coordinates[i],p),along:cumulative[i],length:cumulative[i+1]-cumulative[i]})).map(p=>({...p,along:p.along+p.fraction*p.length})).sort((a,b)=>a.offset-b.offset)[0];
 const a=locate(from),b=locate(to);if(a.offset>30||b.offset>30||Math.abs(a.along-b.along)<1)throw Error('Source clipping requires reviewed endpoints within 30 m: '+id);
 const reverse=a.along>b.along,lo=reverse?b:a,hi=reverse?a:b;
 let coordinates=[lo.coordinate,...span.coordinates.filter((p,i)=>cumulative[i]>lo.along&&cumulative[i]<hi.along),hi.coordinate];if(reverse)coordinates.reverse();
 const scale=span.distanceMeters/cumulative.at(-1),start=lo.along*scale,end=hi.along*scale;
 const elevation=d=>{const next=span.profile.findIndex(p=>p[0]>=d);if(next<=0)return span.profile[0][1];const a=span.profile[next-1],b=span.profile[next];return a[1]+(b[1]-a[1])*(d-a[0])/(b[0]-a[0]);};
 let profile=[[0,elevation(start)],...span.profile.filter(p=>p[0]>start&&p[0]<end).map(p=>[p[0]-start,p[1]]),[end-start,elevation(end)]];
 if(reverse)profile=profile.reverse().map(p=>[end-start-p[0],p[1]]);
 return {id,fromId:from.nodeId,toId:to.nodeId,viaNodeIds:[],reversible:span.reversible,coordinates,profile,distanceMeters:end-start,fromAnchor:coordinates[0],toAnchor:coordinates.at(-1),sourceName:span.sourceName||'既有 OSM 線形擷取；沿用原 DEM',sourceUrl:span.sourceUrl||'https://www.openstreetmap.org/copyright',sourceSpanId:span.id,sourceSpanSha256:hash(span),clip:{fromAlongMeters:a.along,toAlongMeters:b.along,fromOffsetMeters:a.offset,toOffsetMeters:b.offset}};
}
export function reviewedBindings(geometry,supplement,timeSource,timeSourceRef,timeSourceSha256){
 const nodes=new Map(geometry.nodes.map(n=>[n.nodeId,n]));
 const ridge='node:79b43ef005b9dfe9c481',north='shared:cw-v07-041';
 const northSpan=supplement.spans.find(s=>s.id==='classic-R057-osm-north-ridge-20261120');
 const clipped=clipSourceSpan(northSpan,nodes.get(north),nodes.get(ridge),'classic-R057-north-to-3241-20261125');
 // The already sourced ridge -> summit 25/30 minutes remain in the graph.
 // Unknown north -> ridge time is NOT derived by subtracting that time.
 supplement.edges.push(...[[north,ridge],[ridge,north]].map(([fromId,toId])=>({fromId,toId,minutes:null,manualTimeRequired:true,travelMode:'walking',verificationStatus:'owner-confirmed-connection',source:'沿用已核准北稜試作；3241稜線拆段，時間待填；'+northSpan.id})));
 const exitSpan=geometry.spans.find(s=>s.id==='owner-update-69f7ccc2fb31ed7c');
 supplement.spans.push(clipped,clipSourceSpan(exitSpan,nodes.get(timeSource.fromId),nodes.get(timeSource.toId),'classic-R069-road-to-creek-20261125'));
 supplement.walkingSegments=[[timeSource.fromId,timeSource.toId,timeSource.forwardMinutes],[timeSource.toId,timeSource.fromId,timeSource.reverseMinutes]].map(([fromId,toId,minutes])=>({fromId,toId,from:nodes.get(fromId).name,to:nodes.get(toId).name,minutes,travelMode:'walking',verificationStatus:'verified',source:timeSource.sourceUrl+'；原圖箭頭轉錄，非現地測量',sourceRef:timeSourceRef,sourceSha256:timeSourceSha256}));
 return supplement;
}
