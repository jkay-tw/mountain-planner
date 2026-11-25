import fs from 'node:fs';
import {cacheReferences} from './route-validator/research.mjs';
import {hash} from './route-validator/utils.mjs';
const primary=[['1622','R069'],['4170827','R070'],['259330','R072'],['69537','R064'],['11822','R057'],['476','R027'],['178049','R035,R039'],['86266','R013']];
const dir='.route-validator/research/recent',url=id=>'https://hiking.biji.co/index.php?q=trail&act=gpx_detail&id='+id;
const pages=await cacheReferences(primary.map(([id])=>url(id)),dir),associations=new Map();
pages.forEach((p,i)=>{for(const link of p.gpxLinks||[]){if(new URL(link).searchParams.get('act')!=='gpx_detail')continue;const id=new URL(link).searchParams.get('id');if(id===primary[i][0])continue;if(!associations.has(id))associations.set(id,new Set());for(const r of primary[i][1].split(','))associations.get(id).add(r);}});
const related=await cacheReferences([...associations.keys()].map(url),dir),records=[];
for(const page of related){const id=new URL(page.url).searchParams.get('id'),text=page.text||'',date=text.match(/記錄日期\s*(\d{4}-\d{2}-\d{2})/)?.[1]||null;
 const age=date?(Date.parse('2026-11-25')-Date.parse(date))/86400000:Infinity;
 records.push({recordingId:id,url:page.url,routeHints:[...associations.get(id)],recordingDateFromPage:date,status:age>=-1&&age<=1096?'RECENT_CANDIDATE':'HISTORICAL_OR_DATE_UNKNOWN',heading:text.slice(text.indexOf('熱門關鍵字')+5,text.indexOf('次點閱')).slice(-250),cacheSha256:page.sha256,notice:'相關GPX關聯僅供尋找，下載後仍須辨認完整性、方向及變體。'});
}
fs.writeFileSync(dir+'/candidates.json',JSON.stringify(records,null,2));console.log(JSON.stringify(records.filter(r=>r.status==='RECENT_CANDIDATE'),null,2));
