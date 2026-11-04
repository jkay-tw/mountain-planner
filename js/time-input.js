/** Normalize a typed 24-hour time without touching the DOM or keyboard. */
export function normalizeTimeInput(value) {
  const raw=String(value??'').trim();
  let hour,minute;
  if(/^\d{1,2}:\d{1,2}$/.test(raw)){
    [hour,minute]=raw.split(':').map(Number);
  }else if(/^\d{3,4}$/.test(raw)){
    hour=Number(raw.slice(0,-2));
    minute=Number(raw.slice(-2));
  }else if(/^\d{1,2}$/.test(raw)){
    hour=Number(raw);
    minute=0;
  }else{
    return null;
  }
  if(!Number.isInteger(hour)||!Number.isInteger(minute)||hour<0||hour>23||minute<0||minute>59)return null;
  return String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0');
}
