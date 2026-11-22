import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {AccountStore} from '../server/account-store.ts';
import {ExperienceStore} from '../server/experience-store.ts';
import {createSessionServer} from '../server/server.ts';
import {questionnaireVersion,recipeVersion,conceptVersion,inventoryVersion,type ExperiencePayload} from '../src/experience-protocol.ts';
// @ts-expect-error Shared view helpers remain plain JavaScript.
import {restoreLegacyExperience,writeLegacyClaim,readLegacyClaim,dismissLegacyRecovery,legacyRecoveryDismissed} from '../design/recipe-prototype/legacy-recovery.js';

const key=()=>randomBytes(32).toString('hex');
const payload=(deviceId:string=randomUUID()):ExperiencePayload=>({questionnaireVersion,recipeVersion,conceptVersion,inventoryVersion,deviceId,sequence:21,age:16,demo:false,stage:'parent-survey',selectedIngredients:['rice'],evidence:{rice:{offered:1,caught:1}},recipeId:'nikujaga',child:{answers:{game_fun:6,help_intent:5},playFrequency:'daily',comment:'saved child answer'},parent:{answers:{},employmentStatus:null,gameplayStatus:null,comment:''},serviceFeedback:{interestedFeatures:[],comment:''},payment:null,gameInput:'demo',complete:false});
const status=(n:number)=>(error:unknown)=>Boolean(error&&typeof error==='object'&&'status' in error&&error.status===n);
test('only explicitly allowed unfinished ordinary answers can be claimed by their matching browser',()=>{
 const accounts=new AccountStore(),store=new ExperienceStore(accounts.db,['7K3M9R','8K3M9R']);
 try{
  const originalKey=key(),recoveryKey=key(),p=payload();store.save('7K3M9R',originalKey,p);
  store.save('9K3M9R',key(),payload(p.deviceId));store.save('8K3M9R',key(),{...payload(p.deviceId),demo:true});
  const before=accounts.db.prepare('SELECT payload_hash,sequence,updated_at,token_hash FROM experience_responses WHERE id=?').get('7K3M9R');
  assert.deepEqual(store.findLegacy(p.deviceId),{id:'7K3M9R'});assert.equal(store.findLegacy(randomUUID()),null);
  assert.throws(()=>store.claimLegacy('7K3M9R',randomUUID(),key()),status(404));
  assert.throws(()=>store.claimLegacy('9K3M9R',p.deviceId,key()),status(404));
  assert.throws(()=>store.claimLegacy('8K3M9R',p.deviceId,key()),status(404));
  const recovered=store.claimLegacy('7K3M9R',p.deviceId,recoveryKey);
  assert.equal(recovered.id,'7K3M9R');assert.equal(recovered.sequence,21);assert.deepEqual(recovered.payload,p);
  assert.deepEqual(accounts.db.prepare('SELECT payload_hash,sequence,updated_at,token_hash FROM experience_responses WHERE id=?').get('7K3M9R'),before,'lookup/claim do not edit the answer or invalidate an existing open page');
  assert.equal(store.findLegacy(p.deviceId),null,'browser ID cannot issue another credential after a claim');
  assert.throws(()=>store.claimLegacy('7K3M9R',p.deviceId,key()),status(404));
  assert.deepEqual(store.claimLegacy('7K3M9R',p.deviceId,recoveryKey),recovered,'lost responses retry with the same persisted credential');
  assert.equal(store.get('7K3M9R',originalKey).sequence,21);assert.equal(store.get('7K3M9R',recoveryKey).sequence,21);
  store.save('7K3M9R',recoveryKey,{...p,sequence:22,parent:{...p.parent,answers:{continued_use:5}}});
  assert.equal(store.get('7K3M9R',originalKey).sequence,22);
  assert.equal(accounts.db.prepare('SELECT count(*) n FROM experience_responses WHERE id=?').get('7K3M9R')?.n,1);
  assert.notEqual(accounts.db.prepare('SELECT token_hash FROM experience_recovery_keys').get()?.token_hash,recoveryKey);
  const disabled=new ExperienceStore(accounts.db);assert.equal(disabled.findLegacy(p.deviceId),null);assert.equal(disabled.get('7K3M9R',recoveryKey).sequence,22);
 }finally{accounts.close();}
});

test('completed answers are excluded and public recovery requires same-origin POST without query credentials',async()=>{
 const app=await createSessionServer({port:0,legacyRecoveryIds:['7K3M9R','8K3M9R']});await app.listen();
 try{
  const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`,p=payload(),secret=key();app.experiences.save('7K3M9R',key(),p);
  const post=(path:string,data:unknown,extra:Record<string,string>={})=>fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...extra},body:JSON.stringify(data)});
  assert.equal((await fetch(base+'/api/experience-recovery/lookup')).status,405);
  assert.equal((await post('/api/experience-recovery/lookup?deviceId=x',{deviceId:p.deviceId})).status,400);
  assert.equal((await post('/api/experience-recovery/lookup',{deviceId:p.deviceId},{Origin:'https://elsewhere.invalid'})).status,403);
  const found=await post('/api/experience-recovery/lookup',{deviceId:p.deviceId});assert.deepEqual(await found.json(),{candidate:{id:'7K3M9R'}});
  assert.equal((await post('/api/experience-recovery/claim',{deviceId:p.deviceId,id:'7K3M9R'})).status,401);
  const claimed=await post('/api/experience-recovery/claim',{deviceId:p.deviceId,id:'7K3M9R'},{Authorization:`Bearer ${secret}`});assert.equal(claimed.status,200);
  assert.equal((await claimed.json()).payload.child.answers.game_fun,6);
  const completed={...p,sequence:22,stage:'done',complete:true,child:p.child,parent:{...p.parent,employmentStatus:'yes',gameplayStatus:'smooth',answers:{task_feasibility:5,continued_use:5,meal_preparation_ease:5,child_initiative:5}},serviceFeedback:{interestedFeatures:['none'],comment:''},payment:{kind:'free',maxMonthlyYen:0}} as ExperiencePayload;
  app.experiences.save('7K3M9R',secret,completed);
  assert.equal(app.experiences.findLegacy(p.deviceId),null);assert.throws(()=>app.experiences.claimLegacy('7K3M9R',p.deviceId,secret),status(404));
  assert.equal(app.experiences.get('7K3M9R',secret).receipt,'7K3M9R');
 }finally{app.server.closeAllConnections();await new Promise<void>(resolve=>app.server.close(()=>resolve()));}
});

test('a legacy answer becomes a current resume snapshot; claim retries and declines persist separately',()=>{
 const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};
 const p=payload(),secret=key();assert.ok(writeLegacyClaim(p.deviceId,{id:'7K3M9R',key:secret},storage));
 assert.deepEqual(readLegacyClaim(p.deviceId,storage),{id:'7K3M9R',key:secret});assert.equal(readLegacyClaim(randomUUID(),storage),null);
 const record={id:'7K3M9R',sequence:21,complete:false,payload:p,createdAt:'2026-11-20T00:00:00Z',updatedAt:'2026-11-20T00:01:00Z'};
 const restored=restoreLegacyExperience(record,secret,()=>({receipt:null,finalPacket:null,returnPortrait:false,showAll:false}));
 assert.equal(restored.sessionId,record.id);assert.equal(restored.sequence,21);assert.equal(restored.market.step,'experience');assert.ok(restored.surveys.child.submittedAt);assert.deepEqual(restored.surveys.parent.answers,{});
 assert.throws(()=>restoreLegacyExperience({...record,complete:true},secret,()=>({})));
 dismissLegacyRecovery(p.deviceId,storage);assert.equal(readLegacyClaim(p.deviceId,storage),null);assert.equal(legacyRecoveryDismissed(p.deviceId,storage),true);
});
