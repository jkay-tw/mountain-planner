#!/usr/bin/env node
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,writeJson} from './route-validator/utils.mjs';
import {WORK,PILOTS,runAudit,loadSnapshot,loadProject,loadLibrary,configAt,syncSheet,importCsv,downloadGpx,registerGpx} from './route-validator/core.mjs';
import {scanSequence} from './route-validator/sequence-review.mjs';
import {checkNodeOrder} from './route-validator/order-check.mjs';
import {writeReports} from './route-validator/reports.mjs';
import {startServer,fetchKnownSources} from './route-validator/server.mjs';

export async function main(args=process.argv.slice(2)) {
  const command=args.shift()||'serve',flags={};
  while(args.length){const key=args.shift();if(!key.startsWith('--'))throw Error('不明參數：'+key);const name=key.slice(2);if(['pilots','no-cache','no-open'].includes(name))flags[name]=true;else {if(!args.length||args[0].startsWith('--'))throw Error('缺少參數值：'+key);flags[name]=args.shift();}}
  const work=flags.work?resolve(flags.work):WORK;
  if(command==='serve'){const {url}=await startServer({work,open:!flags['no-open'],port:flags.port?Number(flags.port):0});console.log('路線檢查工具已啟動：'+url+'\n關閉視窗或按 Ctrl+C 可停止。');return;}
  if(command==='order-check'){
    const snapshot=loadSnapshot(work,flags.snapshot?resolve(flags.snapshot):null),project=loadProject(ROOT,work);
    const review=JSON.parse(readFileSync(resolve(ROOT,'data/route-validator/order-review-20261125.json'),'utf8'));
    const report=checkNodeOrder(snapshot,project,review),out=flags.out?resolve(flags.out):resolve(work,'reports/order-latest.json');writeJson(out,report);
    console.log(JSON.stringify({purpose:'現有上河節點與指定行走順序',...report.summary,report:out},null,2));
    if(report.summary.recheckRequired)process.exitCode=2;return;
  }
  if(command==='check') {
    const project=loadProject(ROOT,work),routeIds=flags.pilots?PILOTS:flags.routes?flags.routes.toUpperCase().split(','):null;
    const report=runAudit({work,project,routeIds,snapshotPath:flags.snapshot?resolve(flags.snapshot):null,noCache:flags['no-cache']});
    const out=flags.out?resolve(flags.out):resolve(work,'reports/latest');writeReports(report,out,{project,library:loadLibrary(work,configAt(work))});
    console.log(JSON.stringify({counts:report.counts,report:resolve(out,'index.html'),note:'資料差異及證據不足不等於程式執行失敗；不會自動修改正式路線。'},null,2));
    if(report.inputProblems.length)process.exitCode=2;return;
  }
  if(command==='sequence-check'){
    const input=loadSnapshot(work,flags.snapshot?resolve(flags.snapshot):null),project=loadProject(ROOT,work);
    const selected=flags.routes?flags.routes.toUpperCase().split(','):null;
    const results=input.routes.filter(r=>r.occurrences.length&&(!selected||selected.includes(r.routeId))).map(r=>scanSequence(r,project));
    const out=flags.out?resolve(flags.out):resolve(work,'reports/sequence-latest.json');
    writeJson(out,{generatedAt:new Date().toISOString(),snapshotSha256:input.sha256,graphDigest:project.digest,results,notice:'距離近僅為漏點／錯線線索；不自動改序，不等於完成外部行走順序核對。'});
    console.log(JSON.stringify({routes:results.length,blockedApproaches:results.reduce((n,r)=>n+r.issues.length,0),corridorCandidates:results.reduce((n,r)=>n+r.omissions.length,0),report:out},null,2));return;
  }
  if(command==='sync'){await syncSheet(work);console.log('Sheet 快照更新完成；請執行 check。');return;}
  if(command==='import-csv'){if(!flags.routes||!flags.nodes)throw Error('請指定 --routes Routes.csv --nodes RouteNodes.csv');importCsv(readFileSync(flags.routes,'utf8'),readFileSync(flags.nodes,'utf8'),work);console.log('CSV 已匯入。');return;}
  if(command==='add-gpx') {
    const meta={routeIds:(flags.routes||'').toUpperCase().split(',').filter(Boolean),author:flags.author||'',sourceUrl:flags.source||flags.url||'',scope:flags.scope||'unknown',variant:flags.variant||'unclassified',travelMode:flags.mode||'unknown'};
    if(!meta.routeIds.length)throw Error('請指定 --routes R001');
    const saved=flags.file?registerGpx(readFileSync(flags.file),meta,work):await downloadGpx(flags.url,meta,work);
    console.log(JSON.stringify({id:saved.id,summary:saved.summary,warnings:saved.warnings},null,2));return;
  }
  if(command==='fetch-public'){const r=await fetchKnownSources(work);console.log(JSON.stringify(r,null,2));return;}
  if(command==='help'){console.log('日常使用：雙擊「路線檢查.cmd」，或 node tools/route-validator.mjs\n節點順序：order-check [--snapshot 檔案] [--out 檔案]\n進階完整GPX檢查：check [--pilots | --routes R001,R031] [--out 目錄] [--no-cache]\nsync\nimport-csv --routes 檔案 --nodes 檔案\nadd-gpx --file 檔案 --routes R001 [--author 作者 --source 網址 --scope complete --variant defined-route --mode walking]\nfetch-public\nserve [--no-open] [--port 連接埠]');return;}
  throw Error('不明操作：'+command+'；可執行 help 查看使用方法。');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error('未完成：'+e.message);process.exitCode=1;});
