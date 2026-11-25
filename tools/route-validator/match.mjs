import {meters, round, coordinateValid} from './utils.mjs';
import {sampleComponents} from './gpx.mjs';
export const DEFAULTS = {nearMeters:30,reviewMeters:100,maxGapMeters:500,minProgressMeters:1,minIndependent:3,endpointMeters:150,maxCandidates:256,maxChecks:20000000,geometrySampleMeters:50,geometryMaxMeters:30,lengthToleranceFraction:.25,lengthToleranceMeters:100};
export function project(p,a,b) {
  const sx=111195*Math.cos(p[1]*Math.PI/180),sy=111195;
  const ax=(a[0]-p[0])*sx,ay=(a[1]-p[1])*sy,dx=(b[0]-a[0])*sx,dy=(b[1]-a[1])*sy;
  const t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));
  return {fraction:t,offset:Math.hypot(ax+t*dx,ay+t*dy),coordinate:[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]};
}
export function lineIndex(components, config={}) {
  const cfg={...DEFAULTS,...config},edges=[],grid=new Map(),size=.002;
  let along=0;
  components.forEach((component,ci)=>{
    const points=component.map(p=>p.coordinate||p);
    for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i],length=meters(a,b);
      if (!coordinateValid(a)||!coordinateValid(b)) throw Error('線形座標不合法');
      if (length>cfg.maxGapMeters) {along+=length;continue;}
      if(length<.001)continue;
      const edge={a,b,length,along,component:ci,index:i-1}; const id=edges.push(edge)-1;
      for(let x=Math.floor(Math.min(a[0],b[0])/size);x<=Math.floor(Math.max(a[0],b[0])/size);x++)for(let y=Math.floor(Math.min(a[1],b[1])/size);y<=Math.floor(Math.max(a[1],b[1])/size);y++){const key=x+','+y;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(id);}
      along+=length;
    }
  });
  return {edges,grid,size,length:along,config:cfg};
}
export function candidates(point,index,budget={checks:0}) {
  const {config:cfg,size,grid,edges}=index;
  if(!coordinateValid(point))return {values:[],missingCoordinate:true};
  const dy=cfg.reviewMeters/111195,dx=dy/Math.max(.01,Math.cos(point[1]*Math.PI/180)),ids=new Set();
  for(let x=Math.floor((point[0]-dx)/size);x<=Math.floor((point[0]+dx)/size);x++)for(let y=Math.floor((point[1]-dy)/size);y<=Math.floor((point[1]+dy)/size);y++)for(const id of grid.get(x+','+y)||[])ids.add(id);
  const found=[];
  for(const id of ids){if(++budget.checks>cfg.maxChecks)throw Error('MATCH_BUDGET_EXCEEDED');const e=edges[id],p=project(point,e.a,e.b);if(p.offset<=cfg.reviewMeters)found.push({...p,along:e.along+p.fraction*e.length,component:e.component,edge:e.index,start:e.a});}
  found.sort((a,b)=>a.component-b.component||a.edge-b.edge);
  // Collapse a continuous visit, including stationary GPS jitter. Leaving the
  // radius or crossing a segment boundary starts a separate candidate visit.
  // DP still chooses among ALL visits, not a single nearest point per Node ID.
  const visits=[];
  for(const p of found){const visit=visits.at(-1),previous=visit?.at(-1);if(previous&&previous.component===p.component&&previous.edge+1===p.edge&&meters(point,p.start)<=cfg.nearMeters)visit.push(p);else visits.push([p]);}
  const values=visits.map(visit=>{const best=visit.reduce((a,b)=>a.offset<=b.offset?a:b);return {...best,uncertainVisit:visit.at(-1).along-visit[0].along>Math.max(200,cfg.reviewMeters*3)};});
  const unique=values.filter((p,i)=>!values.slice(0,i).some(q=>q.component===p.component&&Math.abs(q.along-p.along)<.5));
  const truncated=unique.length>cfg.maxCandidates;
  return {values:unique.slice(0,cfg.maxCandidates),truncated};
}
const better=(a,b)=>!b||a.count>b.count||a.count===b.count&&a.cost<b.cost-1e-7;
export function sequenceMatch(occurrences,components,config={}) {
  const index=lineIndex(components,config),budget={checks:0},rows=occurrences.map(o=>candidates(o.coordinate,index,budget));
  // Exact dynamic program: all earlier states remain available when a node is
  // missing. Prefix maxima avoid a beam search or silently dropped hypotheses.
  let states=[{along:-Infinity,count:0,cost:0,link:null}];
  for(let i=0;i<rows.length;i++) {
    states.sort((a,b)=>a.along-b.along);let at=0,best=states[0];const added=[];
    for(const candidate of rows[i].values.slice().sort((a,b)=>a.along-b.along)) {
      while(at<states.length&&states[at].along<=candidate.along-index.config.minProgressMeters){if(better(states[at],best))best=states[at];at++;}
      if(best.along>candidate.along-index.config.minProgressMeters)continue;
      added.push({along:candidate.along,count:best.count+1,cost:best.cost+candidate.offset**2,link:{position:i,candidate,previous:best.link}});
    }
    states.push(...added);
  }
  let best;for(const state of states)if(better(state,best))best=state;
  const matches=Array(occurrences.length).fill(null);for(let p=best.link;p;p=p.previous)matches[p.position]=p.candidate;
  const missing=matches.flatMap((p,i)=>p?[]:[i]),offsets=matches.filter(Boolean).map(p=>p.offset),first=matches[0],last=matches.at(-1);
  const segmentCrossings=matches.filter(Boolean).filter((p,i,a)=>i&&p.component!==a[i-1].component).length;
  const ambiguousPositions=[];
  for(let i=0;i<matches.length;i++)if(matches[i]){
    const p=matches[i],before=matches.slice(0,i).filter(Boolean).at(-1),after=matches.slice(i+1).find(Boolean);
    if(p.uncertainVisit||rows[i].values.some(q=>q.component===p.component&&Math.abs(q.along-p.along)>index.config.nearMeters*2&&q.offset<=index.config.nearMeters&&(!before||q.along>=before.along+index.config.minProgressMeters)&&(!after||q.along<=after.along-index.config.minProgressMeters)&&(i!==0||q.along<=index.config.endpointMeters)&&(i!==matches.length-1||index.length-q.along<=index.config.endpointMeters)))ambiguousPositions.push(i);
  }
  return {matched:best.count,total:occurrences.length,cost:best.cost,matches,missing,checks:budget.checks,
    truncated:rows.some(r=>r.truncated),segmentCrossings,ambiguousPositions,maxOffsetMeters:round(Math.max(0,...offsets)),
    endpointComplete:!!first&&!!last&&first.along<=index.config.endpointMeters&&index.length-last.along<=index.config.endpointMeters,
    distanceMeters:round(index.length),unmatchedButNearby:missing.filter(i=>rows[i].values.length),
    reverseMissingCoordinates:rows.flatMap((r,i)=>r.missingCoordinate?[i]:[])};
}
export function matchBothDirections(occurrences,components,config={}) {
  const forward=sequenceMatch(occurrences,components,config),reverse=sequenceMatch(occurrences,components.slice().reverse().map(s=>s.slice().reverse()),config);
  const useReverse=reverse.matched>forward.matched||reverse.matched===forward.matched&&reverse.cost<forward.cost;
  const result=useReverse?reverse:forward;
  return {...result,direction:useReverse?'reverse':'forward',directionAmbiguous:reverse.matched===forward.matched&&Math.abs(reverse.cost-forward.cost)<1,
    alternative:{matched:(useReverse?forward:reverse).matched,maxOffsetMeters:(useReverse?forward:reverse).maxOffsetMeters}};
}
// A deliberately narrow correction rule: only reorder distinct, uniquely
// observed nodes. Repeated occurrences, omitted nodes and changed endpoints
// require richer route-intent evidence and are never guessed here.
export function uniqueObservedOrder(occurrences,components,config={}) {
  if(components.length!==1||new Set(occurrences.map(o=>o.nodeId)).size!==occurrences.length)return null;
  const index=lineIndex(components,config),budget={checks:0},ordered=[];
  for(const o of occurrences){const options=candidates(o.coordinate,index,budget);if(options.truncated)return null;const near=options.values.filter(p=>p.offset<=index.config.nearMeters&&!p.uncertainVisit);if(near.length!==1)return null;ordered.push({nodeId:o.nodeId,along:near[0].along});}
  ordered.sort((a,b)=>a.along-b.along);
  if(ordered[0]?.nodeId!==occurrences[0]?.nodeId||ordered.at(-1)?.nodeId!==occurrences.at(-1)?.nodeId)return null;
  if(ordered.some((o,i)=>i&&o.along-ordered[i-1].along<index.config.nearMeters*2))return null;
  return ordered.map(o=>o.nodeId);
}
export function compareGeometry(coordinates,components,config={}) {
  const cfg={...DEFAULTS,...config},a=sampleComponents([coordinates.map(coordinate=>({coordinate}))],cfg.geometrySampleMeters)[0],b=sampleComponents(components,cfg.geometrySampleMeters).flat();
  const aIndex=lineIndex([coordinates],{...cfg,reviewMeters:cfg.geometryMaxMeters}),bIndex=lineIndex(components,{...cfg,reviewMeters:cfg.geometryMaxMeters});
  const budget={checks:0};
  const offsets=(samples,index)=>samples.map(p=>{const opts=candidates(p,index,budget).values;return opts.length?Math.min(...opts.map(c=>c.offset)):null;});
  const summarize=v=>({samples:v.length,overLimit:v.filter(n=>n===null).length,maxWithinLimitMeters:round(Math.max(0,...v.filter(n=>n!==null)))});
  const toTrack=summarize(offsets(a,bIndex)),toGeometry=summarize(offsets(b,aIndex));
  const length=parts=>parts.reduce((total,s)=>total+s.slice(1).reduce((n,p,i)=>n+meters(s[i].coordinate||s[i],p.coordinate||p),0),0);
  const geometryDistance=length([coordinates]),trackDistance=length(components),lengthDifference=Math.abs(geometryDistance-trackDistance),lengthLimit=Math.max(cfg.lengthToleranceMeters,geometryDistance*cfg.lengthToleranceFraction);
  return {toTrack,toGeometry,thresholdMeters:cfg.geometryMaxMeters,geometryDistanceMeters:round(geometryDistance),trackDistanceMeters:round(trackDistance),lengthDifferenceMeters:round(lengthDifference),lengthDifferenceLimitMeters:round(lengthLimit),withinTolerance:!toTrack.overLimit&&!toGeometry.overLimit&&lengthDifference<=lengthLimit};
}
