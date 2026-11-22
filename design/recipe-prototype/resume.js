import { foods, recipes, recipeVersion } from './recipes.js';
import { questionnaireVersion, restoreSurvey } from './survey.js';
import { offer, restoreMarket } from './market.js';
import { inventoryVersion } from './inventory.js';
import { restoreParticipant, participantComplete } from './participant.js';

const schemaVersion = 1;
const versions = () => ({ schemaVersion, questionnaireVersion, recipeVersion, conceptVersion: offer.version, inventoryVersion });
export const resumeStorageKey = demo => `cookgame-resume-v1${demo ? '-demo' : ''}`;
const validId = value => typeof value === 'string' && /^(?:[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}|[0-9a-f-]{36})$/i.test(value);
const validKey = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const stages = ['intro','camera','game','result','handoff','recipes','recipe','child-task','child-survey','parent-survey'];
// Only form/progress data is retained. Camera streams, frames and landmarks never enter this snapshot.
const stateKeys = ['started','returnPortrait','caught','evidence','gameFinished','gameInput','key','sequence','receipt','finalPacket','score','recipeId','showAll','stage','sessionId','createdAt','participant','market','surveys'];

export function writeResume(state, demo, storage) {
  try {
    storage ??= localStorage;
    if (state.receipt) { clearResume(demo, state.key, storage); return true; }
    if (!state.started || !participantComplete(state.participant)) return true;
    const progress = Object.fromEntries(stateKeys.map(key => [key, state[key]]));
    storage.setItem(resumeStorageKey(demo), JSON.stringify({ ...versions(), demo, state: progress }));
    return true;
  } catch { return false; }
}

export function clearResume(demo, key, storage) {
  try {
    storage ??= localStorage;
    if (key && JSON.parse(storage.getItem(resumeStorageKey(demo)) || 'null')?.state?.key !== key) return;
    storage.removeItem(resumeStorageKey(demo));
  } catch { /* Storage can be unavailable; the current visit remains usable. */ }
}

export function readResume(demo, freshState, storage) {
  try {
    storage ??= localStorage;
    const saved = JSON.parse(storage.getItem(resumeStorageKey(demo)) || 'null');
    if (!saved || saved.demo !== demo || Object.entries(versions()).some(([key, value]) => saved[key] !== value)) return null;
    const s = saved.state;
    if (!s || !s.started || s.receipt || !validId(s.sessionId) || !validKey(s.key) || !Number.isSafeInteger(s.sequence) || s.sequence < 0 || !stages.includes(s.stage)) return null;
    const participant = restoreParticipant(s.participant);
    if (!participantComplete(participant)) return null;
    const caught = Array.isArray(s.caught) ? s.caught.filter(id => foods.some(food => food.id === id)).slice(0, 100) : [];
    const evidence = {};
    for (const { id } of foods) {
      const value = s.evidence?.[id];
      if (value && Number.isSafeInteger(value.offered) && Number.isSafeInteger(value.caught) && value.offered >= value.caught && value.caught >= 0) evidence[id] = { offered: value.offered, caught: value.caught };
    }
    const state = { ...freshState(), started: true, sessionId: s.sessionId, key: s.key, sequence: s.sequence,
      stage: s.stage, participant, caught, evidence, gameFinished: s.gameFinished === true, gameInput: s.gameInput === 'camera' ? 'camera' : 'demo',
      returnPortrait: s.returnPortrait === true, showAll: s.showAll === true, score: Number.isSafeInteger(s.score) && s.score >= 0 ? s.score : 0,
      recipeId: recipes.some(recipe => recipe.id === s.recipeId) ? s.recipeId : null,
      createdAt: typeof s.createdAt === 'string' ? s.createdAt : new Date().toISOString(),
      market: restoreMarket(s.market), surveys: { child: restoreSurvey('child', s.surveys?.child), parent: restoreSurvey('parent', s.surveys?.parent) } };
    if (s.finalPacket) {
      const p = s.finalPacket;
      if (p.key !== state.key || p.id !== state.sessionId || p.payload?.complete !== true || p.payload.stage !== 'done' || p.payload.sequence !== state.sequence || p.payload.demo !== demo || p.payload.questionnaireVersion !== questionnaireVersion || p.payload.recipeVersion !== recipeVersion || p.payload.conceptVersion !== offer.version) return null;
      state.finalPacket = p;
    }
    return state;
  } catch { return null; }
}
