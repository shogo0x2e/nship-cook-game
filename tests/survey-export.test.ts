import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createSessionServer} from '../server/server.ts';
import {questionnaireVersion,recipeVersion,conceptVersion,inventoryVersion,type ExperiencePayload} from '../src/experience-protocol.ts';

const payload=(demo=false,complete=true):ExperiencePayload=>({questionnaireVersion,recipeVersion,conceptVersion,inventoryVersion,deviceId:randomUUID(),sequence:1,age:9,demo,stage:complete?'done':'child-survey',selectedIngredients:['rice'],evidence:{rice:{offered:1,caught:1}},recipeId:'nikujaga',child:{answers:{game_fun:6,help_intent:5},comment:'=IMPORTXML("untrusted")',playFrequency:'never'},parent:{answers:{task_feasibility:5,continued_use:5,meal_preparation_ease:5,child_initiative:5},comment:'通常回答',gameplayStatus:'issues_completed',employmentStatus:'yes'},serviceFeedback:{interestedFeatures:['game_recipe'],comment:''},payment:complete?{kind:'paid',maxMonthlyYen:500}:null,complete});

test('operator snapshot is authenticated and read-only, includes only completed normal responses and never exports keys',async()=>{
 const key=randomBytes(32).toString('hex'),app=await createSessionServer({port:0,surveyExportToken:key});await app.listen();
 const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`,url=base+'/api/operator/survey-snapshot';
 try{
  const respondentKey=randomBytes(32).toString('hex');app.experiences.save('7K3M9R',respondentKey,payload());app.experiences.save('8K3M9R',respondentKey,payload(true));app.experiences.save('9K3M9R',respondentKey,payload(false,false));
  const headers={Authorization:'Bearer '+key};
  for(const supplied of [undefined,'Bearer wrong','Bearer '+respondentKey])assert.equal((await fetch(url,{headers:supplied?{Authorization:supplied}:{}})).status,401);
  assert.equal((await fetch(url+'?token='+key)).status,401);
  assert.equal((await fetch(url+'?includeDemo=1',{headers})).status,400);
  assert.equal((await fetch(url,{headers:{...headers,Origin:'https://untrusted.example'}})).status,403);
  assert.equal((await fetch(url,{method:'DELETE',headers:{...headers,Origin:base}})).status,405);
  const response=await fetch(url,{headers});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const result=await response.json();assert.equal(result.schemaVersion,1);assert.equal(result.scope,'completed-non-demo');assert.equal(result.count,1);assert.equal(result.rows[0][0],'7K3M9R');
  const row=Object.fromEntries(result.columns.map((column:{id:string},index:number)=>[column.id,result.rows[0][index]]));
  assert.equal(row.child_play_frequency,'never');assert.equal(row.daily_feasibility,'');assert.equal(row.max_monthly_yen,500);assert.equal(row.child_comment,'=IMPORTXML("untrusted")');
  assert.ok(!JSON.stringify(result).includes(respondentKey));assert.ok(!JSON.stringify(result).includes(key));assert.ok(!/token_hash|password_hash|salt/.test(JSON.stringify(result)));
  assert.equal(app.experiences.db.prepare('SELECT COUNT(*) n FROM experience_responses').get()?.n,3);
 }finally{app.server.closeAllConnections();await new Promise<void>(resolve=>app.server.close(()=>resolve()));}
 const disabled=await createSessionServer({port:0});await disabled.listen();
 try{assert.equal((await fetch(`http://127.0.0.1:${(disabled.server.address() as {port:number}).port}/api/operator/survey-snapshot`,{headers:{Authorization:'Bearer '+key}})).status,404);}
 finally{disabled.server.closeAllConnections();await new Promise<void>(resolve=>disabled.server.close(()=>resolve()));}
});

const gas=await readFile(new URL('../integrations/google-sheets/Code.gs',import.meta.url),'utf8');
test('GAS keeps existing data on HTTP/schema failures, releases the lock and treats formula-like answers as text',()=>{
 let released=0,sheetAccess=0;
 const context=vm.createContext({
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>released++})},
  PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'a'.repeat(64)})},
  UrlFetchApp:{fetch:()=>({getResponseCode:()=>401})},
  SpreadsheetApp:{getActiveSpreadsheet:()=>{sheetAccess++;throw new Error('must not modify');}},
 });vm.runInContext(gas,context);
 assert.throws(()=>vm.runInContext('syncCookgameResponses()',context),/HTTP 401/);assert.equal(sheetAccess,0);assert.equal(released,1);
 context.UrlFetchApp={fetch:()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({schemaVersion:9})})};
 assert.throws(()=>vm.runInContext('syncCookgameResponses()',context),/形式が不正/);assert.equal(sheetAccess,0);assert.equal(released,2);
 for(const value of ['=IMPORTXML("untrusted")','  =1+1','+cmd','@data','-cmd'])assert.equal(vm.runInContext('cookgameLiteral_('+JSON.stringify(value)+')',context),"'"+value);
 assert.equal(vm.runInContext('cookgameLiteral_(500)',context),500);assert.equal(vm.runInContext('cookgameLiteral_("自由記述")',context),'自由記述');
});

test('GAS setup replaces only its own trigger and uses the 30-minute interval',()=>{
 const deleted:string[]=[],created:number[]=[];
 const context=vm.createContext({ScriptApp:{getProjectTriggers:()=>['syncCookgameResponses','unrelated'].map(name=>({getHandlerFunction:()=>name})),deleteTrigger:(t:{getHandlerFunction:()=>string})=>deleted.push(t.getHandlerFunction()),newTrigger:(name:string)=>{assert.equal(name,'syncCookgameResponses');return{timeBased:()=>({everyMinutes:(n:number)=>({create:()=>created.push(n)})})};}},SpreadsheetApp:{getActiveSpreadsheet:()=>({toast:()=>{}})}});
 vm.runInContext(gas+'\nsyncCookgameResponses = function() {}; installCookgameSync();',context);
 assert.deepEqual(deleted,['syncCookgameResponses']);assert.deepEqual(created,[30]);
});
