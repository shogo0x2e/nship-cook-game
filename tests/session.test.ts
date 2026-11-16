import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionError, SessionStore } from '../server/session-store.ts';
import { createSessionServer } from '../server/server.ts';
import { freshEvidence } from '../src/game.ts';
import { ingredients, recipes } from '../src/content.ts';
import { cookingPlans } from '../src/shared.ts';
const settings={excluded:[],allergens:[]};
const rejects=(fn:()=>unknown,status:number)=>assert.throws(fn,(error:unknown)=>error instanceof SessionError&&error.status===status);
function pair(store=new SessionStore(),config:unknown=settings){const adult=store.create(config);const child=store.join({code:adult.code});const act=(role:'adult'|'child',action:unknown)=>store.action(adult.roomId,role==='adult'?adult.token:child.token,action).state;return{store,adult,child,act};}
function reviewed(config:unknown=settings){const p=pair(new SessionStore(),config);const game=p.act('adult',{type:'START_GAME',input:'demo'});const evidence=freshEvidence();evidence.corn={offered:3,caught:2};p.act('child',{type:'GAME_RESULT',roundId:game.game.roundId,evidence});return p;}
test('room pairing is single-use and tokens are scoped to roles and rooms',()=>{
 const p=pair();assert.match(p.adult.code,/^\d{6}$/);assert.notEqual(p.adult.token,p.child.token);assert.equal(p.child.state.childJoined,true);rejects(()=>p.store.join({code:p.adult.code}),409);rejects(()=>p.store.get(p.adult.roomId,'a'.repeat(64)),401);rejects(()=>p.store.get(p.adult.roomId,p.store.create(settings).token),401);rejects(()=>p.store.remove(p.adult.roomId,p.child.token),403);p.store.remove(p.adult.roomId,p.adult.token);rejects(()=>p.store.get(p.adult.roomId,p.adult.token),404);
});
test('strict schemas reject camera data, unknown fields, missing keys and invalid settings',()=>{
 const store=new SessionStore();rejects(()=>store.create({...settings,video:'data'}),400);rejects(()=>store.create({excluded:[]}),400);rejects(()=>store.create({excluded:['bad'],allergens:[]}),400);rejects(()=>store.create({excluded:ingredients.map(i=>i.id),allergens:[]}),400);rejects(()=>store.create({excluded:[],allergens:['unrecognized']}),400);
 const p=pair();rejects(()=>p.act('adult',{type:'START_GAME',input:'demo',landmarks:[]}),400);rejects(()=>p.act('adult',{type:'START_GAME',input:'remote'}),400);rejects(()=>p.act('adult',{type:'__proto__'}),400);
});
test('every action enforces its role and pairing before game start',()=>{
 const store=new SessionStore();const a=store.create(settings);rejects(()=>store.action(a.roomId,a.token,{type:'START_GAME',input:'demo'}),409);
 const p=pair();for(const action of [{type:'START_GAME',input:'demo'},{type:'CANCEL_GAME'},{type:'SET_SELECTED',selected:[]},{type:'CHOOSE_RECIPE',recipeId:'rice'},{type:'ACTIVATE_STEP',stepId:'rice-1'},{type:'COMPLETE_STEP',stepId:'rice-1'},{type:'BACK_TO_REVIEW'}])rejects(()=>p.act('child',action),403);
 for(const action of [{type:'GAME_STATUS',roundId:'x',status:'playing'},{type:'GAME_RESULT',roundId:'x',evidence:freshEvidence()},{type:'CHILD_DONE',stepId:'rice-1'}])rejects(()=>p.act('adult',action),403);
});
test('round lifecycle rejects stale or cancelled results and final result is idempotent',()=>{
 const p=pair();const ready=p.act('adult',{type:'START_GAME',input:'demo'});rejects(()=>p.act('adult',{type:'START_GAME',input:'demo'}),409);
 p.act('child',{type:'GAME_STATUS',roundId:ready.game.roundId,status:'playing'});p.act('child',{type:'GAME_STATUS',roundId:ready.game.roundId,status:'paused'});p.act('adult',{type:'CANCEL_GAME'});rejects(()=>p.act('child',{type:'GAME_RESULT',roundId:ready.game.roundId,evidence:freshEvidence()}),409);
 const next=p.act('adult',{type:'START_GAME',input:'camera'});rejects(()=>p.act('child',{type:'GAME_RESULT',roundId:ready.game.roundId,evidence:freshEvidence()}),409);
 const evidence=freshEvidence();evidence.tomato={offered:2,caught:1};const result=p.act('child',{type:'GAME_RESULT',roundId:next.game.roundId,evidence});assert.equal(result.stage,'review');assert.deepEqual(result.selected,['tomato']);
 const duplicate=p.act('child',{type:'GAME_RESULT',roundId:next.game.roundId,evidence:freshEvidence()});assert.deepEqual(duplicate,result);p.act('adult',{type:'SET_SELECTED',selected:['corn']});const late=p.act('child',{type:'GAME_RESULT',roundId:next.game.roundId,evidence});assert.deepEqual(late.selected,['corn']);
});
test('evidence counts are bounded and exclusions apply to result, selection and recipe',()=>{
 const p=pair(new SessionStore(),{excluded:['tomato'],allergens:['乳']});const game=p.act('adult',{type:'START_GAME',input:'demo'});const action=(evidence:unknown)=>p.act('child',{type:'GAME_RESULT',roundId:game.game.roundId,evidence});
 const invalid=freshEvidence();invalid.tomato={offered:1,caught:0};rejects(()=>action(invalid),400);invalid.tomato={offered:0,caught:0};invalid.egg={offered:1,caught:2};rejects(()=>action(invalid),400);invalid.egg={offered:1.5,caught:1};rejects(()=>action(invalid),400);invalid.egg={offered:65,caught:1};rejects(()=>action(invalid),400);rejects(()=>action({...freshEvidence(),image:'data'}),400);
 action(freshEvidence());rejects(()=>p.act('adult',{type:'SET_SELECTED',selected:['tomato']}),400);rejects(()=>p.act('adult',{type:'SET_SELECTED',selected:['cheese']}),400);rejects(()=>p.act('adult',{type:'CHOOSE_RECIPE',recipeId:'omelet'}),400);rejects(()=>p.act('adult',{type:'CHOOSE_RECIPE',recipeId:'soup'}),400);p.act('adult',{type:'CHOOSE_RECIPE',recipeId:'rice'});
});
test('cooking prerequisites, active-step ownership and parent confirmation are mandatory',()=>{
 const p=reviewed();p.act('adult',{type:'CHOOSE_RECIPE',recipeId:'rice'});rejects(()=>p.act('adult',{type:'START_GAME',input:'demo'}),409);rejects(()=>p.act('adult',{type:'ACTIVATE_STEP',stepId:'rice-2'}),409);rejects(()=>p.act('child',{type:'CHILD_DONE',stepId:'rice-2'}),409);
 for(const step of cookingPlans.rice){
  p.act('adult',{type:'ACTIVATE_STEP',stepId:step.id});
  if(step.role==='child'){rejects(()=>p.act('adult',{type:'COMPLETE_STEP',stepId:step.id}),409);const report=p.act('child',{type:'CHILD_DONE',stepId:step.id});assert.equal(report.cooking.childReportStepId,step.id);assert.equal(report.cooking.completedStepIds.includes(step.id),false);assert.deepEqual(p.act('child',{type:'CHILD_DONE',stepId:step.id}),report);}
  else rejects(()=>p.act('child',{type:'CHILD_DONE',stepId:step.id}),403);
  p.act('adult',{type:'COMPLETE_STEP',stepId:step.id});rejects(()=>p.act('adult',{type:'COMPLETE_STEP',stepId:step.id}),409);
 }
 const complete=p.store.get(p.adult.roomId,p.adult.token).state;assert.equal(complete.stage,'complete');assert.equal(complete.cooking.activeStepId,null);rejects(()=>p.act('adult',{type:'START_GAME',input:'demo'}),409);assert.equal(p.act('adult',{type:'BACK_TO_REVIEW'}).stage,'review');
});
test('TTL, capacity and returned state isolation',()=>{
 let now=100;const store=new SessionStore({now:()=>now,ttlMs:100,maxRooms:1});const a=store.create(settings);a.state.excluded.push('tomato');assert.deepEqual(store.get(a.roomId,a.token).state.excluded,[]);rejects(()=>store.create(settings),503);now=200;rejects(()=>store.get(a.roomId,a.token),404);assert.equal(store.create(settings).state.stage,'lobby');
});
test('pairing and successful actions renew inactivity TTL, polling alone does not',()=>{
 let now=0;const store=new SessionStore({now:()=>now,ttlMs:100});const adult=store.create(settings);
 now=90;store.join({code:adult.code});now=150;store.action(adult.roomId,adult.token,{type:'START_GAME',input:'demo'});
 now=249;assert.equal(store.get(adult.roomId,adult.token).state.stage,'game');
 now=250;rejects(()=>store.get(adult.roomId,adult.token),404);
});
test('every recipe has ordered adult/child plans and valid prior dependencies',()=>{
 for(const recipe of recipes){const steps=cookingPlans[recipe.id];assert.ok(steps?.length);assert.equal(steps[0].role,'adult');const seen=new Set<string>();for(const step of steps){assert.ok(!seen.has(step.id));assert.ok(step.requires.every(id=>seen.has(id)));seen.add(step.id);}assert.ok(steps.some(s=>s.role==='child'));}
});
test('HTTP API blocks cross-origin, missing auth, extra fields, oversized data and join abuse',async()=>{
 const app=await createSessionServer({port:0});await app.listen();const address=app.server.address() as {port:number};const base=`http://127.0.0.1:${address.port}`;
 const request=(path:string,method='GET',data?:unknown,headers:Record<string,string>={})=>fetch(base+path,{method,headers:{...(method!=='GET'?{Origin:base,'Content-Type':'application/json'}:{}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
 try{
  assert.equal((await request('/api/rooms','POST',settings,{Origin:'https://evil.example'})).status,403);
  assert.equal((await fetch(base+'/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)})).status,403);
  assert.equal((await request('/api/rooms','POST',{...settings,video:'x'})).status,400);
  assert.equal((await request('/api/rooms','POST',{payload:'x'.repeat(17000)})).status,413);
  const created=await request('/api/rooms','POST',settings);assert.equal(created.status,201);assert.match(created.headers.get('Content-Security-Policy')??'',/connect-src 'self'/);assert.equal(created.headers.get('Permissions-Policy'),'camera=(self), microphone=(), geolocation=()');
  const adult=await created.json() as {roomId:string;token:string;code:string};assert.equal((await request(`/api/rooms/${adult.roomId}`)).status,401);
  const state=await request(`/api/rooms/${adult.roomId}`,'GET',undefined,{Authorization:`Bearer ${adult.token}`});assert.equal(state.status,200);assert.equal('token' in await state.json(),false);
  assert.equal((await request('/api/join','POST',{code:adult.code})).status,200);
  for(let i=0;i<9;i++)await request('/api/join','POST',{code:'invalid'});assert.equal((await request('/api/join','POST',{code:'invalid'})).status,429);
  assert.equal((await request(`/api/rooms/${adult.roomId}`,'DELETE',undefined,{Authorization:`Bearer ${adult.token}`})).status,204);
 }finally{app.server.closeAllConnections();await new Promise<void>((resolve,reject)=>app.server.close(error=>error?reject(error):resolve()));}
});
