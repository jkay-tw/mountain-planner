// showInTable is the sole visibility state shared with IDEA-003.
export const displayModes=['all','important','custom'];
const locations=day=>day.items.filter(i=>i.type!=='rest');
export function isImportant(item){
 if(item.classicRoute)return item.classicRoute.key??item.waypoint===true;
 return item.type==='manual-location'||item.auto!==true||item.waypoint===true;
}
export function normalizeDayDisplay(day){
 const items=locations(day);
 if(!displayModes.includes(day.displayMode))day.displayMode=items.every(i=>i.showInTable!==false)?'all':'custom';
 items.forEach((item,i)=>{
  if(day.displayMode==='all')item.showInTable=true;
  if(day.displayMode==='important')item.showInTable=isImportant(item);
  if(i===0||i===items.length-1)item.showInTable=true;
 });
 return day;
}
export function displayCount(day){const items=locations(day);return {shown:items.filter((i,j)=>j===0||j===items.length-1||i.showInTable!==false).length,total:items.length};}
export function applyDayDisplay(day,mode,checkedIds=[]){
 if(!displayModes.includes(mode))throw Error('不支援的顯示模式');
 day.displayMode=mode;
 if(mode==='custom'){const checked=new Set(checkedIds);for(const item of locations(day))item.showInTable=checked.has(item.id);}
 return normalizeDayDisplay(day);
}
export function openDayDisplay({getDay,onChange}){
 const original=getDay(),items=locations(original),signature=JSON.stringify(items.map(i=>[i.id,i.showInTable])),dialog=document.createElement('dialog');
 dialog.className='day-display-dialog';dialog.setAttribute('aria-label','管理顯示節點');
 dialog.innerHTML='<form method="dialog"><h2>管理顯示節點</h2><div class="display-modes"><label><input type="radio" name="displayMode" value="all">全部</label><label><input type="radio" name="displayMode" value="important">重要</label><label><input type="radio" name="displayMode" value="custom">自訂</label></div><p class="display-help">首尾保留顯示；隱藏不影響路徑與統計。全部顯示後可修改各段時間，再切回重要。</p><div data-custom><div class="display-bulk"><button type="button" class="secondary" data-all>全選</button><button type="button" class="secondary" data-none>取消全選</button></div><div class="display-node-list"></div></div><p data-display-status role="status"></p><div class="display-dialog-actions"><button value="cancel" class="secondary">取消</button><button type="button" data-display-apply>套用</button></div></form>';
 const list=dialog.querySelector('.display-node-list'),checks=[];
 for(const [index,item]of items.entries()){
  const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.value=item.id;check.checked=item.showInTable!==false;check.disabled=index===0||index===items.length-1;if(check.disabled)check.checked=true;
  label.append(check,document.createTextNode(`${index+1}. ${item.name}`));list.append(label);checks.push(check);
 }
 const selected=()=>dialog.querySelector('input[name=displayMode]:checked').value;
 const refresh=()=>{const mode=selected();dialog.querySelector('[data-custom]').hidden=mode!=='custom';const shown=mode==='all'?items.length:mode==='important'?items.filter((item,i)=>i===0||i===items.length-1||isImportant(item)).length:checks.filter(c=>c.checked).length;dialog.querySelector('[data-display-status]').textContent=`顯示 ${shown}／${items.length} 個節點`;};
 for(const radio of dialog.querySelectorAll('[name=displayMode]')){radio.checked=radio.value===original.displayMode;radio.onchange=refresh;}
 for(const check of checks)check.onchange=refresh;
 dialog.querySelector('[data-all]').onclick=()=>{checks.forEach(c=>c.checked=true);refresh();};
 dialog.querySelector('[data-none]').onclick=()=>{checks.forEach(c=>c.checked=c.disabled);refresh();};
 dialog.querySelector('[data-display-apply]').onclick=()=>{
  const day=getDay();if(day!==original||JSON.stringify(locations(day).map(i=>[i.id,i.showInTable]))!==signature){dialog.querySelector('[data-display-status]').textContent='行程已變更，請取消並重新開啟。';return;}
  applyDayDisplay(day,selected(),checks.filter(c=>c.checked).map(c=>c.value));dialog.close();onChange();
 };
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);refresh();dialog.showModal();
}
