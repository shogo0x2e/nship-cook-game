import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catchPoints, challengeScore, comparisonKey, validateChallengeResult, validateDailyFeedback } from '../src/challenge.ts';
import { freshEvidence } from '../src/game.ts';
import { AccountStore } from '../server/account-store.ts';
import { FamilyStore } from '../server/family-store.ts';

test('challenge rewards reaction speed and completed plates; waiting or passing has no score penalty',()=>{
  assert.equal(catchPoints(0),200);assert.equal(catchPoints(3000),100);assert.equal(catchPoints(6000),100);
  const fast=[{atMs:1000,reactionMs:400},{atMs:3000,reactionMs:500},{atMs:5000,reactionMs:600}];
  const slow=fast.map(c=>({...c,reactionMs:1000}));
  assert.ok(challengeScore(fast)>challengeScore(slow));
  assert.equal(challengeScore(fast),fast.reduce((s,c)=>s+catchPoints(c.reactionMs),0)+150);
  assert.equal(challengeScore(fast.map(c=>({...c,atMs:c.atMs+20000}))),challengeScore(fast));
  assert.notEqual(comparisonKey('camera',['tomato','egg']),comparisonKey('demo',['tomato','egg']));
  assert.notEqual(comparisonKey('camera',['tomato']),comparisonKey('camera',['tomato','egg']));
  assert.equal(comparisonKey('demo',['egg','tomato']),comparisonKey('demo',['tomato','egg']));
});
test('challenge results require consistent catch counts, bounded active time and ordered timestamps',()=>{
  const good={activeMs:45000,completed:true,catches:[{atMs:2000,reactionMs:1000}]};
  assert.deepEqual(validateChallengeResult(good,1),good);
  for(const bad of [{...good,score:999999},{...good,activeMs:44000},{...good,activeMs:45001},{...good,catches:[]},{...good,catches:[{atMs:45001,reactionMs:0}]},{...good,catches:[{atMs:2000,reactionMs:2001}]}])assert.throws(()=>validateChallengeResult(bad,1));
  assert.throws(()=>validateChallengeResult({...good,catches:[{atMs:3000,reactionMs:0},{atMs:2000,reactionMs:0}]},2));
  assert.deepEqual(validateDailyFeedback({ageGroup:'middle',frequency:'unsure',reason:'  時間がない  ',fun:null}),{ageGroup:'middle',frequency:'unsure',reason:'時間がない',fun:null});
  assert.throws(()=>validateDailyFeedback({ageGroup:'middle',frequency:'daily',reason:'',fun:6}));
});
test('challenge bests and optional daily-use feedback persist; retries, early exits and other input modes do not overwrite records',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'catch-challenge-')),file=join(dir,'test.sqlite');
  let accounts=new AccountStore(file);
  try{
    const {account}=await accounts.register({username:'challenge_test',password:'poc4'});
    let family=new FamilyStore(accounts,()=>1795000000000);
    const evidence=freshEvidence();evidence.tomato={offered:3,caught:3};evidence.carrot={offered:3,caught:0};
    let state=family.action(account.id,'child',{type:'START_GAME',input:'demo',variant:'challenge'});
    const roundId=state.game.roundId;
    const result={activeMs:45000,completed:true,catches:[{atMs:1000,reactionMs:700},{atMs:3000,reactionMs:800},{atMs:5000,reactionMs:900}]};
    assert.throws(()=>family.action(account.id,'child',{type:'GAME_RESULT',roundId,evidence}),/Invalid challenge/);
    state=family.action(account.id,'child',{type:'GAME_RESULT',roundId,evidence,challenge:result});
    const run=state.challenge!.runs[0];assert.equal(run.score,challengeScore(result.catches));assert.equal(state.challenge!.best[run.comparisonKey],run.score);
    state=family.action(account.id,'child',{type:'GAME_RESULT',roundId,evidence,challenge:result});assert.equal(state.challenge!.runs.length,1);
    state=family.action(account.id,'child',{type:'CHALLENGE_FEEDBACK',roundId,feedback:{ageGroup:'upper',frequency:'weekly',reason:'夕食前なら使えそう',fun:4}});
    assert.equal(state.challenge!.runs[0].feedback!.frequency,'weekly');
    assert.throws(()=>family.action(account.id,'child',{type:'CHALLENGE_FEEDBACK',roundId:'other',feedback:{}}),/Unknown challenge/);
    accounts.close();accounts=new AccountStore(file);family=new FamilyStore(accounts);
    assert.deepEqual(family.get(account.id),state);
    state=family.action(account.id,'child',{type:'START_GAME',input:'demo',variant:'challenge'});
    state=family.action(account.id,'child',{type:'GAME_RESULT',roundId:state.game.roundId,evidence,challenge:{...result,activeMs:6000,completed:false,catches:result.catches.map(c=>({...c,reactionMs:0}))}});
    assert.equal(state.challenge!.best[run.comparisonKey],run.score,'early exit must not become a personal best');
    state=family.action(account.id,'child',{type:'START_GAME',input:'camera',variant:'challenge'});
    state=family.action(account.id,'child',{type:'GAME_RESULT',roundId:state.game.roundId,evidence,challenge:result});
    assert.equal(state.challenge!.runs.at(-1)!.previousBest,0,'camera and pointer records are independent');
    state=family.action(account.id,'child',{type:'START_GAME',input:'demo'});
    assert.equal(state.game.variant,'simple','old callers retain the preschool rules');
    assert.throws(()=>family.action(account.id,'child',{type:'GAME_RESULT',roundId:state.game.roundId,evidence,challenge:result}),/not allowed/);
    assert.throws(()=>family.action(account.id,'adult',{type:'START_GAME',input:'demo',variant:'challenge'}),/Role not allowed/);
  }finally{accounts.close();rmSync(dir,{recursive:true,force:true});}
});
