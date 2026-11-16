import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AccountStore } from '../server/account-store.ts';
import { FamilyStore } from '../server/family-store.ts';
import { SessionError } from '../server/session-store.ts';
import { freshEvidence } from '../src/game.ts';
import { createSessionServer } from '../server/server.ts';
const credentials={username:'family_test',password:'correct horse battery staple'};
const rejects=(fn:()=>unknown,status:number)=>assert.throws(fn,(e:unknown)=>e instanceof SessionError&&e.status===status);
const asyncRejects=(fn:()=>Promise<unknown>,status:number)=>assert.rejects(fn,(e:unknown)=>e instanceof SessionError&&e.status===status);

test('accounts use unique salts and slow hashes; case-normalized login, logout and reset work',async()=>{
 const accounts=new AccountStore();
 try{
  const a=await accounts.register(credentials),b=await accounts.register({...credentials,username:'other_family'});
  const rows=accounts.db.prepare('SELECT salt,password_hash FROM accounts').all() as {salt:string;password_hash:string}[];
  assert.notEqual(rows[0].salt,rows[1].salt);assert.notEqual(rows[0].password_hash,rows[1].password_hash);assert.equal(rows[0].password_hash.length,128);
  assert.equal(JSON.stringify(rows).includes(credentials.password),false);
  assert.equal(accounts.authenticate(a.token).id,a.account.id);
  assert.equal((await accounts.login({...credentials,username:'FAMILY_TEST'})).account.id,a.account.id);
  await asyncRejects(()=>accounts.login({...credentials,password:'this is the wrong password'}),401);
  await asyncRejects(()=>accounts.login({...credentials,username:'unknown_family'}),401);
  await asyncRejects(()=>accounts.register(credentials),409);
  await asyncRejects(()=>accounts.register({...credentials,password:'short'}),400);
  await asyncRejects(()=>accounts.register({...credentials,video:'no'}),400);
  accounts.logout(b.token);rejects(()=>accounts.authenticate(b.token),401);
  await accounts.resetPassword(credentials.username,'the new password is a long phrase');
  rejects(()=>accounts.authenticate(a.token),401);
  await asyncRejects(()=>accounts.login(credentials),401);
  assert.equal((await accounts.login({...credentials,password:'the new password is a long phrase'})).account.id,a.account.id);
 }finally{accounts.close();}
});
test('account sessions expire and sessions are stored as hashes',async()=>{
 let now=0;const accounts=new AccountStore(':memory:',()=>now);
 try{const a=await accounts.register(credentials);assert.notEqual((accounts.db.prepare('SELECT token_hash FROM sessions').get() as {token_hash:string}).token_hash,a.token);now=7*86400000;rejects(()=>accounts.authenticate(a.token),401);}finally{accounts.close();}
});
test('child starts without adult presence, latest round replaces previous result and cooking survives replay',async()=>{
 const accounts=new AccountStore();
 try{
 const a=await accounts.register(credentials),store=new FamilyStore(accounts);
 let state=store.action(a.account.id,'child',{type:'START_GAME',input:'demo'});
 rejects(()=>store.action(a.account.id,'adult',{type:'START_GAME',input:'demo'}),403);
 const firstRound=state.game.roundId;const evidence=freshEvidence();evidence.corn={offered:3,caught:2};
 state=store.action(a.account.id,'child',{type:'GAME_RESULT',roundId:firstRound,evidence});assert.deepEqual(state.selected,['corn']);
 state=store.action(a.account.id,'adult',{type:'CHOOSE_RECIPE',recipeId:'rice'});
 store.action(a.account.id,'adult',{type:'ACTIVATE_STEP',stepId:'rice-1'});
 state=store.action(a.account.id,'adult',{type:'COMPLETE_STEP',stepId:'rice-1'});
 const progress=structuredClone(state.cooking);
 state=store.action(a.account.id,'child',{type:'START_GAME',input:'camera'});
 assert.equal(state.stage,'cooking');assert.equal(state.selectedRecipeId,'rice');assert.deepEqual(state.cooking,progress);assert.equal(state.game.evidence.corn.caught,2);
 rejects(()=>store.action(a.account.id,'child',{type:'GAME_RESULT',roundId:firstRound,evidence}),409);
 const latest=freshEvidence();latest.tomato={offered:2,caught:1};
 state=store.action(a.account.id,'child',{type:'GAME_RESULT',roundId:state.game.roundId,evidence:latest});
 assert.deepEqual(state.selected,['tomato']);assert.equal(state.game.evidence.corn.caught,0);assert.deepEqual(state.cooking,progress);assert.equal(state.selectedRecipeId,'rice');
 assert.deepEqual(store.action(a.account.id,'child',{type:'GAME_RESULT',roundId:state.game.roundId,evidence:latest}),state);
 rejects(()=>store.action(a.account.id,'child',{type:'CHOOSE_RECIPE',recipeId:'rice'}),403);
 }finally{accounts.close();}
});
test('SQLite restores account, session, latest result and cooking after restart; other households are isolated',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cookgame-accounts-'));const file=join(dir,'cookgame.sqlite');let accounts=new AccountStore(file);
 try{
 const a=await accounts.register(credentials),b=await accounts.register({...credentials,username:'family_other'});let family=new FamilyStore(accounts);
 const active=family.action(a.account.id,'child',{type:'START_GAME',input:'demo'});const evidence=freshEvidence();evidence.corn={offered:1,caught:1};
 family.action(a.account.id,'child',{type:'GAME_RESULT',roundId:active.game.roundId,evidence});family.action(a.account.id,'adult',{type:'CHOOSE_RECIPE',recipeId:'rice'});
 family.action(a.account.id,'adult',{type:'ACTIVATE_STEP',stepId:'rice-1'});const before=family.get(a.account.id);
 assert.equal(family.get(b.account.id).latestResultAt,null);
 accounts.close();accounts=new AccountStore(file);family=new FamilyStore(accounts);
 assert.equal(accounts.authenticate(a.token).username,credentials.username);assert.deepEqual(family.get(a.account.id),before);
 assert.equal((await readFile(file)).includes(Buffer.from(credentials.password)),false);
 }finally{accounts.close();await rm(dir,{recursive:true,force:true});}
});
test('authenticated HTTP API, HttpOnly cookies, CSRF and household isolation; six-digit entry removed',async()=>{
 const app=await createSessionServer({port:0});await app.listen();const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
 const call=(path:string,method='GET',body?:unknown,cookie='',role='adult',origin=base)=>fetch(base+path,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,'X-Cookgame-Role':role},body:body===undefined?undefined:JSON.stringify(body)});
 try{
 assert.equal((await call('/api/family')).status,401);
 assert.equal((await call('/api/auth/register','POST',credentials,'','adult','https://evil.example')).status,403);
 assert.equal((await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)})).status,403);
 const a=await call('/api/auth/register','POST',credentials);assert.equal(a.status,201);const cookie=a.headers.get('set-cookie')!;assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.equal((await a.text()).includes(credentials.password),false);
 const auth=cookie.split(';')[0];assert.equal((await call('/api/auth/me','GET',undefined,auth)).status,200);
 assert.equal((await call('/api/join','POST',{code:'123456'},auth)).status,404);
 assert.equal((await call('/api/rooms','POST',{excluded:[],allergens:[]},auth)).status,404);
 const start=await call('/api/actions','POST',{type:'START_GAME',input:'demo'},auth,'child');assert.equal(start.status,200);
 const state=(await start.json()).state;assert.equal((await call('/api/actions','POST',{type:'GAME_STATUS',roundId:state.game.roundId,status:'playing'},auth,'adult')).status,403);
 assert.equal((await call('/api/actions','POST',{type:'GAME_RESULT',roundId:state.game.roundId,evidence:freshEvidence(),landmarks:[]},auth,'child')).status,400);
 const b=await call('/api/auth/register','POST',{...credentials,username:'other_family'});const other=b.headers.get('set-cookie')!.split(';')[0];
 assert.equal((await (await call('/api/family','GET',undefined,other)).json()).state.game.status,'idle');
 assert.equal((await call('/api/actions','POST',{type:'GAME_RESULT',roundId:state.game.roundId,evidence:freshEvidence()},other,'child')).status,409);
 assert.equal((await call('/api/auth/logout','POST',{},auth)).status,200);assert.equal((await call('/api/family','GET',undefined,auth)).status,401);
 }finally{app.server.closeAllConnections();await new Promise<void>(resolve=>app.server.close(()=>resolve()));}
});
