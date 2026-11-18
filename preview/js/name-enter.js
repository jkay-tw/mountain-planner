// Bind only name inputs; composing Enter confirms IME text, not the operation.
export function bindNameEnter(input,confirm){
 let composing=false;input.enterKeyHint='done';
 input.addEventListener('compositionstart',()=>{composing=true;});input.addEventListener('compositionend',()=>{composing=false;});
 input.addEventListener('keydown',event=>{if(event.key!=='Enter'||composing||event.isComposing||event.keyCode===229||event.repeat)return;event.preventDefault();event.stopPropagation();confirm();});
}
