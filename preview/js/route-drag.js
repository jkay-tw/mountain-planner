// Own a gesture only when it starts on the route hit target. Leaflet paths do
// not emit native touchstart events; listening through line.on loses to pan.
export function bindRouteDrag({element,map,enabled,onPreview,onFinish,onTap,onCancel=()=>{},document:doc=element.ownerDocument,pointer=!!doc.defaultView?.PointerEvent}){
 let active=null,suppressUntil=0;
 const events=pointer?['pointerdown','pointermove','pointerup','pointercancel']:['touchstart','touchmove','touchend','touchcancel'];
 const sample=e=>{
  if(pointer)return e;
  const changed=Array.from(e.changedTouches||[]);if(!active)return changed[0]||e.touches?.[0];
  const matches=p=>p.identifier===active.start.id;
  // Lifting another finger must not commit the route finger's current position.
  return changed.find(matches)||(!['touchend','touchcancel'].includes(e.type)?Array.from(e.touches||[]).find(matches):null);
 };
 const point=e=>{const p=sample(e);return p?{id:pointer?p.pointerId:p.identifier,latlng:map.mouseEventToLatLng(p),x:p.clientX,y:p.clientY}:null;};
 const stop=e=>{if(e.cancelable)e.preventDefault();e.stopPropagation();};
 function cleanup(){for(const name of events.slice(1))doc.removeEventListener(name,handle,true);if(active?.restorePan)map.dragging.enable();active=null;}
 function handle(e){
  const p=point(e);if(!active||!p||p.id!==active.start.id)return;
  stop(e);const state=active;
  state.moved||=Math.hypot(p.x-state.start.x,p.y-state.start.y)>6;
  if(e.type===events[1]){onPreview(state.start.latlng,p.latlng,state.moved);return;}
  cleanup();suppressUntil=Date.now()+600;
  if(e.type===events[3]){onCancel();return;}
  if(state.moved){map._pathDragUntil=performance.now()+600;onFinish(state.start.latlng,p.latlng);}else onTap(p.latlng,e);
 }
 function start(e){
  if(!enabled()||active||(pointer&&e.button!==0))return;
  const p=point(e);if(!p)return;stop(e);
  active={start:p,moved:false,restorePan:map.dragging.enabled()};map.dragging.disable();
  if(pointer)try{element.setPointerCapture(e.pointerId);}catch{/* Document handlers also cover leaving the line. */}
  for(const name of events.slice(1))doc.addEventListener(name,handle,{capture:true,passive:false});
 }
 function click(e){if(Date.now()<suppressUntil){stop(e);e.stopImmediatePropagation();}}
 function mouse(e){if(enabled())e.stopPropagation();}
 element.style.touchAction='none';element.addEventListener(events[0],start,{capture:true,passive:false});element.addEventListener('click',click,true);element.addEventListener('mousedown',mouse,true);
 return ()=>{cleanup();onCancel();element.removeEventListener(events[0],start,true);element.removeEventListener('click',click,true);element.removeEventListener('mousedown',mouse,true);};
}
