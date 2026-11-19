import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {AccountStore} from '../server/account-store.ts';
import {ExperienceStore} from '../server/experience-store.ts';
import {questionnaireVersion,conceptVersion,recipeVersion,type ExperiencePayload} from '../src/experience-protocol.ts';

test('offline deliveries with colliding short IDs remain separate, retry under a new ID, and acknowledge their own private key',async()=>{
 const accounts=new AccountStore(),store=new ExperienceStore(accounts.db),values=new Map<string,string>();
 const before={window:Object.getOwnPropertyDescriptor(globalThis,'window'),localStorage:Object.getOwnPropertyDescriptor(globalThis,'localStorage'),fetch:globalThis.fetch};
 Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener(){}}});
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}});
 let offline=true;
 globalThis.fetch=async(input,options)=>{
  if(offline)throw new TypeError('offline');
  const id=String(input).split('/').at(-1)!,key=(options?.headers as Record<string,string>).Authorization.slice(7);
  try{return Response.json(store.save(id,key,JSON.parse(String(options?.body))));}
  catch(error){return Response.json({error:(error as Error).message},{status:(error as {status:number}).status});}
 };
 try{
  const {saveExperience,flushOutbox,onSaved,onIdChanged}=await import('../src/experience-sync.ts');
  const deviceId=randomUUID();
  const payload:ExperiencePayload={questionnaireVersion,conceptVersion,recipeVersion,deviceId,sequence:1,age:9,demo:true,stage:'done',selectedIngredients:['rice'],evidence:{rice:{offered:1,caught:1}},recipeId:'curry',child:{answers:{game_fun:5,help_intent:5,daily_feasibility:5},comment:''},parent:{answers:{task_feasibility:5,continued_use:5,meal_decision_ease:5,child_initiative:5},comment:'',gameplayStatus:'smooth'},serviceFeedback:{interestedFeatures:['none'],comment:''},payment:{kind:'free',maxMonthlyYen:0},complete:true};
  const a={id:'7K3M9R',key:randomBytes(32).toString('hex'),payload},b={id:a.id,key:randomBytes(32).toString('hex'),payload:{...payload,child:{...payload.child,comment:'another experience'}}};
  const saved:{id:string;key:string}[]=[],changes:{id:string;key:string}[]=[];
  onSaved((ack,key)=>saved.push({id:ack.id,key}));onIdChanged(change=>changes.push(change));
  await Promise.allSettled([saveExperience(a),saveExperience(b)]);
  assert.equal(Object.keys(JSON.parse(values.get('cookgame-anonymous-outbox-v1')!)).length,2);
  offline=false;await flushOutbox();
  assert.equal(changes.length,1);assert.equal(changes[0].key,b.key);assert.notEqual(changes[0].id,a.id);assert.match(changes[0].id,/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
  assert.deepEqual(saved,[{id:a.id,key:a.key},{id:changes[0].id,key:b.key}]);
  assert.deepEqual(store.get(a.id,a.key).payload,payload);assert.deepEqual(store.get(changes[0].id,b.key).payload,b.payload);
  assert.equal(Object.keys(JSON.parse(values.get('cookgame-anonymous-outbox-v1')!)).length,0);
  assert.equal((await saveExperience(b)).receipt,changes[0].id);
  assert.equal(accounts.db.prepare('SELECT COUNT(*) n FROM experience_responses').get()?.n,2);
 }finally{
  globalThis.fetch=before.fetch;
  for(const key of ['window','localStorage'] as const){if(before[key])Object.defineProperty(globalThis,key,before[key]!);else Reflect.deleteProperty(globalThis,key);}
  accounts.close();
 }
});
