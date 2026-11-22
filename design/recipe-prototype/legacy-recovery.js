import { questionnaireVersion, restoreSurvey, missingQuestions } from './survey.js';
import { recipeVersion } from './recipes.js';
import { offer, restoreMarket } from './market.js';
import { inventoryVersion } from './inventory.js';

const storageKey = 'cookgame-legacy-recovery-v1';
const versions = () => ({questionnaireVersion,recipeVersion,conceptVersion:offer.version,inventoryVersion});
function read(deviceId,storage) {
  try {
    storage ??= localStorage;
    const value=JSON.parse(storage.getItem(storageKey)||'null');
    return value?.deviceId===deviceId&&Object.entries(versions()).every(([key,v])=>value[key]===v)?value:null;
  } catch { return null; }
}
export const legacyRecoveryDismissed = (deviceId,storage) => read(deviceId,storage)?.dismissed===true;
export function readLegacyClaim(deviceId,storage) {
  const value=read(deviceId,storage);
  return value&&!value.dismissed&&/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(value.id)&&/^[a-f0-9]{64}$/.test(value.key)?{id:value.id,key:value.key}:null;
}
export function writeLegacyClaim(deviceId,claim,storage) {
  try { storage??=localStorage;storage.setItem(storageKey,JSON.stringify({...versions(),deviceId,...claim}));return true; } catch { return false; }
}
export function clearLegacyClaim(deviceId,storage) {
  try { storage??=localStorage;if(read(deviceId,storage)?.dismissed!==true)storage.removeItem(storageKey); } catch { /* Optional storage. */ }
}
export const dismissLegacyRecovery = (deviceId,storage) => writeLegacyClaim(deviceId,{dismissed:true},storage);

export function restoreLegacyExperience(record,key,freshState) {
  const p=record?.payload;
  if(!p||record.complete||p.complete||p.demo||!/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(record.id)||!/^[a-f0-9]{64}$/.test(key)||!Number.isSafeInteger(record.sequence)||Object.entries(versions()).some(([k,v])=>p[k]!==v))throw new Error('保存された回答の版を確認できませんでした。');
  const state=freshState(),child=restoreSurvey('child',p.child),parent=restoreSurvey('parent',p.parent);
  if(p.stage==='parent-survey'&&!missingQuestions('child',child).length)child.submittedAt=record.updatedAt;
  const parentDone=p.stage==='parent-survey'&&!missingQuestions('parent',parent).length;
  const market=restoreMarket({step:parentDone?(p.payment||p.serviceFeedback?.interestedFeatures.length?'budget':'concept'):'experience',
    budgetKind:p.payment?.kind||'',maxMonthlyYen:p.payment?.maxMonthlyYen??'',interestedFeatures:p.serviceFeedback?.interestedFeatures||[],featureComment:p.serviceFeedback?.comment||'',experienceCompletedAt:parentDone?record.updatedAt:null});
  const caught=Object.entries(p.evidence).flatMap(([id,value])=>Array(value.caught).fill(id));
  return {...state,started:true,sessionId:record.id,key,sequence:record.sequence,createdAt:record.createdAt,stage:p.stage,
    participant:{age:String(p.age)},recipeId:p.recipeId,caught:caught.length?caught:[...p.selectedIngredients],evidence:p.evidence,score:caught.length*100,
    gameFinished:!['intro','camera','game'].includes(p.stage),gameInput:p.gameInput==='camera'?'camera':'demo',surveys:{child,parent},market};
}
