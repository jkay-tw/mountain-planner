// Local-only static preview. Does not build, publish, or change files.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.gz':'application/octet-stream'};
const server=createServer(async(req,res)=>{try{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),p=resolve(root,'.'+pathname);
 if(!p.startsWith(root.endsWith(sep)?root:root+sep)||pathname.split('/').some(s=>s.startsWith('.'))){res.writeHead(403);res.end();return;}
 if(!(await stat(p)).isFile()){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':types[extname(p)]||'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(p));
 }catch{res.writeHead(404);res.end();}});
server.listen(Number(process.argv[2]||0),'127.0.0.1',()=>console.log('Local Preview: http://127.0.0.1:'+server.address().port+'/preview/unified-editor.html'));
