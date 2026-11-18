import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../server/account-store.ts';
import { ExperienceStore } from '../server/experience-store.ts';
import { createSessionServer } from '../server/server.ts';
import { questionnaireVersion, recipeVersion, conceptVersion, type ExperiencePayload } from '../src/experience-protocol.ts';
const payload=(complete=false):ExperiencePayload=>({questionnaireVersion,recipeVersion,conceptVersion,sequence:1,age:8,demo:true,stage:complete?'done':'child-survey',selectedIngredients:['rice','carrot'],evidence:{rice:{offered:1,caught:1},carrot:{offered:1,caught:1}},recipeId:'curry',child:{answers:{game_fun:7,help_intent:6,daily_feasibility:4},comment:'こどもの感想'},parent:{answers:complete?{task_feasibility:6,continued_use:5}:{},comment:''},payment:complete?{kind:'free',maxMonthlyYen:0}:null,complete});
const status=(code:number)=>(error:unknown)=>error instanceof Error&&'status' in error&&error.status===code;
test('anonymous response is durable, private, idempotent, and final answers cannot be replaced by delayed drafts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cookgame-survey-'));const path=join(dir,'survey.sqlite');const id=randomUUID(),key=randomBytes(32).toString('hex');let accounts=new AccountStore(path);let store=new ExperienceStore(accounts.db);
 try{
  const draft=payload();const a=store.save(id,key,draft);assert.equal(a.complete,false);assert.deepEqual(store.save(id,key,draft),a);
  assert.throws(()=>store.get(id,randomBytes(32).toString('hex')),status(401));
  assert.throws(()=>store.save(id,key,{...draft,child:{...draft.child,comment:'conflict'}}),status(409));
  const final={...payload(true),sequence:2};const saved=store.save(id,key,final);assert.match(saved.receipt!,/^MG-/);
  assert.equal(store.save(id,key,draft).stale,true);assert.deepEqual(store.get(id,key).payload,final);
  assert.throws(()=>store.save(id,key,{...final,sequence:3}),status(409));
  assert.equal((accounts.db.prepare('SELECT count(*) n FROM experience_responses').get() as {n:number}).n,1);
  assert.equal((accounts.db.prepare('SELECT token_hash FROM experience_responses').get() as {token_hash:string}).token_hash.includes(key),false);
  accounts.close();accounts=new AccountStore(path);store=new ExperienceStore(accounts.db);
  assert.deepEqual(store.get(id,key).payload,final);assert.equal(store.get(id,key).receipt,saved.receipt);
 }finally{accounts.close();await rm(dir,{recursive:true,force:true});}
});
test('response validation rejects media, unknown scores, mismatched versions and impossible price values',()=>{
 const accounts=new AccountStore();const store=new ExperienceStore(accounts.db);const key=randomBytes(32).toString('hex');
 try{
  for(const change of [{age:8.5},{child:{answers:{game_fun:'unknown'},comment:''}},{child:{answers:{game_fun:8},comment:''}},{video:'forbidden'},{evidence:{carrot:{offered:0,caught:1}}},{payment:{kind:'paid',maxMonthlyYen:0}},{payment:{kind:'no_use',maxMonthlyYen:0}},{payment:{kind:'unknown',maxMonthlyYen:null}}])assert.throws(()=>store.save(randomUUID(),key,{...payload(),...change}),status(400));
  assert.throws(()=>store.save(randomUUID(),key,{...payload(),questionnaireVersion:'old'}),status(409));
  assert.throws(()=>store.save(randomUUID(),key,{...payload(),complete:true}),status(400));
  const noUse=store.save(randomUUID(),key,{...payload(true),payment:{kind:'no_use',maxMonthlyYen:null}});assert.equal(noUse.complete,true);
 }finally{accounts.close();}
});
test('public survey API requires a private experience key and same-origin writes; no public listing',async()=>{
 const app=await createSessionServer({port:0});await app.listen();const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;const id=randomUUID(),key=randomBytes(32).toString('hex');
 const put=(origin=base,token=key,extra:Record<string,unknown>={})=>fetch(`${base}/api/experiences/${id}`,{method:'PUT',headers:{Origin:origin,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...payload(true),...extra})});
 try{
  assert.equal((await fetch(`${base}/api/experience-version`)).status,200);
  assert.equal((await put('https://evil.example')).status,403);assert.equal((await put(base,'bad')).status,401);
  const response=await put();assert.equal(response.status,200);const result=await response.json();assert.equal(result.complete,true);
  assert.equal((await fetch(`${base}/api/experiences/${id}`)).status,401);
  const restored=await fetch(`${base}/api/experiences/${id}`,{headers:{Authorization:`Bearer ${key}`}});assert.equal(restored.status,200);
  assert.equal((await fetch(`${base}/api/experiences`)).status,401);
  assert.equal((await fetch(`${base}/api/family`)).status,401);
 }finally{app.server.closeAllConnections();await new Promise<void>(resolve=>app.server.close(()=>resolve()));}
});

test('operator exports exclude demo/drafts and safely preserve optional comments and price units',async()=>{
 const {execFileSync}=await import('node:child_process');const {readFile,stat}=await import('node:fs/promises');
 const dir=await mkdtemp(join(tmpdir(),'cookgame-export-'));const path=join(dir,'cookgame.sqlite');
 try{
  const accounts=new AccountStore(path);const store=new ExperienceStore(accounts.db);
  const complete=payload(true);complete.demo=false;complete.parent.comment='=HYPERLINK("bad")\n自由記述';complete.payment={kind:'paid',maxMonthlyYen:500};
  store.save(randomUUID(),randomBytes(32).toString('hex'),complete);
  store.save(randomUUID(),randomBytes(32).toString('hex'),payload(true));
  const draft=payload();draft.demo=false;store.save(randomUUID(),randomBytes(32).toString('hex'),draft);accounts.close();
  const summary=JSON.parse(execFileSync(process.execPath,['scripts/export-surveys.mjs','--db',path],{encoding:'utf8'}));
  assert.equal(summary.count,1);assert.equal(summary.paidMaxMonthlyYen.median,500);assert.equal(summary.likert['young-current-experience'].scores.game_fun.n,1);
  const csv=join(dir,'answers.csv');execFileSync(process.execPath,['scripts/export-surveys.mjs','--db',path,'--format','csv','--out',csv]);
  const text=await readFile(csv,'utf8');assert.ok(text.startsWith('\ufeff'));assert.ok(text.includes("'=HYPERLINK"));assert.equal((await stat(csv)).mode&0o777,0o600);
 }finally{await rm(dir,{recursive:true,force:true});}
});
