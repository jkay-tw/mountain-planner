#!/usr/bin/env node
// Read-only catalog integrity and coverage report for the unified preview.
// Counts directional route records (not claims about all official charts).
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {addRouteIdentity} from '../js/node-identity.js';
import {mergeReviewedRoutes} from '../js/global-route.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function reportCatalog(manifest,load){
  if(!Array.isArray(manifest.routes)||!manifest.routes.length)throw new Error('Empty route manifest');
  const ids=new Set(),reports=[],routes=[];
  for(const row of manifest.routes){
    if(ids.has(row.id))throw new Error('Duplicate manifest group '+row.id);
    ids.add(row.id);
    const raw=load(row.file.split('?')[0]);
    const r=addRouteIdentity(raw);
    if(row.routingEnabled===false)r.routingEnabled=false;
    if(r.route_id!==row.id)throw new Error('Manifest route ID mismatch '+row.id);
    const local=new Set(r.nodes.map(n=>n.id));
    const seen=new Map();
    for(const e of r.segments){
      if(!local.has(e.fromId)||!local.has(e.toId))throw new Error('Dangling node in '+row.id);
      if(!Number.isFinite(e.minutes)||e.minutes<=0)throw new Error('Invalid directed time '+row.id);
      const k=e.fromId+'\0'+e.toId;
      if(seen.has(k))throw new Error('Duplicate directed walking edge '+row.id);
      seen.set(k,e.minutes);
      if(e.routingEnabled===false)continue;
      if(e.travelMode&&e.travelMode!=='walking')throw new Error('Vehicle edge in published preview '+row.id);
      if(e.verificationStatus&&e.verificationStatus!=='verified')throw new Error('Candidate edge in verified preview '+row.id);
      if(e.status&&e.status!=='checked')throw new Error('Unapproved edge in G06 '+row.id);
      if(!e.from||!e.to)throw new Error('Unlabeled segment '+row.id);
    }
    reports.push({id:row.id,source:row.source_url,nodeCount:r.nodes.length,directedEdges:r.segments.length,
      routingEnabled:r.routingEnabled!==false,disabledDirections:r.segments.filter(e=>e.routingEnabled===false).length,verificationScope:row.status});
    routes.push(r);
  }
  const combined=mergeReviewedRoutes(routes);
  const allNodes=new Set(combined.nodes.map(n=>n.id));
  if(allNodes.size!==combined.nodes.length)throw new Error('Merged physical identities conflict');
  const edges=new Set();
  for(const e of combined.segments){
    const k=e.fromId+'\0'+e.toId;
    if(edges.has(k))throw new Error('Duplicated combined directed edge');
    edges.add(k);
    if(e.travelMode!=='walking'||e.verificationStatus!=='verified')throw new Error('Unverified edge in merged graph');
  }
  return {datasetVersion:manifest.dataset_version,datasetCount:reports.length,
    inputNodes:reports.reduce((a,r)=>a+r.nodeCount,0),physicalNodes:combined.nodes.length,
    inputDirectedEdges:reports.reduce((a,r)=>a+r.directedEdges,0),
    uniqueDirectedEdges:combined.segments.length,
    crossDatasetSharedNodeCount:combined.nodes.filter(n=>n.groups?.length>1).length,
    charts:reports,limitations:'Counts only vetted preview route records, not all candidate chart edges or current trail passability.'};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const manifest=JSON.parse(readFileSync(resolve(root,'data/unified-editor-manifest.json'),'utf8'));
  const result=reportCatalog(manifest,p=>JSON.parse(readFileSync(resolve(root,p),'utf8')));
  const output=process.argv[2];
  if(output){mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(resolve(output),JSON.stringify(result,null,2)+'\n');}
  console.log(JSON.stringify(result,null,2));
}
