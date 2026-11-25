import fs from 'node:fs';
import {loadSnapshot,loadProject} from './route-validator/core.mjs';
import {scanSequence} from './route-validator/sequence-review.mjs';
const s=loadSnapshot(undefined,process.argv[2]||'.route-validator/backups/round2-snapshot.json'),p=loadProject();
const results=s.routes.filter(r=>r.occurrences.length).map(r=>scanSequence(r,p));
const out='data/audits/route-review-20261125-round2';fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(out+'/corridor-scan.json',JSON.stringify({snapshotSha256:s.sha256,graphDigest:p.digest,results},null,2));
for(const r of results){console.log(r.routeId,r.name,'重要未標',r.missingImportance.length,'通行限制',r.issues.length);for(const o of r.omissions)console.log('  ',o.positions.join('→'),p.nodes.get(o.fromId)?.name,'→',p.nodes.get(o.toId)?.name,':',o.events.map(e=>e.name+'('+Math.round(e.offsetMeters)+'m)').join('、'));}
