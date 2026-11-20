import { randomUUID } from 'node:crypto';
import { ingredients } from '../src/content.ts';
import { freshEvidence, hintIds } from '../src/game.ts';
import type { FamilyState, Role, RoomAction } from '../src/shared.ts';
import { AccountStore } from './account-store.ts';
import { applyAction, SessionError, strictObject, validateSettings, validateEvidence } from './session-store.ts';
import { challengeScore, comparisonKey, freshChallengeProgress, validateChallengeResult, validateDailyFeedback } from '../src/challenge.ts';

export class FamilyStore {
  private accounts: AccountStore;
  private now: () => number;
  constructor(accounts: AccountStore, now: () => number = Date.now) {this.accounts=accounts;this.now=now;}
  get(accountId: string): FamilyState {
    const row = this.accounts.db.prepare('SELECT state FROM families WHERE account_id=?').get(accountId) as { state: string } | undefined;
    if (row) return JSON.parse(row.state) as FamilyState;
    const state: FamilyState = { revision: 0, stage: 'lobby', excluded: [], allergens: [], childJoined: true,
      game: { roundId: '', status: 'idle', input: 'camera', elapsed: 0, evidence: freshEvidence() },
      selected: [], selectedRecipeId: null, cooking: { activeStepId: null, completedStepIds: [], childReportStepId: null }, latestResultAt: null };
    this.save(accountId, state); return state;
  }
  private save(accountId: string, state: FamilyState) { this.accounts.db.prepare('INSERT INTO families VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET state=excluded.state').run(accountId, JSON.stringify(state)); }
  action(accountId: string, role: Role, value: unknown): FamilyState {
    const current = this.get(accountId);
    const state = structuredClone(current);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SessionError(400, 'Invalid action');
    const type = (value as { type?: unknown }).type;
    if (type === 'SET_SETTINGS') {
      if (role !== 'adult') throw new SessionError(403, 'Role not allowed');
      const a = strictObject(value, ['type', 'excluded', 'allergens']);
      if (state.stage === 'cooking' || ['ready','playing','paused'].includes(state.game.status)) throw new SessionError(409, 'Finish current activity first');
      const settings = validateSettings({ excluded: a.excluded, allergens: a.allergens });
      Object.assign(state, settings);
      state.selected = state.selected.filter(id => !settings.excluded.includes(id) && !ingredients.find(i => i.id === id)!.allergens.some(a => settings.allergens.includes(a)));
    } else if (type === 'START_GAME') {
      if (role !== 'child') throw new SessionError(403, 'Role not allowed');
      const a = strictObject(value, Object.hasOwn(value,'variant')?['type','input','variant']:['type','input']);
      if (a.input !== 'camera' && a.input !== 'demo') throw new SessionError(400, 'Invalid input mode');
      if (a.variant !== undefined && a.variant !== 'simple' && a.variant !== 'challenge') throw new SessionError(400, 'Invalid game variant');
      if (['ready','playing','paused'].includes(state.game.status)) throw new SessionError(409, 'Round already active');
      state.game = { ...state.game, roundId: randomUUID(), status: 'ready', input: a.input, variant: a.variant==='challenge'?'challenge':'simple', elapsed: 0 };
    } else if (type === 'GAME_STATUS' || type === 'GAME_RESULT') {
      if (role !== 'child') throw new SessionError(403, 'Role not allowed');
      const a = strictObject(value, type === 'GAME_STATUS' ? ['type','roundId','status'] : Object.hasOwn(value,'challenge')?['type','roundId','evidence','challenge']:['type','roundId','evidence']);
      if (a.roundId !== state.game.roundId || !state.game.roundId) throw new SessionError(409, 'Stale round');
      if (type === 'GAME_RESULT') {
        const evidence = validateEvidence(a.evidence, state);
        if (state.game.status === 'finished') return current;
        if (state.game.status === 'idle') throw new SessionError(409, 'Round cancelled');
        if(state.game.variant==='challenge'){
          let result;try{result=validateChallengeResult(a.challenge,Object.values(evidence).reduce((n,v)=>n+v.caught,0));}catch{throw new SessionError(400,'Invalid challenge result');}
          const progress=state.challenge??freshChallengeProgress();
          const allowed=ingredients.filter(i=>!state.excluded.includes(i.id)&&!i.allergens.some(a=>state.allergens.includes(a))).map(i=>i.id);
          const key=comparisonKey(state.game.input,allowed),score=challengeScore(result.catches),previousBest=progress.best[key]??0;
          progress.runs.push({activeMs:result.activeMs,completed:result.completed,caught:result.catches.length,roundId:state.game.roundId,input:state.game.input,comparisonKey:key,finishedAt:this.now(),score,previousBest});
          progress.runs=progress.runs.slice(-100);
          if(result.completed)progress.best[key]=Math.max(previousBest,score);
          state.challenge=progress;state.game.elapsed=result.activeMs/1000;
        }else if(a.challenge!==undefined)throw new SessionError(400,'Challenge result is not allowed');
        state.game.evidence = evidence; state.game.status = 'finished'; state.latestResultAt = this.now();
        state.selected = hintIds(evidence);
        if (state.stage === 'lobby') state.stage = 'review';
      } else {
        if (a.status !== 'playing' && a.status !== 'paused') throw new SessionError(400, 'Invalid game status');
        if (!['ready','playing','paused'].includes(state.game.status)) throw new SessionError(409, 'Round not active');
        if (state.game.status === a.status) return current;
        state.game.status = a.status;
      }
    } else if(type==='CHALLENGE_FEEDBACK'){
      const a=strictObject(value,['type','roundId','feedback']);
      const run=state.challenge?.runs.find(run=>run.roundId===a.roundId);
      if(!run)throw new SessionError(400,'Unknown challenge round');
      try{run.feedback=validateDailyFeedback(a.feedback);}catch{throw new SessionError(400,'Invalid feedback');}
    } else if (type === 'CANCEL_GAME') {
      strictObject(value, ['type']);
      if (!['ready','playing','paused'].includes(state.game.status)) throw new SessionError(409, 'Round not active');
      state.game.status = state.latestResultAt === null ? 'idle' : 'finished'; state.game.roundId = '';
    } else {
      // Menu/cooking transitions keep the independent game and its latest result intact.
      const next = applyAction(state, role, value as RoomAction, '');
      this.save(accountId, next as FamilyState); return next as FamilyState;
    }
    state.revision++; this.save(accountId, state); return state;
  }
}
