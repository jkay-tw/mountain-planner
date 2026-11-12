// Aliases describe an existing Node ID; they never create or merge identities.
export function nodeAliases(node){
  const names=new Set([String(node?.name||'').trim()]);
  const aliases=[];
  for(const value of node?.aliases||[]){
    if(typeof value!=='string')continue;
    const name=value.trim();
    if(name&&!names.has(name)){names.add(name);aliases.push(name)}
  }
  return aliases;
}

let dialog,returnFocus;
export function showNodeAliases(node){
  const aliases=nodeAliases(node);
  if(!aliases.length)return;
  if(!dialog){
    dialog=document.createElement('dialog');dialog.className='node-alias-dialog';
    dialog.setAttribute('aria-labelledby','node-alias-heading');
    dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});
    dialog.addEventListener('close',()=>{if(returnFocus?.isConnected)returnFocus.focus?.()});
    document.body.append(dialog);
  }
  const heading=document.createElement('h2');heading.id='node-alias-heading';heading.textContent=node.name;
  const label=document.createElement('p');label.textContent='別稱';
  const list=document.createElement('ul');
  for(const alias of aliases){const item=document.createElement('li');item.textContent=alias;list.append(item)}
  const close=document.createElement('button');close.type='button';close.textContent='關閉';close.onclick=()=>dialog.close();
  dialog.replaceChildren(heading,label,list,close);
  returnFocus=document.activeElement;
  if(!dialog.open)dialog.showModal();
  close.focus();
}
