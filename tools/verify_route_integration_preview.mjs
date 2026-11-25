// Browser acceptance against the actual Preview entry; no production writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,stat,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../',import.meta.url)),output=resolve(root,'docs/assets/idea002-integration-20261125');
const types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.gz':'application/octet-stream'};
const server=createServer(async(req,res)=>{try{const p=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!p.startsWith(root.endsWith(sep)?root:root+sep)){res.writeHead(403);res.end();return;}if(!(await stat(p)).isFile())throw Error();res.writeHead(200,{'Content-Type':types[extname(p)]||'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
 const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.stack||e.message));page.on('dialog',d=>d.accept());
 await page.goto(`http://127.0.0.1:${server.address().port}/preview/unified-editor.html`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#classicSelect').options.length===60);
 const plan=()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('mountain-planner.idea003-autosave.v1.tab')));
 const card=()=>page.locator('.day-card').first();
 const source=mode=>page.click(`[data-source="${mode}"]`);
 const catalog=JSON.parse(await readFile(resolve(root,'data/staging/idea002/classic-routes.candidate.json'),'utf8'));
 await page.selectOption('#routeSelect','G02-d1e06c0d');
 const initial=await plan(),startNames=await card().locator('[data-start-node]').allTextContents();
 assert.deepEqual(new Set(startNames),new Set(['＋ 上東埔停車場','＋ 東埔溫泉']));
 await mkdir(output,{recursive:true});await card().locator('.quick-starts').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(output,'desktop-starts.png')});
 for(const width of [320,390,768,1280]){
  await page.setViewportSize({width,height:900});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflow '+width);
  const chips=await card().locator('[data-start-node]').evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right};}));assert.ok(chips.every(b=>b.left>=0&&b.right<=width),'start chip overflow '+width);
 }
 await page.setViewportSize({width:390,height:844});await card().locator('.quick-starts').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(output,'mobile-starts.png')});
 await page.setViewportSize({width:1280,height:900});
 await card().locator('[data-start-node="shared:cw-v07-051"]').click();
 let p=await plan();assert.equal(p.days[0].items.length,1);assert.equal(p.days[0].items[0].nodeId,'shared:cw-v07-051');assert.equal(p.days[0].items[0].incoming,null);assert.equal(await card().locator('[data-start-node]').count(),0);assert.ok(await card().locator('[data-quick-key]').count()>0);
 await page.click('#undoBtn');assert.deepEqual((await plan()).days,initial.days);assert.equal(await card().locator('[data-start-node]').count(),2);
 await page.click('#redoBtn');assert.equal((await plan()).days[0].items.length,1);
 const one=(await plan()).days;await page.selectOption('#routeSelect','G04');assert.deepEqual((await plan()).days,one);
 await source('routes');assert.deepEqual((await plan()).days,one);assert.equal(await page.locator('.quick-starts').count(),0);
 await source('groups');assert.deepEqual((await plan()).days,one);
 // Use separate browser storage so the shared plan backup stays isolated.
 const emptyContext=await browser.newContext(),empty=await emptyContext.newPage();await empty.goto(page.url());await empty.waitForFunction(()=>document.querySelector('#classicSelect').options.length===60);
 const m=JSON.parse(await readFile(resolve(root,'preview/data/unified-editor-manifest.json'),'utf8'));
 let chartChecks=0;
 for(const group of m.routes){await empty.selectOption('#routeSelect',group.id);const actual=await empty.locator('.day-card').first().locator('[data-start-node]').evaluateAll(ns=>ns.map(n=>n.dataset.startNode));const expected=await empty.evaluate(async group=>{const {chartStartNodes}=await import('/preview/js/chart-starts.js');const {mergeReviewedRoutes}=await import('/preview/js/global-route.js');const manifest=await(await fetch('/preview/data/unified-editor-manifest.json')).json(),datasets=await Promise.all(manifest.routes.map(async m=>(await fetch('/preview/'+m.file)).json())),catalog=await(await fetch('/data/staging/idea002/classic-routes.candidate.json')).json();return chartStartNodes(mergeReviewedRoutes(datasets),catalog,manifest,group).map(n=>n.id);},group.id);assert.deepEqual(actual,expected,group.id);chartChecks++;}
 await emptyContext.close();
 // Apply every UI-supported direction and compare every occurrence with catalog.
 await source('routes');let applied=0;
 for(const entry of catalog.routes){
  await page.selectOption('#classicSelect',entry.routeId);
  const directions=['loop','traverse'].includes(entry.forward.type)?['forward','reverse']:['forward'];
  assert.equal(await page.locator('#classicDirection').isVisible(),directions.length===2,entry.routeId);
  for(const direction of directions){
   if(directions.length===2)await page.selectOption('#classicDirection',direction);
   assert.equal(await page.locator('#classicApply').isDisabled(),false,entry.routeId+' '+direction);
   await page.click('#classicApply');await page.waitForFunction(()=>!document.querySelector('#classicApply').disabled);
   const saved=await plan();assert.equal(saved.days.length,1);assert.deepEqual(saved.days[0].items.map(i=>i.nodeId),entry[direction].occurrences.map(o=>o.nodeId),entry.routeId+' '+direction);applied++;
  }
 }
 await page.selectOption('#classicSelect','R001');await page.click('#classicApply');await page.waitForFunction(()=>!document.querySelector('#classicApply').disabled);
 await card().locator('.day-note').fill('保留備註');await card().locator('.day-note').press('Tab');
 const keep=(await plan()).days;await source('groups');await page.selectOption('#routeSelect','G02-d1e06c0d');assert.deepEqual((await plan()).days,keep);assert.equal(await card().locator('[data-start-node]').count(),0);
 await source('routes');await page.selectOption('#classicSelect','R031');await page.click('#classicApply');await page.waitForFunction(()=>!document.querySelector('#classicApply').disabled);const r031=(await plan()).days;
 await page.click('#undoBtn');assert.deepEqual((await plan()).days,keep);await page.click('#redoBtn');assert.deepEqual((await plan()).days,r031);
 await page.evaluate(()=>{window.showSaveFilePicker=undefined;});const downloading=page.waitForEvent('download');await page.click('#saveBtn');const savedBytes=await readFile(await(await downloading).path());
 await page.setInputFiles('#importFile',{name:'route-integration.mplan.json',mimeType:'application/json',buffer:savedBytes});assert.deepEqual((await plan()).days,JSON.parse(savedBytes).days);
 const beforeReload=(await plan()).days;await page.reload();await page.waitForFunction(()=>document.querySelector('#classicSelect').options.length===60);assert.deepEqual((await plan()).days,beforeReload);
 assert.deepEqual(errors,[]);
 const report={result:'PASS',routeCount:catalog.routes.length,occurrences:catalog.routes.reduce((n,r)=>n+r.forward.occurrences.length,0),appliedDirections:applied,chartChecks,widths:[320,390,768,1280],checks:['Dongpu and Shangdongpu only in Yushan starts','one-node addition','existing directional quick add','undo/redo','group and source switching preserve itinerary','all chart endpoints','all route UI directions','R031','notes retained','JSON download/import','reload'],pageErrors:errors};
 await writeFile(resolve(output,'acceptance.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));await context.close();
}finally{await browser?.close();await new Promise(r=>server.close(r));}
