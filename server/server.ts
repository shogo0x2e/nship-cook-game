import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { networkInterfaces } from 'node:os';
import { createHmac, randomBytes } from 'node:crypto';
import { SessionError, strictObject } from './session-store.ts';
import { AccountStore } from './account-store.ts';
import { FamilyStore } from './family-store.ts';
import { ExperienceStore } from './experience-store.ts';
import { questionnaireVersion, recipeVersion, conceptVersion } from '../src/experience-protocol.ts';
import type { Role } from '../src/shared.ts';
const MAX_BODY=16*1024;
const MIME:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.wasm':'application/wasm','.task':'application/octet-stream','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'};
export type ServerOptions={host?:string;port?:number;dist?:string;tlsCert?:string;tlsKey?:string;dataPath?:string;allowedOrigins?:string[]};
function json(res:ServerResponse,status:number,data:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req:IncomingMessage,maxBytes=MAX_BODY):Promise<unknown>{
  if(req.headers['content-type']?.split(';')[0].trim()!=='application/json')throw new SessionError(415,'Use application/json');
  if(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')throw new SessionError(415,'Content encoding not supported');
  const length=req.headers['content-length'];if(length&&(!/^\d+$/.test(length)||Number(length)>maxBytes))throw new SessionError(413,'Request too large');
  const chunks:Buffer[]=[];let bytes=0;
  for await(const chunk of req){bytes+=chunk.length;if(bytes>maxBytes)throw new SessionError(413,'Request too large');chunks.push(Buffer.from(chunk));}
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
  const host=options.host??'127.0.0.1';const port=options.port??8787;const dist=resolve(options.dist??fileURLToPath(new URL('../dist',import.meta.url)));const accounts=new AccountStore(options.dataPath??':memory:');const store=new FamilyStore(accounts);const limiter=new Limiter();
  const experiences=new ExperienceStore(accounts.db);
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
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' https://sentry.x2e.me; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
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
        const identity=req.socket.remoteAddress??'unknown';
        const cookieName='cookgame_session';
        const token=req.headers.cookie?.split(';').map(part=>part.trim()).find(part=>part.startsWith(cookieName+'='))?.slice(cookieName.length+1);
        const secureCookie=secure||[...extraOrigins].some(value=>value.startsWith('https://'));
        const setCookie=(value:string,age:number)=>res.setHeader('Set-Cookie',`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secureCookie?'; Secure':''}`);
        if(path==='/api/version'&&req.method==='GET'){json(res,200,{revision:process.env.APP_REVISION??'development',authentication:'family-account-v1'});return;}
        if(path==='/api/experience-version'&&req.method==='GET'){
          json(res,200,{flow:'anonymous-poc-v1',questionnaireVersion,recipeVersion,conceptVersion,persistence:'sqlite'});return;
        }
        const experiencePath=/^\/api\/experiences\/([23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}|[0-9a-f-]{36})$/i.exec(path);
        if(experiencePath){
          const key=req.headers.authorization?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
          limiter.check('experience-global',identity,1200,60_000);
          limiter.check('experience-id',experiencePath[1],120,60_000);
          if(req.method==='PUT'){json(res,200,experiences.save(experiencePath[1],key,await body(req,64*1024)));return;}
          if(req.method==='GET'){json(res,200,experiences.get(experiencePath[1],key));return;}
          throw new SessionError(405,'Method not allowed');
        }
        if((path==='/api/auth/register'||path==='/api/auth/login')&&req.method==='POST'){
          limiter.check('auth-ip',identity,20,60_000);
          const input=await body(req);const fields=strictObject(input,['username','password']);
          if(typeof fields.username==='string')limiter.check('auth-user',fields.username.toLowerCase(),10,300_000);
          if(path.endsWith('register'))limiter.check('register',identity,5,60_000);
          const result=path.endsWith('register')?await accounts.register(input):await accounts.login(input);
          setCookie(result.token,604800);json(res,path.endsWith('register')?201:200,{username:result.account.username});return;
        }
        if(path==='/api/auth/logout'&&req.method==='POST'){
          strictObject(await body(req),[]);accounts.logout(token);setCookie('',0);json(res,200,{ok:true});return;
        }
        const account=accounts.authenticate(token);
        limiter.check('account',account.id,600,60_000);
        if(path==='/api/auth/me'&&req.method==='GET'){json(res,200,{username:account.username});return;}
        if(path==='/api/family'&&req.method==='GET'){json(res,200,{state:store.get(account.id)});return;}
        if(path==='/api/actions'&&req.method==='POST'){
          const role=req.headers['x-cookgame-role'];if(role!=='adult'&&role!=='child')throw new SessionError(400,'Choose adult or child role');
          json(res,200,{state:store.action(account.id,role as Role,await body(req))});return;
        }
        throw new SessionError(404,'Not found');
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
  server.once('close',()=>accounts.close());
  return{server,store,experiences,listen:()=>new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve();});})};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const host=process.env.HOST??'127.0.0.1';const port=Number(process.env.PORT??8787);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
  const allowedOrigins=(process.env.ALLOWED_ORIGINS??'').split(',').filter(Boolean);
  const service=await createSessionServer({host,port,tlsCert:process.env.TLS_CERT,tlsKey:process.env.TLS_KEY,allowedOrigins,dataPath:resolve(process.env.DATA_DIR??'data','cookgame.sqlite')});
  await service.listen();console.log(`Local cooking session server: ${process.env.TLS_CERT?'https':'http'}://${host}:${port}`);
  // No request, address, body, pairing-code, or token logs.
}
