import fs from 'node:fs';
import {resolve} from 'node:path';
import {registerGpx} from './route-validator/core.mjs';
import {hash} from './route-validator/utils.mjs';
const records=JSON.parse(fs.readFileSync('data/audits/route-review-20261125-round2/gpx-acquisitions-batch.json'));
const evidence=JSON.parse(fs.readFileSync('data/route-validator/review-evidence-20261125.json')),links=JSON.parse(fs.readFileSync('.route-validator/research/round2/index.json'));
const extra={1496470:['R061'],4170827:['R070','R069','R072'],668052:['R088'],1852782:['R059'],1765487:['R058'],1765488:['R058'],1765489:['R058'],1765491:['R058']};
const results=[];
for(const [id,author,memberId,filename]of records){
 const fromLinks=links.filter(r=>r.gpxLinks?.some(u=>new URL(u).searchParams.get('id')===id)).flatMap(r=>evidence.groups.filter(g=>g.sources.includes(r.url)).flatMap(g=>g.routeIds));
 const routeIds=[...new Set([...fromLinks,...(extra[id]||[])])];if(!routeIds.length)throw Error('Missing source route association '+id);
 const bytes=fs.readFileSync(resolve('C:/Users/jeter_lin/Downloads',filename));
 try{const saved=registerGpx(bytes,{recordingId:id,author,...(memberId?{authorProfile:'https://hiking.biji.co/index.php?q=member&member='+memberId}:{}),sourceUrl:'https://hiking.biji.co/index.php?q=trail&act=gpx_detail&id='+id,routeIds,scope:'unknown',variant:'unclassified',travelMode:'unknown',acquisition:'Chrome已登入；每份來源新頁正常直接下載；沒有保存Cookie或帳密',usage:'本機資料核對與規劃參考；不公開再散布',name:filename,...(id.startsWith('17654')?{tripId:'biji-20230402-chilai-east-four-days'}:{})});results.push({recordingId:id,status:'PARSED_TRACK',file:saved.file,sha256:saved.sha256,author,routeIds,observedDate:saved.observedDate,points:saved.summary.points});}
 catch(e){const sha256=hash(bytes),file='.route-validator/reference-files/'+sha256+'.gpx';fs.mkdirSync('.route-validator/reference-files',{recursive:true});fs.writeFileSync(file,bytes);results.push({recordingId:id,status:'NOT_USABLE_AS_RECORDED_TRACK',sha256,file,author,routeIds,reason:e.message});}
}
fs.writeFileSync('data/audits/route-review-20261125-round2/gpx-acquisition-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(r=>({id:r.recordingId,status:r.status,date:r.observedDate,points:r.points,reason:r.reason})),null,2));
