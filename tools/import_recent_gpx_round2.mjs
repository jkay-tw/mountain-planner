import fs from 'node:fs';
import {resolve} from 'node:path';
import {registerGpx} from './route-validator/core.mjs';
// Downloaded through the logged-in site's ordinary download control; no credentials retained.
const records=[
 ['6200892','pinky','1391733','馬博縱走.gpx',['R069']],
 ['6059402','YaYa Hsiang','777946','2026-09-25 盆駒西稜接馬博橫斷下嘆息灣出中平林道5日.gpx',['R069']],
 ['6091299','蔡宗佑','1899151','八大秀4天.gpx',['R070']],
 ['6114364','翁資焱','1395527','南二段Day5 中央金礦山屋至東埔 (八通關高繞).gpx',['R069','R070','R072']],
 ['5352731','Vincent','1090490','260219-21-六順山七彩湖三日行.gpx',['R064']],
 ['2918540','小楊小儀','967625','六順山七彩湖 兩天一夜‘’機+走‘’行程.gpx',['R064']],
 ['6053878','Chenling Hsu','1921646','奇萊北壁下屏風.gpx',['R057']],
 ['6008189','pinky','1391733','屏風上北壁.gpx',['R057']],
 ['6161659','水躍魚登山隊','1157450','雪山西稜 (1).gpx',['R027']],
 ['6114289','MikeYeh','1363963','【雪山西稜四日】雪山登山口至小雪山旅遊資訊站.gpx',['R027']],
 ['6220052','🌟👶Ya-wen🎈','1469037','1151110-17南二段.gpx',['R072']],
 ['6207514','草莓登山客','1001030','2026.10.11 南二段 中央金礦至東埔(八通關古道高繞，沒走八通關山).gpx',['R069','R070','R072']],
];
const results=[];
for(const [id,author,memberId,filename,routeIds] of records){
 const saved=registerGpx(fs.readFileSync(resolve('C:/Users/jeter_lin/Downloads',filename)),{
  recordingId:id,author,authorProfile:'https://hiking.biji.co/index.php?q=member&member='+memberId,
  sourceUrl:'https://hiking.biji.co/index.php?q=trail&act=gpx_detail&id='+id,routeIds,
  scope:'unknown',variant:'unclassified',travelMode:'unknown',name:filename,
  acquisition:'Chrome登入後正常直接下載；日期以GPX實際時間解析，不採上傳日期',
  usage:'本機資料核對與規劃參考；不公開再散布',
 });
 results.push({recordingId:id,author,routeIds,sourceUrl:saved.sourceUrl,sha256:saved.sha256,file:saved.file,observedDate:saved.observedDate,points:saved.summary.points,warnings:saved.warnings});
}
fs.writeFileSync('data/audits/route-review-20261125-round2/gpx-acquisitions-recent.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results.map(({recordingId,observedDate,points,warnings})=>({recordingId,observedDate,points,warnings})),null,2));
