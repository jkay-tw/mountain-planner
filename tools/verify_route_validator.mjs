// Optional browser acceptance. The validator itself needs only Node.js.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {startServer} from './route-validator/server.mjs';
import {WORK,loadSnapshot} from './route-validator/core.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
mkdirSync(resolve(WORK,'tests'),{recursive:true});
const work=mkdtempSync(resolve(WORK,'tests/browser-')),output=resolve(WORK,'qa');mkdirSync(output,{recursive:true});
const {server,url}=await startServer({work,open:false});let browser;
const errors=[];
try {
  browser=await chromium.launch(process.env.BROWSER_EXECUTABLE?{headless:true,executablePath:process.env.BROWSER_EXECUTABLE}:{headless:true,channel:'msedge'});
  const page=await browser.newPage({viewport:{width:1280,height:950}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('1400'));
  assert.match(await page.locator('#status').textContent(),/86 條路線（選用 60 條）/);
  await page.screenshot({path:resolve(output,'dashboard-desktop.png'),fullPage:true});
  await page.click('#run');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('檢查完成'));
  assert.match(await page.locator('#notice').textContent(),/6 條/);
  const popup=page.waitForEvent('popup');await page.click('#report');const report=await popup;report.on('pageerror',e=>errors.push(e.message));await report.waitForLoadState('load');
  assert.match(await report.locator('body').textContent(),/g02-006/);assert.match(await report.locator('body').textContent(),/目前僅核心片段/);
  await report.fill('#search','R066');assert.ok(await report.locator('.problem:visible').count()>0);assert.ok(await report.locator('.route[hidden]').count()>0);await report.fill('#search','');
  await report.screenshot({path:resolve(output,'report-desktop.png'),fullPage:true});
  for(const width of [320,390,768,1280]) {
    await page.setViewportSize({width,height:900});await report.setViewportSize({width,height:900});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'dashboard overflow '+width);
    assert.ok(await report.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'report overflow '+width);
  }
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(output,'dashboard-mobile.png'),fullPage:true});
  await page.getByText('加入 GPX 檔案／公開連結',{exact:true}).click();
  await page.fill('#gpx-route','R031');
  const xml='<gpx version="1.1"><trk><trkseg><trkpt lat="24" lon="121"/><trkpt lat="24.001" lon="121"/></trkseg></trk></gpx>';
  await page.setInputFiles('#gpx-file',{name:'synthetic-acceptance.gpx',mimeType:'application/gpx+xml',buffer:Buffer.from(xml)});
  await page.locator('#gpx-form button').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('GPX 已保存'));
  assert.match(await page.locator('#status').textContent(),/3 份 GPX/);
  // Reimporting identical bytes must not create another source or file.
  await page.locator('#gpx-form button').click();await page.waitForFunction(()=>!document.querySelector('#gpx-form button').disabled);assert.match(await page.locator('#status').textContent(),/3 份 GPX/);
  await page.setInputFiles('#gpx-file',{name:'not-a-track.gpx',mimeType:'application/gpx+xml',buffer:Buffer.from('<html>login</html>')});
  await page.locator('#gpx-form button').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('未完成'));assert.match(await page.locator('#status').textContent(),/3 份 GPX/);
  // New route onboarding through two CSVs, no code or route registry edits.
  const snapshot=loadSnapshot(work).snapshot,r=snapshot.sheets.Routes_順序校核.rows,n=snapshot.sheets.RouteNodes_順序校核.rows;
  const row=[...r[1]];row[0]='R900';row[1]='新增路線測試';const nodes=n.filter((v,i)=>i===0||v[0]==='R001').map((v,i)=>i?[...v.slice(0,1).map(()=>'R900'),'新增路線測試',...v.slice(2)]:v);
  const csv=rows=>rows.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
  await page.click('#csv-toggle');
  await page.setInputFiles('#routes-csv',{name:'Routes_順序校核.csv',mimeType:'text/csv',buffer:Buffer.from(csv([r[0],row]))});
  await page.setInputFiles('#nodes-csv',{name:'RouteNodes_順序校核.csv',mimeType:'text/csv',buffer:Buffer.from(csv(nodes))});
  await page.locator('#csv-form button').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('CSV 已檢查並保存'));
  assert.match(await page.locator('#status').textContent(),/1 條路線（選用 1 條）/);
  await page.fill('#route-filter','R900');await page.click('#run');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('檢查完成'));
  const saved=JSON.parse(readFileSync(resolve(work,'reports/latest/report.json')));assert.equal(saved.results[0].routeId,'R900');assert.equal(saved.results[0].eligibleForImport,false);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'PASS',pageErrors:errors,checks:['initial snapshot','six pilot execution','anomaly report','route search','320/390/768/1280px layouts','GPX upload','duplicate reuse','invalid GPX rejected','CSV new route onboarding','new route check'],screenshots:output},null,2));
}finally {
  await browser?.close();await new Promise(r=>server.close(r));
  const base=resolve(WORK,'tests');if(!work.startsWith(base+'\\browser-')&&!work.startsWith(base+'/browser-'))throw Error('Refuse cleanup outside test workspace');rmSync(work,{recursive:true,force:true});
}
