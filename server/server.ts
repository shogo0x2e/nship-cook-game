import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { networkInterfaces } from 'node:os';
import { createHmac, randomBytes } from 'node:crypto';
import { SessionError, SessionStore } from './session-store.ts';
const MAX_BODY=16*1024;
const MIME:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.wasm':'application/wasm','.task':'application/octet-stream','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'};
export type ServerOptions={host?:string;port?:number;dist?:string;tlsCert?:string;tlsKey?:string;store?:SessionStore;allowedOrigins?:string[]};
function json(res:ServerResponse,status:number,data:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req:IncomingMessage):Promise<unknown>{
  if(req.headers['content-type']?.split(';')[0].trim()!=='application/json')throw new SessionError(415,'Use application/json');
  if(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')throw new SessionError(415,'Content encoding not supported');
  const length=req.headers['content-length'];if(length&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY))throw new SessionError(413,'Request too large');
  const chunks:Buffer[]=[];let bytes=0;
  for await(const chunk of req){bytes+=chunk.length;if(bytes>MAX_BODY)throw new SessionError(413,'Request too large');chunks.push(Buffer.from(chunk));}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new SessionError(400,'Invalid JSON');}
}
class Limiter {
  private entries=new Map<string,{count:number;until:number}>();private secret=randomBytes(32);
  check(scope:string,identity:string,limit:number,windowMs:number){const now=Date.now();for(const[key,value]of this.entries)if(value.until<=now)this.entries.delete(key);
    const key=createHmac('sha256',this.secret).update(`${scope}:${identity}`).digest('hex');let entry=this.entries.get(key);
    if(!entry){if(this.entries.size>=5000)throw new SessionError(429,'Try again later');entry={count:0,until:now+windowMs};this.entries.set(key,entry);}
    if(++entry.count>limit)throw new SessionError(429,'Too many requests; try again later');
  }
}
export async function createSessionServer(options:ServerOptions={}){
  const host=options.host??'127.0.0.1';const port=options.port??8787;const dist=resolve(options.dist??fileURLToPath(new URL('../dist',import.meta.url)));const store=options.store??new SessionStore();const limiter=new Limiter();
  if(Boolean(options.tlsCert)!==Boolean(options.tlsKey))throw new Error('Set both TLS_CERT and TLS_KEY');
  const secure=Boolean(options.tlsCert);const scheme=secure?'https':'http';
  const permittedHosts=new Set(['localhost','127.0.0.1','[::1]']);
  if(!['0.0.0.0','::'].includes(host))permittedHosts.add(host.includes(':')?`[${host}]`:host);
  if(['0.0.0.0','::'].includes(host))for(const list of Object.values(networkInterfaces()))for(const address of list??[])permittedHosts.add(address.address.includes(':')?`[${address.address}]`:address.address);
  const extraOrigins=new Set(options.allowedOrigins??[]);
  for(const origin of extraOrigins){const u=new URL(origin);if(u.origin!==origin||!['http:','https:'].includes(u.protocol))throw new Error('Invalid allowed origin');permittedHosts.add(u.hostname);}
  const handler=async(req:IncomingMessage,res:ServerResponse)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Permissions-Policy','camera=(self), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try{
      const authority=req.headers.host;if(!authority)throw new SessionError(400,'Host required');
      let requested:URL;try{requested=new URL(`${scheme}://${authority}${req.url??'/'}`);}catch{throw new SessionError(400,'Invalid URL');}
      const actualPort=String((server.address() as {port?:number}|null)?.port??port);
      if(!permittedHosts.has(requested.hostname)||requested.port!==actualPort&&!(requested.port===''&&actualPort===(secure?'443':'80')))throw new SessionError(403,'Host not allowed');
      const path=requested.pathname;
      if(path.startsWith('/api/')){
        res.setHeader('Cache-Control','no-store');
        if(['GET','HEAD','DELETE'].includes(req.method??'') && (req.headers['transfer-encoding'] || (req.headers['content-length'] && req.headers['content-length']!=='0'))) throw new SessionError(400,'This method accepts no body');
        if(req.headers['sec-fetch-site']==='cross-site')throw new SessionError(403,'Cross-site request denied');
        const origin=req.headers.origin;
        if(origin&&origin!==requested.origin&&!extraOrigins.has(origin))throw new SessionError(403,'Origin not allowed');
        if(!['GET','HEAD'].includes(req.method??'')&&!origin)throw new SessionError(403,'Origin required');
        const identity=req.socket.remoteAddress??'unknown';limiter.check('requests',identity,600,60_000);
        if(path==='/api/rooms'&&req.method==='POST'){limiter.check('create',identity,10,60_000);json(res,201,store.create(await body(req)));return;}
        if(path==='/api/join'&&req.method==='POST'){limiter.check('join',identity,10,60_000);json(res,200,store.join(await body(req)));return;}
        const match=/^\/api\/rooms\/([a-f0-9-]{36})(\/actions)?$/.exec(path);
        if(!match)throw new SessionError(404,'Not found');
        const auth=req.headers.authorization;if(!auth||!/^Bearer [a-f0-9]{64}$/.test(auth))throw new SessionError(401,'Bearer token required');const token=auth.slice(7);
        if(!match[2]&&req.method==='GET'){json(res,200,store.get(match[1],token));return;}
        if(!match[2]&&req.method==='DELETE'){store.remove(match[1],token);res.writeHead(204);res.end();return;}
        if(match[2]&&req.method==='POST'){json(res,200,store.action(match[1],token,await body(req)));return;}
        throw new SessionError(405,'Method not allowed');
      }
      if(req.method!=='GET'&&req.method!=='HEAD')throw new SessionError(405,'Method not allowed');
      let decoded:string;try{decoded=decodeURIComponent(path);}catch{throw new SessionError(400,'Invalid path');}
      if(decoded.includes('\0')||decoded.includes('\\'))throw new SessionError(400,'Invalid path');
      const file=resolve(dist,`.${decoded==='/'?'/index.html':decoded}`);
      if(!file.startsWith(dist+sep))throw new SessionError(403,'Invalid path');
      let info;try{info=await stat(file);}catch{throw new SessionError(404,'File not found; run npm run build');}
      if(!info.isFile())throw new SessionError(404,'Not found');
      res.setHeader('Content-Type',MIME[extname(file)]??'application/octet-stream');res.setHeader('Content-Length',info.size);res.setHeader('Cache-Control',file.endsWith('index.html')?'no-store':'no-cache');
      if(req.method==='HEAD'){res.end();return;}
      const stream=createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);
    }catch(error){if(res.headersSent){res.destroy();return;}if(error instanceof SessionError){if(error.status===429)res.setHeader('Retry-After','60');json(res,error.status,{error:error.message});}else json(res,500,{error:'Internal server error'});}
  };
  const server=secure?https.createServer({cert:await readFile(options.tlsCert!),key:await readFile(options.tlsKey!),maxHeaderSize:8192},handler):http.createServer({maxHeaderSize:8192},handler);
  server.requestTimeout=15_000;server.headersTimeout=10_000;server.keepAliveTimeout=5_000;
  return{server,store,listen:()=>new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve();});})};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const host=process.env.HOST??'127.0.0.1';const port=Number(process.env.PORT??8787);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
  const allowedOrigins=(process.env.ALLOWED_ORIGINS??'').split(',').filter(Boolean);
  const service=await createSessionServer({host,port,tlsCert:process.env.TLS_CERT,tlsKey:process.env.TLS_KEY,allowedOrigins});
  await service.listen();console.log(`Local cooking session server: ${process.env.TLS_CERT?'https':'http'}://${host}:${port}`);
  // No request, address, body, pairing-code, or token logs.
}
