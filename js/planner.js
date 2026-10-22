export function outgoing(route, from){ return route.segments.filter(s => s.from === from); }
export function adjustedMinutes(minutes, coefficient){ return Math.round(minutes * coefficient); }
export function minutesToClock(totalMinutes){
  totalMinutes = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(totalMinutes / 60), m = totalMinutes % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
export function clockToMinutes(clock){ const [h,m]=clock.split(':').map(Number); return h*60+m; }
export function buildRows(items, startClock){
  let t = clockToMinutes(startClock);
  return items.map((item, i) => {
    const walk = adjustedMinutes(item.minutes, item.coefficient);
    t += walk;
    const arrive = minutesToClock(t);
    t += item.rest;
    return {...item, index:i+1, walk, arrive, depart:minutesToClock(t)};
  });
}
export function summarize(items){
  const sunriver = items.reduce((s,x)=>s+x.minutes,0);
  const adjusted = items.reduce((s,x)=>s+adjustedMinutes(x.minutes,x.coefficient),0);
  const rest = items.reduce((s,x)=>s+x.rest,0);
  return {sunriver, adjusted, rest, total:adjusted+rest};
}
