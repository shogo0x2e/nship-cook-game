import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Shared HTML view helpers are plain JavaScript.
import {readResume,writeResume,clearResume,resumeStorageKey} from '../design/recipe-prototype/resume.js';

const memory=()=>{const values=new Map<string,string>();return{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};};
const state=()=>({started:true,returnPortrait:false,caught:['rice'],evidence:{rice:{offered:1,caught:1}},gameFinished:true,gameInput:'demo',key:'a'.repeat(64),sequence:12,receipt:null,finalPacket:null,score:100,recipeId:'nikujaga',showAll:false,stage:'parent-survey',sessionId:'7K3M9R',createdAt:'2026-11-22T00:00:00.000Z',participant:{age:'16'},market:{step:'budget',budgetKind:'paid',maxMonthlyYen:'500',interestedFeatures:['game_recipe'],featureComment:'機能の感想',experienceCompletedAt:'2026-11-22T00:01:00.000Z',submittedAt:null},surveys:{child:{answers:{game_fun:6,help_intent:5},playFrequency:'daily',comment:'子の感想',submittedAt:'2026-11-22T00:01:00.000Z'},parent:{answers:{task_feasibility:5,continued_use:6,meal_preparation_ease:4,child_initiative:5},employmentStatus:'yes',gameplayStatus:'smooth',gameplayComment:'',comment:'親の感想',submittedAt:null}}});

test('unfinished progress retains credentials, answers and the exact parent substep without media',()=>{
 const storage=memory(),before=state();
 writeResume({...before,cameraFrame:'never persist this'},false,storage);
 const after=readResume(false,state,storage);
 assert.equal(after.sessionId,before.sessionId);assert.equal(after.key,before.key);assert.equal(after.sequence,before.sequence);
 assert.deepEqual(after.surveys.child.answers,before.surveys.child.answers);assert.deepEqual(after.surveys.parent.answers,before.surveys.parent.answers);
 assert.deepEqual(after.market,before.market);assert.equal(after.recipeId,'nikujaga');
 assert.ok(!storage.getItem(resumeStorageKey(false))!.includes('cameraFrame'));
 assert.equal(readResume(true,state,storage),null,'demo and ordinary progress are isolated');
});

test('completed, incompatible and damaged progress never restores as an unfinished answer',()=>{
 const storage=memory();writeResume(state(),false,storage);
 const saved=JSON.parse(storage.getItem(resumeStorageKey(false))!);
 storage.setItem(resumeStorageKey(false),JSON.stringify({...saved,questionnaireVersion:'retired'}));assert.equal(readResume(false,state,storage),null);
 storage.setItem(resumeStorageKey(false),JSON.stringify({...saved,state:{...saved.state,key:'bad'}}));assert.equal(readResume(false,state,storage),null);
 storage.setItem(resumeStorageKey(false),'{');assert.equal(readResume(false,state,storage),null);
 writeResume(state(),false,storage);writeResume({...state(),receipt:'7K3M9R'},false,storage);assert.equal(readResume(false,state,storage),null);
});

test('clearing an older completion cannot remove a newer experience; inaccessible storage is harmless',()=>{
 const storage=memory();writeResume(state(),false,storage);clearResume(false,'b'.repeat(64),storage);assert.ok(readResume(false,state,storage));
 clearResume(false,undefined,storage);assert.equal(readResume(false,state,storage),null);
 const blocked={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');},removeItem(){throw new Error('blocked');}};
 assert.equal(readResume(false,state,blocked),null);assert.equal(writeResume(state(),false,blocked),false);assert.doesNotThrow(()=>clearResume(false,undefined,blocked));
});
