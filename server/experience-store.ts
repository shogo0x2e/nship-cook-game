import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { SessionError, strictObject } from './session-store.ts';
import { questionnaireVersion, recipeVersion, conceptVersion, inventoryVersion, experienceFoodIds, experienceRecipeIds, childQuestionIds, childPlayFrequencies, parentQuestionIds, gameplayStatuses, employmentStatuses, serviceFeatureIds, experienceStages, type ExperiencePayload } from '../src/experience-protocol.ts';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const shortId=/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const integer=(value:unknown,min:number,max:number):value is number=>Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=max;
const invalid=():never=>{throw new SessionError(400,'Invalid experience response');};
function answers(value:unknown,ids:readonly string[],complete:boolean,parent=false){
 const hasGameplay=parent&&Boolean(value&&typeof value==='object'&&Object.hasOwn(value,'gameplayStatus'));
 const hasComment=parent&&Boolean(value&&typeof value==='object'&&Object.hasOwn(value,'gameplayComment'));
 const hasEmployment=parent&&Boolean(value&&typeof value==='object'&&Object.hasOwn(value,'employmentStatus'));
 const hasFrequency=!parent&&Boolean(value&&typeof value==='object'&&Object.hasOwn(value,'playFrequency'));
 const keys=['answers','comment'];if(hasFrequency)keys.push('playFrequency');if(hasGameplay)keys.push('gameplayStatus');if(hasComment)keys.push('gameplayComment');if(hasEmployment)keys.push('employmentStatus');
 const section=strictObject(value,keys);
 if(typeof section.comment!=='string'||section.comment.length>3000)invalid();
 if(!section.answers||typeof section.answers!=='object'||Array.isArray(section.answers))invalid();
 const result:Record<string,number>={};
 for(const [key,score] of Object.entries(section.answers as Record<string,unknown>)){
  if(!ids.includes(key)||!integer(score,1,7))invalid();result[key]=score as number;
 }
 if(complete&&ids.some(id=>result[id]===undefined))invalid();
 if(hasGameplay&&section.gameplayStatus!==null&&!gameplayStatuses.includes(section.gameplayStatus as typeof gameplayStatuses[number]))invalid();
 if(complete&&parent&&(!hasGameplay||section.gameplayStatus===null))invalid();
 if(hasComment&&(typeof section.gameplayComment!=='string'||section.gameplayComment.length>3000))invalid();
 if(hasEmployment&&section.employmentStatus!==null&&!employmentStatuses.includes(section.employmentStatus as typeof employmentStatuses[number]))invalid();
 if(complete&&parent&&(!hasEmployment||section.employmentStatus===null))invalid();
 if(hasFrequency&&section.playFrequency!==null&&!childPlayFrequencies.includes(section.playFrequency as typeof childPlayFrequencies[number]))invalid();
 if(complete&&!parent&&(!hasFrequency||section.playFrequency===null))invalid();
 return {answers:result,comment:section.comment as string,...(hasFrequency?{playFrequency:section.playFrequency as ExperiencePayload['child']['playFrequency']}:{}),...(hasGameplay?{gameplayStatus:section.gameplayStatus as ExperiencePayload['parent']['gameplayStatus']}:{}),...(hasComment?{gameplayComment:section.gameplayComment as string}:{}),...(hasEmployment?{employmentStatus:section.employmentStatus as ExperiencePayload['parent']['employmentStatus']}:{})};
}
export function validateExperience(value:unknown):ExperiencePayload{
 const keys=['questionnaireVersion','recipeVersion','conceptVersion','sequence','age','demo','stage','selectedIngredients','evidence','recipeId','child','parent','payment','complete'];
 if(value&&typeof value==='object'&&Object.hasOwn(value,'inventoryVersion'))keys.push('inventoryVersion');
 if(value&&typeof value==='object'&&Object.hasOwn(value,'gameInput'))keys.push('gameInput');
 for(const key of ['deviceId','serviceFeedback'])if(value&&typeof value==='object'&&Object.hasOwn(value,key))keys.push(key);
 const v=strictObject(value,keys);
 if(v.questionnaireVersion!==questionnaireVersion||v.recipeVersion!==recipeVersion||v.conceptVersion!==conceptVersion)throw new SessionError(409,'Questionnaire version changed; start a new experience');
 if(typeof v.deviceId!=='string'||!uuid.test(v.deviceId))invalid();
 if(v.inventoryVersion!==undefined&&v.inventoryVersion!==inventoryVersion)invalid();
 if(v.gameInput!==undefined&&!['camera','demo'].includes(String(v.gameInput)))invalid();
 if(!integer(v.sequence,1,1_000_000)||!integer(v.age,0,120)||typeof v.demo!=='boolean'||typeof v.complete!=='boolean'||!experienceStages.includes(v.stage as typeof experienceStages[number]))invalid();
 if(!Array.isArray(v.selectedIngredients)||v.selectedIngredients.length>13||new Set(v.selectedIngredients).size!==v.selectedIngredients.length||v.selectedIngredients.some(id=>!experienceFoodIds.includes(id as typeof experienceFoodIds[number])))invalid();
 if(v.recipeId!==null&&!experienceRecipeIds.includes(v.recipeId as typeof experienceRecipeIds[number]))invalid();
 if(!v.evidence||typeof v.evidence!=='object'||Array.isArray(v.evidence))invalid();
 const evidence:ExperiencePayload['evidence']={};
 for(const [id,raw] of Object.entries(v.evidence as Record<string,unknown>)){
  if(!experienceFoodIds.includes(id as typeof experienceFoodIds[number]))invalid();
  const entry=strictObject(raw,['offered','caught']);
  if(!integer(entry.offered,0,64)||!integer(entry.caught,0,64)||entry.caught>entry.offered)invalid();
  evidence[id]={offered:entry.offered as number,caught:entry.caught as number};
 }
 let payment:ExperiencePayload['payment']=null;
 if(v.payment!==null){
  const p=strictObject(v.payment,['kind','maxMonthlyYen']);
  if(!['paid','free','no_use'].includes(String(p.kind)))invalid();
  if(p.kind==='paid'&&!integer(p.maxMonthlyYen,1,1_000_000))invalid();
  if(p.kind==='free'&&p.maxMonthlyYen!==0||p.kind==='no_use'&&p.maxMonthlyYen!==null)invalid();
  payment={kind:p.kind as 'paid'|'free'|'no_use',maxMonthlyYen:p.maxMonthlyYen as number|null};
 }
 const complete=v.complete as boolean;
 let serviceFeedback:ExperiencePayload['serviceFeedback'];
 if(v.serviceFeedback!==undefined){
  const feedback=strictObject(v.serviceFeedback,['interestedFeatures','comment']);
  if(typeof feedback.comment!=='string'||feedback.comment.length>3000||!Array.isArray(feedback.interestedFeatures))invalid();
  const ids=feedback.interestedFeatures as string[];
  if(ids.length>6||new Set(ids).size!==ids.length||ids.some(id=>!serviceFeatureIds.includes(id as typeof serviceFeatureIds[number]))||ids.includes('none')&&ids.length!==1)invalid();
  if(complete&&!ids.length)invalid();
  serviceFeedback={interestedFeatures:ids,comment:feedback.comment as string};
 }
 if(complete&&!serviceFeedback)invalid();
 if(complete&&(v.stage!=='done'||!payment||!v.recipeId))invalid();
 return {questionnaireVersion:v.questionnaireVersion as ExperiencePayload['questionnaireVersion'],recipeVersion,conceptVersion:v.conceptVersion as ExperiencePayload['conceptVersion'],...(v.inventoryVersion===undefined?{}:{inventoryVersion:v.inventoryVersion as ExperiencePayload['inventoryVersion']}),sequence:v.sequence as number,age:v.age as number,demo:v.demo as boolean,stage:v.stage as ExperiencePayload['stage'],selectedIngredients:v.selectedIngredients as string[],evidence,recipeId:v.recipeId as string|null,child:answers(v.child,childQuestionIds,complete),parent:answers(v.parent,parentQuestionIds,complete,true),payment,...(v.gameInput===undefined?{}:{gameInput:v.gameInput as 'camera'|'demo'}),...(v.deviceId===undefined?{}:{deviceId:v.deviceId as string}),...(serviceFeedback?{serviceFeedback}:{}),complete};
}
type Row={id:string;token_hash:string;sequence:number;payload_hash:string;payload:string;complete:number;receipt:string|null;created_at:string;updated_at:string};
export class ExperienceStore{
 readonly db:DatabaseSync;
 private readonly legacyRecoveryIds:readonly string[];
 constructor(db:DatabaseSync,legacyRecoveryIds:readonly string[]=[]){
  if(!Array.isArray(legacyRecoveryIds)||legacyRecoveryIds.length>2||new Set(legacyRecoveryIds).size!==legacyRecoveryIds.length||legacyRecoveryIds.some(id=>!shortId.test(id)))throw new Error('Invalid legacy recovery allowlist');
  this.legacyRecoveryIds=[...legacyRecoveryIds];
  this.db=db;
  db.exec(`PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS experience_responses(
    id TEXT PRIMARY KEY,token_hash TEXT NOT NULL,sequence INTEGER NOT NULL,payload_hash TEXT NOT NULL,
    payload TEXT NOT NULL,complete INTEGER NOT NULL DEFAULT 0,demo INTEGER NOT NULL,
    age INTEGER NOT NULL,child_mode TEXT NOT NULL,recipe_id TEXT,questionnaire_version TEXT NOT NULL,
    receipt TEXT UNIQUE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT,device_id TEXT);
   CREATE INDEX IF NOT EXISTS experience_aggregate_idx ON experience_responses(demo,complete,questionnaire_version);`);
  if(!db.prepare('PRAGMA table_info(experience_responses)').all().some(column=>column.name==='device_id'))db.exec('ALTER TABLE experience_responses ADD COLUMN device_id TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS experience_device_idx ON experience_responses(device_id)');
  db.exec('CREATE TABLE IF NOT EXISTS experience_recovery_keys(id TEXT PRIMARY KEY REFERENCES experience_responses(id) ON DELETE CASCADE,token_hash TEXT NOT NULL,created_at TEXT NOT NULL)');
 }
 private credentials(id:string,token:string|undefined){
  if(!(uuid.test(id)||shortId.test(id))||!token||!/^[0-9a-f]{64}$/.test(token))throw new SessionError(401,'Experience key required');
  return digest(token);
 }
 private matchesCredential(row:Row,hash:string){
  if(timingSafeEqual(Buffer.from(row.token_hash,'hex'),Buffer.from(hash,'hex')))return true;
  const recovered=this.db.prepare('SELECT token_hash FROM experience_recovery_keys WHERE id=?').get(row.id);
  return Boolean(recovered&&timingSafeEqual(Buffer.from(recovered.token_hash as string,'hex'),Buffer.from(hash,'hex')));
 }
 private authorize(row:Row,hash:string){if(!this.matchesCredential(row,hash))throw new SessionError(401,'Experience key required');}
 private legacyRow(id:string,deviceId:unknown){
  if(typeof deviceId!=='string'||!uuid.test(deviceId))return invalid();
  if(!this.legacyRecoveryIds.includes(id))return undefined;
  const row=this.db.prepare('SELECT * FROM experience_responses WHERE id=? AND device_id=? AND demo=0 AND complete=0 AND questionnaire_version=?').get(id,deviceId,questionnaireVersion) as Row|undefined;
  if(row){try{validateExperience(JSON.parse(row.payload));}catch{return undefined;}}
  return row;
 }
 findLegacy(deviceId:unknown){
  if(typeof deviceId!=='string'||!uuid.test(deviceId))return invalid();
  for(const id of this.legacyRecoveryIds){
   if(this.legacyRow(id,deviceId)&&!this.db.prepare('SELECT 1 FROM experience_recovery_keys WHERE id=?').get(id))return {id};
  }
  return null;
 }
 claimLegacy(id:string,deviceId:unknown,token:string|undefined){
  const hash=this.credentials(id,token);
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const row=this.legacyRow(id,deviceId);if(!row)throw new SessionError(404,'No recoverable experience');
   const claimed=this.db.prepare('SELECT token_hash FROM experience_recovery_keys WHERE id=?').get(id);
   if(claimed&&!timingSafeEqual(Buffer.from(claimed.token_hash as string,'hex'),Buffer.from(hash,'hex')))throw new SessionError(404,'No recoverable experience');
   if(!claimed)this.db.prepare('INSERT INTO experience_recovery_keys(id,token_hash,created_at) VALUES(?,?,?)').run(id,hash,new Date().toISOString());
   const recovered={...this.get(id,token),createdAt:row.created_at,updatedAt:row.updated_at};
   this.db.exec('COMMIT');return recovered;
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 save(id:string,token:string|undefined,value:unknown){
  const tokenHash=this.credentials(id,token);const payload=validateExperience(value);const text=JSON.stringify(payload);const hash=digest(text);const now=new Date().toISOString();
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const previous=this.db.prepare('SELECT * FROM experience_responses WHERE id=?').get(id) as Row|undefined;
   if(previous){
    if(shortId.test(id)&&!this.matchesCredential(previous,tokenHash))throw new SessionError(409,'Experience ID collision');
    this.authorize(previous,tokenHash);
    if(payload.sequence<previous.sequence){this.db.exec('COMMIT');return {saved:true,id,sequence:previous.sequence,complete:Boolean(previous.complete),receipt:previous.receipt,stale:true};}
    if(payload.sequence===previous.sequence){
     if(hash!==previous.payload_hash)throw new SessionError(409,'Response sequence conflict');
     this.db.exec('COMMIT');return {saved:true,id,sequence:previous.sequence,complete:Boolean(previous.complete),receipt:previous.receipt};
    }
    if(previous.complete)throw new SessionError(409,'This experience has already been submitted');
   }
   const receipt=payload.complete?(shortId.test(id)?id:`MG-${randomBytes(6).toString('hex').toUpperCase()}`):null;
   this.db.prepare(`INSERT INTO experience_responses(id,token_hash,sequence,payload_hash,payload,complete,demo,age,child_mode,recipe_id,questionnaire_version,receipt,created_at,updated_at,completed_at,device_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET sequence=excluded.sequence,payload_hash=excluded.payload_hash,payload=excluded.payload,complete=excluded.complete,demo=excluded.demo,age=excluded.age,child_mode=excluded.child_mode,recipe_id=excluded.recipe_id,questionnaire_version=excluded.questionnaire_version,receipt=excluded.receipt,updated_at=excluded.updated_at,completed_at=excluded.completed_at,device_id=excluded.device_id`).run(id,tokenHash,payload.sequence,hash,text,Number(payload.complete),Number(payload.demo),payload.age,payload.age<=8?'young-current-experience':'older-kindergarten-hypothetical',payload.recipeId,payload.questionnaireVersion,receipt,previous?.created_at??now,now,payload.complete?now:null,payload.deviceId??null);
   this.db.exec('COMMIT');return {saved:true,id,sequence:payload.sequence,complete:payload.complete,receipt};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 get(id:string,token:string|undefined){
  const hash=this.credentials(id,token);const row=this.db.prepare('SELECT * FROM experience_responses WHERE id=?').get(id) as Row|undefined;
  if(!row)throw new SessionError(404,'Experience not found');this.authorize(row,hash);
  return {id,sequence:row.sequence,complete:Boolean(row.complete),receipt:row.receipt,payload:JSON.parse(row.payload)};
 }
}
