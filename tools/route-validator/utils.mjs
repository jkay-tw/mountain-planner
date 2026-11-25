import {createHash} from 'node:crypto';
import {readFileSync, mkdirSync, writeFileSync, renameSync} from 'node:fs';
import {dirname, resolve, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
export {meters} from '../../preview/js/osm-pilot-router.js';
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const VERSION = '1.0.0';
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const readJson = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
export function readCache(path) {try {const value=readJson(path);return value?.data&&value.sha256===hash(value.data)?value.data:null;}catch{return null;}}
export const writeCache = (path,data) => writeJson(path,{sha256:hash(data),data});
export function atomicWrite(path, value) {
  mkdirSync(dirname(path), {recursive:true});
  const temp = path + '.tmp-' + process.pid;
  writeFileSync(temp, value);
  renameSync(temp, path);
}
export const writeJson = (path, value) => atomicWrite(path, JSON.stringify(value, null, 2) + '\n');
export function inside(root, path) {
  const full = resolve(root, path), rel = relative(root, full);
  if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) throw Error('路徑超出資料目錄');
  return full;
}
export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i+1] === '"') {field += '"'; i++;} else {quoted = false; closed = true;} } else field += c; }
    else if (c === '"') {if (field || closed) throw Error('CSV 引號格式錯誤'); quoted = true;}
    else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field); field = ''; closed = false;
      if (c !== ',') { if (c === '\r' && text[i+1] === '\n') i++; rows.push(row); row = []; }
    } else {if (closed) throw Error('CSV 引號後含不合法字元'); field += c;}
  }
  if (quoted) throw Error('CSV 引號未結束');
  if (field || row.length || closed) {row.push(field); rows.push(row);}
  return rows;
}
export function table(rows, required) {
  if (!Array.isArray(rows) || !Array.isArray(rows[0])) throw Error('缺少資料表標題');
  const headers = rows[0].map(v => String(v ?? '').trim());
  for (const name of required) if (headers.filter(h => h === name).length !== 1) throw Error('缺少或重複欄位：' + name);
  return rows.slice(1).map((row, i) => ({sheetRow:i+2, ...Object.fromEntries(headers.map((h,j) => [h, row[j] ?? '']))}));
}
export const coordinateValid = p => Array.isArray(p) && p.length >= 2 && p.slice(0,2).every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const safeUrl = value => {try {const u = new URL(value); return ['https:','http:'].includes(u.protocol) ? u.href : null;} catch {return null;}};
export const round = n => Math.round(n * 10) / 10;
