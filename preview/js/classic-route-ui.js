import {routeContext} from './classic-route.js?v=owner1123';
import {sha256,routePickerNodes,searchClassicRoutes,prepareClassicDay,hasRouteDirection,classicRoutePreview} from './classic-route-apply.js?v=owner1123';
import {withClassicSources} from './classic-route-source.js?v=integration1125';
export async function mountClassicRoutes({graph,datasets,geometry,getDays,newDay,uid,onApply,onPickerChange}){
 const $=id=>document.getElementById(id),source=$('selectionSource'),panel=$('classicPanel'),select=$('classicSelect'),direction=$('classicDirection'),summary=$('classicSummary'),apply=$('classicApply');
 let entries=[],catalog,context,error='',busy=false,sourceMode='groups',previewOpen=true;
 const selected=()=>entries.find(r=>r.routeId===select.value);
 const definition=()=>selected()?.[hasRouteDirection(selected()?.forward)?direction.value:'forward'];
 const active=()=>sourceMode==='routes';
 function targets(){
  apply.disabled=busy||!context||definition()?.applicationStatus!=='candidate-review';
 }
 function refresh(){
  const entry=selected(),d=definition();
  direction.closest('label').hidden=!hasRouteDirection(d);
  direction.options[1].disabled=!entry||entry.reverse.applicationStatus!=='candidate-review';
  summary.textContent=error||(d?.applicationStatus==='blocked'?'此方向尚有路段或線形缺口，暫時無法套用。':!d?'找不到符合的試作路線。':d.directedSegments.some(s=>s.timeStatus==='manual-required')?'部分路段時間需在套用後手動填寫。':'');
  renderPreview(d);
  targets();
 }
 function renderPreview(d){
  const host=$('classicPreview');host.replaceChildren();host.hidden=!d||!previewOpen;if(!d||!previewOpen)return;
  const model=classicRoutePreview(d,context,geometry),title=document.createElement('h3');title.textContent='套用前預覽'+(hasRouteDirection(d)?' · '+(d.direction==='reverse'?'逆行':'順行'):'');host.append(title);
  const sequence=document.createElement('p');sequence.className='classic-sequence';sequence.textContent=model.names.filter((n,i)=>n.key||i===0||i===model.names.length-1).map(n=>n.name).join(' → ');host.append(sequence);
  const details=document.createElement('details'),caption=document.createElement('summary'),list=document.createElement('ol');caption.textContent='完整節點順序（'+model.names.length+' 次經過）';for(const n of model.names){const li=document.createElement('li');li.textContent=n.name;list.append(li);}details.append(caption,list);host.append(details);
 }
 function options(){const old=select.value;select.replaceChildren();for(const e of searchClassicRoutes(entries,$('classicSearch').value))select.add(new Option(e.forward.name,e.routeId));if([...select.options].some(o=>o.value===old))select.value=old;direction.value='forward';previewOpen=true;refresh();onPickerChange();}
 for(const button of source.querySelectorAll('[data-source]'))button.onclick=()=>{sourceMode=button.dataset.source;for(const b of source.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b===button));panel.hidden=!active();$('groupPicker').hidden=active();onPickerChange();};
 select.onchange=()=>{direction.value='forward';previewOpen=true;refresh();onPickerChange();};
 direction.onchange=()=>{previewOpen=true;refresh();onPickerChange();};
 $('classicSearch').oninput=options;
 apply.onclick=async()=>{
  if(busy)return;busy=true;targets();
  const d=definition(),current=getDays(),fingerprint=JSON.stringify(current);
  try{
   const coefficient=Number($('classicCoefficient').value);
   if(!$('classicCoefficient').value||!Number.isFinite(coefficient)||coefficient<0.1||coefficient>3)throw Error('請輸入 0.1 到 3 的步行上河係數。');
   const day=newDay(0);day.coefficient=Math.round(coefficient*100)/100;
   const prepared=await prepareClassicDay(d,context,geometry,day,uid,catalog.spanDigests);
   if(definition()!==d||!active()||Number($('classicCoefficient').value)!==coefficient)throw Error('所選路線、方向或係數已變更，請重新套用。');
   if(getDays()!==current||JSON.stringify(current)!==fingerprint)throw Error('行程已變更，請重新套用。');
   if(current.some(day=>day.items.length)&&!confirm(`將以「${d.name}${hasRouteDirection(d)?'・'+(d.direction==='forward'?'順行':'逆行'):''}」取代目前全部 DAY，完整候選路線先放入 DAY 1。可使用復原還原。是否繼續？`))return;
   onApply(prepared);previewOpen=false;renderPreview(d);
  }catch(e){summary.textContent=e.message;}finally{busy=false;targets();}
 };
 try{
  const response=await fetch((document.body.dataset.mode==='production'?'data/':'../data/')+'staging/idea002/classic-routes.candidate.json',{cache:'no-store'});if(!response.ok)throw Error('候選路線資料未載入。');catalog=await response.json();
  if(catalog.schemaVersion!==1||await sha256(JSON.stringify(datasets))!==catalog.graphDigest)throw Error('路網版本與候選不符，請重新核對後再套用。');
  const augmented=withClassicSources(graph,geometry,catalog.supplement);geometry=augmented.geometry;
  context=routeContext(augmented.graph,geometry,catalog.graphDigest);entries=catalog.routes.filter(r=>catalog.enabledRouteIds?.includes(r.routeId)??r.pilot);options();
 }catch(e){error=e.message;refresh();}
 return {active,nodes:()=>definition()?routePickerNodes(definition(),graph):[],catalog:()=>context?catalog:null,refresh:targets};
}
