import {bindNameEnter} from './name-enter.js';
import {dragRoute,moveRouteControl,deleteRouteControl,switchRouteInterval} from './route-edit-operations.js';
import {projectOnDisplayedScope} from './local-detour.js';
import {coordinateOf,editSegment,splitManualShape,promoteShapeControl} from './path-editor.js';
import {twd97Label} from './twd97.js?v=v0731';
import {uid} from './planner.js?v=segments1';

// Map-only editing changes plan items; global nodes and route source data stay immutable.
export function attachPathEditor({host,map,getDays,data,onChange,refitNetwork=()=>null}){
 const panel=document.createElement('div');panel.className='path-editor';
 panel.innerHTML='<div class="path-edit-toggle"><span id="path-edit-label">路徑編輯模式</span><button type="button" data-edit role="switch" aria-checked="false" aria-labelledby="path-edit-label"><span class="path-edit-track" aria-hidden="true"><span class="path-edit-thumb"></span></span><span data-edit-state aria-hidden="true">OFF</span></button></div><p data-detail role="status" hidden></p>';
 host.querySelector('[data-map]').before(panel);
 const $=s=>panel.querySelector(s),layer=L.layerGroup().addTo(map);
 let editing=false,selectedDayIndex=null,selectedItemId=null;
 const enabled=()=>editing,day=()=>getDays()[selectedDayIndex??0];
 const segment=()=>{const items=day()?.items.filter(x=>x.type!=='rest')||[],to=items.find(x=>x.id===selectedItemId);return {to,from:items[items.indexOf(to)-1]}};
 let feedback='',popupBox=null,previewMarker=null,activePopup=null;map.on('popupopen',event=>{activePopup=event.popup;});map.on('popupclose',event=>{if(activePopup===event.popup)activePopup=null;});
 function closePopup(){map.closePopup();popupBox?.remove();popupBox=null;if(previewMarker){map.removeLayer(previewMarker);previewMarker=null;}}
 function button(text,fn,parent){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=event=>{event.preventDefault();event.stopPropagation();fn();};parent.append(b);return b;}
 function nameForm(container,confirm){if(container.querySelector('.path-name-form'))return;const invoker=document.activeElement,actions=[...container.children].filter(e=>e.tagName==='BUTTON');actions.forEach(e=>e.hidden=true);const form=document.createElement('div');form.className='path-name-form';const input=document.createElement('input');input.placeholder='節點名稱';input.maxLength=250;input.setAttribute('aria-label','節點名稱');form.append(input);const submit=button('確認加入',()=>confirm(input.value.trim()||'手動節點'),form);bindNameEnter(input,()=>submit.click());button('取消',()=>{form.remove();actions.forEach(e=>e.hidden=false);activePopup?.update();if(invoker?.isConnected)invoker.focus({preventScroll:true});},form);container.append(form);if(activePopup){activePopup.options.autoPan=true;activePopup.options.autoPanPadding=L.point(16,16);activePopup.update();}input.focus({preventScroll:true});}
 const commit=(fn,{refit=true}={})=>{try{feedback=fn()||'';const target=segment().to;if(refit&&target?.pathEdit?.osmRouting){const result=refitNetwork(day(),target.id);if(result)feedback=result;}closePopup();onChange();refresh();}catch(error){feedback=error.message;refresh();}};
 const change=fn=>commit(()=>{const {to,from}=segment();if(!from||!to||!coordinateOf(from,data)||!coordinateOf(to,data))throw Error('端點沒有座標，暫時無法編輯。');editSegment(day(),to.id,fn);});
 function ensureControlShape(edit){if(edit.shape)return;const {from,to}=segment();edit.shape=[{coordinate:coordinateOf(from,data)},...edit.controls.map(c=>({coordinate:[...c.coordinate],controlId:c.id})),{coordinate:coordinateOf(to,data)}];}
 function addLocation(coordinate,name){const d=day(),previous=d.items.filter(x=>x.type!=='rest').at(-1),id=uid();d.items.push({id,type:'manual-location',name,coordinate:[...coordinate],showInTable:true,note:'',isPeak:false,hasWater:false,incoming:previous?{kind:'manual',fromId:previous.id,toId:id,actualMinutes:null}:null});}
 function popup(coordinate){closePopup();const box=document.createElement('div');box.className='path-popup';const p=document.createElement('p');p.className='path-coordinate';p.textContent=twd97Label(coordinate);box.append(p);button('複製座標',async()=>{try{await navigator.clipboard.writeText(p.textContent)}catch{feedback='無法自動複製，請選取座標複製。';refresh();}},box);button('加入行程點',()=>nameForm(box,name=>commit(()=>addLocation(coordinate,name),{refit:false})),box);button('關閉',closePopup,box);L.DomEvent.disableClickPropagation(box);L.DomEvent.disableScrollPropagation(box);map.getContainer().append(box);popupBox=box;previewMarker=L.circleMarker([coordinate[1],coordinate[0]],{radius:6,color:'#fff',weight:2,fillColor:'#a5441b',fillOpacity:1,interactive:false}).addTo(map);}
 map.on('click',event=>{if(enabled()&&performance.now()>=(map._pathDragUntil||0))popup([event.latlng.lng,event.latlng.lat]);});
 $('[data-edit]').onclick=()=>{editing=!editing;$('[data-edit]').setAttribute('aria-checked',String(editing));$('[data-edit-state]').textContent=editing?'ON':'OFF';feedback='';closePopup();refresh();};
 function refresh(){
  const {to,from}=segment(),edit=to&&from&&to.pathEdit?.fromItemId===from.id?to.pathEdit:null;
  const detail=$('[data-detail]');detail.hidden=!enabled();detail.textContent=feedback||'點選路段切換連接方式，拖線或控制點調整路徑。';layer.clearLayers();
  for(const [index,c] of (edit?.controls||[]).entries())if(enabled()){
   const content=document.createElement('div'),p=document.createElement('p');content.className='path-popup';p.textContent=twd97Label(c.coordinate);content.append(p);
   button('改為行程點',()=>nameForm(content,name=>commit(()=>{editSegment(day(),to.id,ensureControlShape);promoteShapeControl(day(),to.id,c.id,name);return '已加入行程，路段時間待填。';},{refit:false})),content);
   button('刪除控制點',()=>change(e=>{ensureControlShape(e);deleteRouteControl(e,index);}),content);
   const span=document.createElement('span');span.textContent=c.label||(edit.detour?.pId===c.id?'P':edit.detour?.qId===c.id?'Q':edit.detour?.id===c.id?'B':String(index+1));
   L.marker([c.coordinate[1],c.coordinate[0]],{draggable:true,icon:L.divIcon({className:'path-control-marker',html:span,iconSize:[44,44],iconAnchor:[22,22]})}).bindPopup(content,{autoPan:true,autoPanPadding:[16,16],autoPanPaddingTopLeft:[16,56],maxWidth:240,className:'path-map-popup'}).on('dragend',event=>{const p=event.target.getLatLng();change(e=>{ensureControlShape(e);moveRouteControl(e,index,[p.lng,p.lat]);});}).addTo(layer);
  }
 }
 function choose(dayIndex,toId){selectedDayIndex=dayIndex;selectedItemId=toId;refresh();}
 refresh();
 return {refresh,isEnabled:enabled,nameForm,setStatus(message){feedback=message;refresh();},select(dayIndex,toId){if(enabled())choose(dayIndex,toId);},
  insertAt(dayIndex,toId,geometry,at,coordinate,context={}){if(!enabled())return;choose(dayIndex,toId);change(e=>dragRoute(e,geometry,at,coordinate,uid(),{...context,endpointCoordinates:[coordinateOf(segment().from,data),coordinateOf(segment().to,data)]}));},
  toggleAt(dayIndex,toId,geometry,at,context={}){if(!enabled())return;choose(dayIndex,toId);change(e=>switchRouteInterval(e,geometry,at,{...context,endpointCoordinates:[coordinateOf(segment().from,data),coordinateOf(segment().to,data)]}));},
  splitAt(dayIndex,toId,geometry,at,name,context={}){if(!enabled())return;choose(dayIndex,toId);commit(()=>{const shape=segment().to.pathEdit?.shape||geometry.map(coordinate=>({coordinate})),hit=projectOnDisplayedScope(shape,context.scope,at);splitManualShape(day(),toId,geometry,hit.coordinate,name,uid(),hit.along,{...context,endpointCoordinates:[coordinateOf(segment().from,data),coordinateOf(segment().to,data)]});return '已加入行程，前後路段時間待填。';},{refit:false});}
 };
}
