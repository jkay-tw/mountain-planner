import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {WORK,BASE,loadSnapshot,loadProject,loadLibrary,libraryIndex,registerGpx,downloadGpx,syncSheet,importCsv,runAudit,configAt,PILOTS,collectReferences} from './core.mjs';
import {STYLE,writeReports} from './reports.mjs';
import {ROOT,readJson,writeJson} from './utils.mjs';

function page(token) {return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mountain Planner 路線檢查</title><style>${STYLE}</style><main><small>MOUNTAIN PLANNER · 開發者工具</small><h1>路線資料檢查</h1><p>更新資料、按一下檢查，再看異常。程式不會改動正式路線，也不呼叫 AI API。</p><div class="card"><h2 style="margin-top:0">① 選擇資料</h2><p id="status">正在讀取本機資料…</p><div class="row"><button class="secondary" id="sync">更新 Google Sheet</button><button class="secondary" id="csv-toggle">改用兩份 CSV 匯入</button></div><p class="muted">更新失敗會保留目前快照；不會退回舊版 Routes／RouteNodes 分頁。</p><form id="csv-form" hidden><label>Routes_順序校核.csv<input type="file" id="routes-csv" accept=".csv" required></label><label>RouteNodes_順序校核.csv<input type="file" id="nodes-csv" accept=".csv" required></label><button>匯入兩份資料</button></form></div><div class="card"><h2 style="margin-top:0">② 執行檢查</h2><label for="scope">檢查範圍</label><select id="scope"><option value="pilots">先檢查六條試驗路線</option><option value="enabled">全部已選用路線</option><option value="all">所有路線（含未選用）</option></select><label for="route-filter">或只檢查指定路線（可留空）</label><input id="route-filter" placeholder="例如 R001 或 R031,R066"><p><button id="run">開始檢查</button> <a class="button secondary" href="/reports/index.html" target="_blank" id="report">開啟異常報告</a></p><p class="muted">重跑會重用未變動的計算。報告會列出資料差異與證據缺口，證據不足不會判定通過。</p></div><div class="card"><h2 style="margin-top:0">③ 補充 GPX（需要時）</h2><p>檔案只需收錄一次，以後自動重用。相同作者或重複軌跡不會重複計票。</p><details><summary>下載已知來源中可直接取得的 GPX</summary><p>只嘗試 Sheet 與研究索引中已記錄的 GPX 連結；遇登入或限制就停止。這不是全站爬蟲，也不保證來源檔案完整或同走法。</p><button class="secondary" id="download">檢查並下載公開 GPX</button><p id="download-status" class="muted"></p></details><details><summary>加入 GPX 檔案／公開連結</summary><form id="gpx-form"><label>對應路線編號<input id="gpx-route" placeholder="例如 R031；共用可填 R030,R031" required></label><label>選擇 GPX 檔案<input type="file" id="gpx-file" accept=".gpx"></label><label>或填入公開 GPX／健行筆記 GPX 頁面連結<input type="url" id="gpx-url" placeholder="https://…"></label><div class="row"><label>作者或來源識別<input id="gpx-author" placeholder="不知道可留空，不會計入獨立證據"></label><label>來源頁面連結<input type="url" id="gpx-source" placeholder="檔案原始來源網址"></label></div><label>軌跡範圍<select id="gpx-scope"><option value="unknown">尚未確認</option><option value="complete">完整路線</option><option value="partial">只有部分路段</option></select></label><label>走法<select id="gpx-variant"><option value="unclassified">尚未分類</option><option value="defined-route">與指定路線相同走法</option><option value="other-variant">另一種變體</option></select></label><label>交通方式<select id="gpx-mode"><option value="unknown">尚未確認</option><option value="walking">步行</option><option value="mixed">包含車行／混合</option></select></label><p class="muted">資料不確定時保留「尚未確認」即可。即使選完整步行，程式仍會檢查首尾、中斷、速度與匹配，不能靠選項直接通過。</p><button>收錄並保存</button></form></details></div><details><summary>以後如何新增路線？</summary><ol><li>在 Sheet 的兩個「順序校核」分頁新增路線定義及明確 Node ID、position。編號不可重複。</li><li>回到這裡按「更新 Google Sheet」，新路線會自動加入，不需修改程式或清單。</li><li>加入參考 GPX，執行檢查。缺節點、缺路段或缺證據會直接列出。</li></ol><p>新地點尚無 Node ID 時，保留待建節點需求；不要自行編造正式 ID。此工具不自動建立權威路網。</p></details><div id="notice" role="status" aria-live="polite" class="notice">準備就緒。</div><footer>關閉啟動的命令視窗可停止工具。原始 GPX、快取及最新報告放在專案內 .route-validator 資料夾；搬到另一台電腦時一起帶走。</footer></main><script>
const token=${JSON.stringify(token)};let busy=false;
const notice=document.getElementById('notice');
async function request(path,data){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Route-Validator':token},body:JSON.stringify(data)});const body=await r.json();if(!r.ok)throw Error(body.error||'操作失敗');return body;}
async function action(message,fn){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);notice.textContent=message;try{const result=await fn();notice.textContent=result.message||'完成。';await refresh();}catch(e){notice.textContent='未完成：'+e.message+'；既有資料仍保留。';}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
async function refresh(){const r=await fetch('/api/status');const s=await r.json();const date=Number.isFinite(Date.parse(s.capturedAt))?new Date(s.capturedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})+'（台北）':'未提供日期';document.getElementById('status').textContent='目前快照：'+date+'；'+s.routes+' 條路線（選用 '+s.enabled+' 條），'+s.validNodes+' 次有效經過；已收錄 '+s.gpxCount+' 份 GPX。';document.getElementById('report').hidden=!s.hasReport;document.getElementById('download-status').textContent='已記錄 '+s.retrievalAttempts+' 個來源取得結果；限制來源不會反覆重試。';}
document.getElementById('sync').onclick=()=>action('正在唯讀更新兩個順序校核分頁…',()=>request('/api/sync',{}));
document.getElementById('csv-toggle').onclick=()=>{const f=document.getElementById('csv-form');f.hidden=!f.hidden;};
document.getElementById('csv-form').onsubmit=e=>{e.preventDefault();action('正在檢查並匯入兩份 CSV…',async()=>request('/api/import-csv',{routes:await document.getElementById('routes-csv').files[0].text(),nodes:await document.getElementById('nodes-csv').files[0].text()}));};
document.getElementById('run').onclick=()=>action('正在檢查。完成後按「開啟異常報告」查看結果…',()=>request('/api/run',{scope:document.getElementById('scope').value,routeIds:document.getElementById('route-filter').value}));
document.getElementById('download').onclick=()=>action('正在檢查已知公開來源；登入限制會記錄並停止，請稍候…',()=>request('/api/fetch-public',{}));
document.getElementById('gpx-form').onsubmit=e=>{e.preventDefault();action('正在驗證 GPX 並收錄來源…',async()=>{const file=document.getElementById('gpx-file').files[0],url=document.getElementById('gpx-url').value;if(!file&&!url)throw Error('請選擇檔案或填入公開連結');return request('/api/gpx',{xml:file?await file.text():null,url,metadata:{routeIds:document.getElementById('gpx-route').value.split(/[,，\\s]+/).filter(Boolean),author:document.getElementById('gpx-author').value,sourceUrl:document.getElementById('gpx-source').value||url,scope:document.getElementById('gpx-scope').value,variant:document.getElementById('gpx-variant').value,travelMode:document.getElementById('gpx-mode').value}});});};
refresh().catch(e=>notice.textContent=e.message);
</script></html>`;}

export async function fetchKnownSources(work=WORK) {
  const input=loadSnapshot(work),known=collectReferences(input).filter(s=>s.role==='gpx-page');
  const notes=existsSync(resolve(BASE,'source-notes.json'))?readJson(resolve(BASE,'source-notes.json')):[];
  for(const note of notes)if(note.role==='gpx-page'&&!known.some(s=>s.url===note.url))known.push(note);
  const logPath=resolve(work,'retrieval-log.json'),logs=existsSync(logPath)?readJson(logPath):[];
  const existing=libraryIndex(work).sources;let success=0,failed=0,skipped=0;
  for(const source of known) {
    if(logs.some(l=>l.url===source.url)||existing.some(s=>s.sourceUrl===source.url)){skipped++;continue;}
    const note=notes.find(n=>n.url===source.url)||{};
    try {
      const saved=await downloadGpx(source.url,{routeIds:source.routeIds,author:note.author||'',scope:'unknown',variant:'unclassified',travelMode:'unknown'},work);
      logs.push({url:source.url,routeIds:source.routeIds,status:'downloaded',sourceId:saved.id,at:new Date().toISOString()});success++;
    }catch(e){logs.push({url:source.url,routeIds:source.routeIds,status:/登入/.test(e.message)?'requires-login':'unavailable',reason:e.message,at:new Date().toISOString()});failed++;}
    writeJson(logPath,logs);
  }
  return {success,failed,skipped,logs};
}
async function readBody(req) {
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>34*1024*1024)throw Error('輸入超過 34MB 上限');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function startServer({work=WORK,open=true,port=0}={}) {
  const token=randomBytes(32).toString('hex');let locked=false;
  const reportDir=resolve(work,'reports/latest');
  const server=createServer(async(req,res)=>{
    const host='127.0.0.1:'+server.address().port;
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    if(req.headers.host!==host){json(403,{error:'Host 不合法'});return;}
    const path=new URL(req.url,'http://'+host).pathname;
    try {
      if(req.method==='GET'&&path==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(page(token));return;}
      if(req.method==='GET'&&path==='/api/status'){
        const input=loadSnapshot(work),sources=libraryIndex(work),log=existsSync(resolve(work,'retrieval-log.json'))?readJson(resolve(work,'retrieval-log.json')):[];
        json(200,{capturedAt:input.snapshot.capturedAt,routes:input.routes.length,enabled:input.routes.filter(r=>r.enabled).length,validNodes:input.routes.reduce((n,r)=>n+r.occurrences.length,0),gpxCount:sources.sources.length,hasReport:existsSync(resolve(reportDir,'index.html')),retrievalAttempts:log.length});return;
      }
      const reportFiles=new Set(['index.html','report.json','routes.csv','anomalies.csv','anomalies.md','proposals.json','source-queue.json','observations.json']);
      if(req.method==='GET'&&path.startsWith('/reports/')&&reportFiles.has(path.slice('/reports/'.length))){const file=path.slice('/reports/'.length);res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.json')?'application/json; charset=utf-8':file.endsWith('.csv')?'text/csv; charset=utf-8':'text/plain; charset=utf-8'});res.end(readFileSync(resolve(reportDir,file)));return;}
      if(req.method!=='POST'||!path.startsWith('/api/')){json(404,{error:'找不到此頁面'});return;}
      const supplied=Buffer.from(String(req.headers['x-route-validator']||''));
      if(supplied.length!==token.length||!timingSafeEqual(supplied,Buffer.from(token))||req.headers.origin&&req.headers.origin!=='http://'+host||!String(req.headers['content-type']).startsWith('application/json')){json(403,{error:'請從本機工具頁面操作'});return;}
      if(locked){json(409,{error:'另一項工作正在執行'});return;}locked=true;
      try {
        const body=await readBody(req);
        if(path==='/api/run') {
          const input=loadSnapshot(work);let ids=null;
          if(body.routeIds?.trim())ids=body.routeIds.trim().toUpperCase().split(/[,，\s]+/).filter(Boolean);
          else if(body.scope==='pilots')ids=PILOTS;
          else if(body.scope==='enabled')ids=input.routes.filter(r=>r.enabled).map(r=>r.routeId);
          else if(body.scope!=='all')throw Error('檢查範圍不合法');
          if(ids?.some(id=>!/^R\d{3}$/.test(id)))throw Error('路線編號格式不合法');
          const project=loadProject(ROOT,work),report=runAudit({work,routeIds:ids,project});writeReports(report,reportDir,{project,library:loadLibrary(work,configAt(work))});
          json(200,{message:`檢查完成：${report.counts.routes} 條，符合自動門檻 ${report.counts.pass} 條；證據待補 ${report.counts.evidenceInsufficient} 條。請按「開啟異常報告」。`});
        }else if(path==='/api/sync'){await syncSheet(work);json(200,{message:'兩個順序校核分頁已更新為本機快照，請執行檢查。'});}
        else if(path==='/api/import-csv'){if(typeof body.routes!=='string'||typeof body.nodes!=='string')throw Error('請提供兩份 CSV');importCsv(body.routes,body.nodes,work);json(200,{message:'CSV 已檢查並保存，請執行檢查。'});}
        else if(path==='/api/gpx'){
          const meta=body.metadata||{};const routes=loadSnapshot(work).routes;
          if(!Array.isArray(meta.routeIds)||!meta.routeIds.length||meta.routeIds.some(id=>!routes.some(r=>r.routeId===id)))throw Error('請指定目前 Sheet 存在的路線編號');
          const saved=body.xml?registerGpx(Buffer.from(body.xml),meta,work):await downloadGpx(body.url,meta,work);
          json(200,{message:`GPX 已保存：${saved.summary.points} 個觀測點。${saved.warnings.length?'有品質疑點，檢查時會保留待確認。':'請重跑對應路線。'}`});
        }else if(path==='/api/fetch-public'){const fetched=await fetchKnownSources(work);json(200,{message:`來源蒐集完成：下載 ${fetched.success} 份；受限或無法取得 ${fetched.failed} 份；已處理 ${fetched.skipped} 個來源不重複下載。受限原因保存在 retrieval-log.json。`});}
        else json(404,{error:'找不到此操作'});
      }finally{locked=false;}
    }catch(e){json(400,{error:e.message});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const url='http://127.0.0.1:'+server.address().port;
  if(open){if(process.platform==='win32')execFile('rundll32.exe',['url.dll,FileProtocolHandler',url],()=>{});else execFile(process.platform==='darwin'?'open':'xdg-open',[url],()=>{});}
  return {server,url};
}
