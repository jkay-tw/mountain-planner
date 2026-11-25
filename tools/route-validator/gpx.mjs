// Restricted, well-formed XML reader for GPX 1.0/1.1. No DTD, entity expansion,
// external resources, route interpolation or segment bridging.
import {meters, hash, coordinateValid, round} from './utils.mjs';
function decode(s) {
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(s)) throw Error('XML entity 不合法');
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_,v) => {
    if (v[0] === '#') {const n = v[1].toLowerCase() === 'x' ? parseInt(v.slice(2),16) : Number(v.slice(1)); if (!n || n>0x10ffff || n>=0xd800&&n<=0xdfff) throw Error('XML 字元不合法'); return String.fromCodePoint(n);}
    return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[v];
  });
}
export function parseGpx(input, {maxPoints=500000, maxBytes=32*1024*1024, maxGapMeters=500}={}) {
  const bytes = Buffer.from(input);
  if (bytes.length > maxBytes) throw Error('GPX 超出大小上限');
  const xml = bytes.toString('utf8').replace(/^\uFEFF/, '');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('GPX 不接受 DTD 或 ENTITY');
  const stack = [], segments = []; let segment, point, rootSeen = false, count = 0, cursor = 0, text = '', label = '', date = null;
  const local = name => name.split(':').at(-1);
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g;
  function close(name) {
    if (stack.at(-1) !== name) throw Error('GPX XML 標籤不配對');
    const tag = local(name), parent = local(stack.at(-2) || '');
    if (point && ['ele','time'].includes(tag) && parent === 'trkpt') {
      const value = text.trim();
      if (tag === 'ele') {if (!value || !Number.isFinite(Number(value))) throw Error('GPX 海拔不合法'); point.ele = Number(value);}
      else {const t = Date.parse(value); if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(t)) throw Error('GPX 時間不合法或缺少時區'); point.time = t; date ||= value.slice(0,10);}
    }
    if (tag === 'name' && ['trk','metadata'].includes(parent) && !label) label = text.trim();
    if (tag === 'trkpt' && point) {segment.push(point); point = null;}
    if (tag === 'trkseg') {if (segment?.length >= 2) segments.push(segment); segment = null;}
    stack.pop(); text = '';
  }
  for (const token of xml.matchAll(re)) {
    if (token.index !== cursor) throw Error('GPX XML 不完整');
    const s = token[0]; cursor += s.length;
    if (s.startsWith('<!--') || s.startsWith('<?')) continue;
    if (s.startsWith('<![CDATA[')) {text += s.slice(9,-3); continue;}
    if (!s.startsWith('<')) {if (!stack.length && s.trim()) throw Error('GPX 根節點外有文字'); text += decode(s); continue;}
    if (s.startsWith('</')) {if (!/^<\/[\w:.-]+\s*>$/.test(s)) throw Error('GPX 結束標籤不合法');close(s.slice(2,-1).trim());continue;}
    const match = /^<([\w:.-]+)([\s\S]*?)(\/?)>$/.exec(s);
    if (!match) throw Error('GPX 標籤不合法');
    const [,name, raw, empty] = match, attrs = {}; let at = 0;
    const attrRe = /\s+([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    for (const a of raw.matchAll(attrRe)) {if (raw.slice(at,a.index).trim() || Object.hasOwn(attrs,a[1])) throw Error('GPX 屬性不合法');attrs[a[1]] = decode(a[2] ?? a[3]);at = a.index+a[0].length;}
    if (raw.slice(at).trim()) throw Error('GPX 屬性不完整');
    if (!stack.length) {
      if (rootSeen || local(name) !== 'gpx' || !['1.0','1.1'].includes(attrs.version)) throw Error('需要 GPX 1.0／1.1 軌跡');
      rootSeen = true;
    }
    const tag = local(name), parent = local(stack.at(-1) || '');
    if (tag === 'trkseg' && parent === 'trk') {if (segment) throw Error('巢狀軌跡'); segment = [];}
    if (tag === 'trkpt' && parent === 'trkseg' && segment) {
      if (++count > maxPoints) throw Error('GPX 點數超出上限');
      const p = [Number(attrs.lon),Number(attrs.lat)];
      if (attrs.lon === undefined || attrs.lat === undefined || !attrs.lon.trim() || !attrs.lat.trim() || !coordinateValid(p)) throw Error('GPX 座標不合法');
      point = {coordinate:p,ele:null,time:null};
    }
    stack.push(name); text = ''; if (stack.length > 64) throw Error('XML 巢狀過深'); if (empty) close(name);
  }
  if (cursor !== xml.length || stack.length || !rootSeen || !segments.length) throw Error('GPX 缺少完整 trkseg，不能用路點或規劃線冒充實際軌跡');
  // Treat every recorded segment and long jump as a discontinuity, never a line.
  const components = [], warnings = []; let distance = 0, ascent = 0, descent = 0, speedSuspects = 0, timedEdges = 0, badTimes = 0;
  for (const points of segments) {
    let component = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const a = points[i-1], b = points[i], d = meters(a.coordinate,b.coordinate);
      if (d > maxGapMeters) {warnings.push({code:'TRACK_GAP',meters:round(d),point:i});if (component.length>=2) components.push(component);component=[b];continue;}
      distance += d; component.push(b);
      if (a.ele!==null && b.ele!==null) {const e=b.ele-a.ele;ascent+=Math.max(0,e);descent+=Math.max(0,-e);}
      if (a.time!==null && b.time!==null) {const dt=(b.time-a.time)/1000;if (dt<=0) badTimes++;else {timedEdges++;if (d>50 && d/dt>5) speedSuspects++;}}
    }
    if (component.length>=2) components.push(component);
  }
  if (!components.length) throw Error('GPX 只有中斷點，沒有可用連續線段');
  if (segments.length>1) warnings.push({code:'MULTI_SEGMENT',count:segments.length});
  if (badTimes) warnings.push({code:'INVALID_TIME_ORDER',count:badTimes});
  if (speedSuspects) warnings.push({code:'SUSPECT_VEHICLE_OR_GPS',count:speedSuspects});
  // Translation of names/timestamps or reverse export must not count as a new recording.
  const coords = components.map(s=>s.map(p=>p.coordinate.map(v=>Math.round(v*1e6)/1e6)));
  const shape = JSON.stringify(coords), reversed = JSON.stringify(coords.slice().reverse().map(s=>s.slice().reverse()));
  return {sha256:hash(bytes),shapeHash:hash(shape<reversed?shape:reversed),label,date,components,warnings,
    summary:{points:count,recordedSegments:segments.length,components:components.length,distanceMeters:round(distance),ascentMeters:round(ascent),descentMeters:round(descent),timedEdges,speedSuspects,start:components[0][0].coordinate,end:components.at(-1).at(-1).coordinate}};
}

export function sampleComponents(components, spacing=100, maxSamples=100000) {
  if(!Number.isFinite(spacing)||spacing<=0)throw Error('取樣間距必須大於零');let count=0;
  const add=(list,p)=>{if(++count>maxSamples)throw Error('SAMPLE_BUDGET_EXCEEDED');list.push(p);};
  return components.map(s=>{const result=[];add(result,s[0].coordinate);let walked=0;for(let i=1;i<s.length;i++){const a=s[i-1].coordinate,b=s[i].coordinate,d=meters(a,b);let used=0;while(walked+d-used>=spacing){const step=spacing-walked;used+=step;const t=d?used/d:0;add(result,[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);walked=0;}walked+=d-used;}if(meters(result.at(-1),s.at(-1).coordinate)>1)add(result,s.at(-1).coordinate);return result;});
}
