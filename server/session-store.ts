import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { ingredients, recipes, type IngredientId } from '../src/content.ts';
import { freshEvidence, hintIds, type Evidence } from '../src/game.ts';
import { cookingPlans, type Role, type RoomState, type RoomAction, type RoomResponse } from '../src/shared.ts';
export class SessionError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status=status; } }
const fail = (status:number, message:string): never => { throw new SessionError(status,message); };
export function strictObject(value:unknown, keys:string[]): Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(400,'Invalid object');
  const object=value as Record<string,unknown>;
  if (Object.keys(object).length !== keys.length || keys.some(k=>!Object.hasOwn(object,k)) || Object.keys(object).some(k=>!keys.includes(k))) return fail(400,'Unexpected or missing fields');
  return object;
}
function strings(value:unknown, allowed:string[]): string[] {
  if (!Array.isArray(value) || value.length>allowed.length || value.some(v=>typeof v!=='string'||!allowed.includes(v)) || new Set(value).size!==value.length) return fail(400,'Invalid list');
  return [...value];
}
const foodIds=ingredients.map(i=>i.id);
export function validateSettings(value:unknown): {excluded:IngredientId[];allergens:string[]} {
  const obj=strictObject(value,['excluded','allergens']);
  const settings={excluded:strings(obj.excluded,foodIds) as IngredientId[],allergens:strings(obj.allergens,['卵','乳'])};
  if (!ingredients.some(i=>!settings.excluded.includes(i.id)&&!i.allergens.some(a=>settings.allergens.includes(a)))) return fail(400,'At least one ingredient is required');
  return settings;
}
function validText(value:unknown): string { if(typeof value!=='string'||value.length<1||value.length>100) return fail(400,'Invalid identifier'); return value; }
function available(state:RoomState,id:IngredientId) { const food=ingredients.find(i=>i.id===id)!; return !state.excluded.includes(id)&&!food.allergens.some(a=>state.allergens.includes(a)); }
function validateEvidence(value:unknown,state:RoomState): Evidence {
  const obj=strictObject(value,foodIds); const result=freshEvidence();
  for(const id of foodIds){const entry=strictObject(obj[id],['offered','caught']); const offered=entry.offered,caught=entry.caught;
    if(typeof offered!=='number'||typeof caught!=='number'||!Number.isInteger(offered)||!Number.isInteger(caught)||offered<0||offered>64||caught<0||caught>offered) return fail(400,'Invalid evidence');
    if(!available(state,id)&&(offered!==0||caught!==0)) return fail(400,'Excluded ingredient in result');
    result[id]={offered,caught};
  }
  if(Object.values(result).reduce((sum,v)=>sum+v.offered,0)>64) return fail(400,'Too many offers');
  return result;
}
const actionKeys:Record<RoomAction['type'],string[]>={START_GAME:['type','input'],GAME_STATUS:['type','roundId','status'],GAME_RESULT:['type','roundId','evidence'],SET_SELECTED:['type','selected'],CHOOSE_RECIPE:['type','recipeId'],ACTIVATE_STEP:['type','stepId'],COMPLETE_STEP:['type','stepId'],CHILD_DONE:['type','stepId'],BACK_TO_REVIEW:['type'],CANCEL_GAME:['type']};
const childActions=new Set(['GAME_STATUS','GAME_RESULT','CHILD_DONE']);
/** Pure transition. roundId is injected so tests need no clock/randomness. */
export function applyAction(current:RoomState,role:Role,value:unknown,newRoundId:string): RoomState {
  if(!value||typeof value!=='object'||Array.isArray(value)) return fail(400,'Invalid action');
  const type=(value as {type?:unknown}).type;
  if(typeof type!=='string'||!Object.hasOwn(actionKeys,type)) return fail(400,'Unknown action');
  const a=strictObject(value,actionKeys[type as RoomAction['type']]);
  if((childActions.has(type)?'child':'adult')!==role) return fail(403,'Role not allowed');
  const state=structuredClone(current);
  const stage=(...allowed:RoomState['stage'][])=>{if(!allowed.includes(state.stage)) fail(409,'Action is not available in this stage');};
  if(type==='START_GAME'){
    stage('lobby','review'); if(!state.childJoined) return fail(409,'Child has not joined');
    if(a.input!=='camera'&&a.input!=='demo') return fail(400,'Invalid input mode');
    state.stage='game';state.game={roundId:newRoundId,status:'ready',input:a.input,elapsed:0,evidence:freshEvidence()};state.selected=[];state.selectedRecipeId=null;state.cooking={activeStepId:null,completedStepIds:[],childReportStepId:null};
  } else if(type==='CANCEL_GAME'){
    stage('game');state.stage='lobby';state.game.status='idle';state.cooking={activeStepId:null,completedStepIds:[],childReportStepId:null};
  } else if(type==='GAME_STATUS'||type==='GAME_RESULT'){
    if(validText(a.roundId)!==state.game.roundId) return fail(409,'Stale round');
    if(type==='GAME_RESULT'){
      const evidence=validateEvidence(a.evidence,state);
      if(state.game.status==='finished') return current;
      stage('game'); state.game.evidence=evidence;state.game.status='finished';state.stage='review';state.selected=hintIds(evidence);
    } else {
      if(a.status!=='playing'&&a.status!=='paused') return fail(400,'Invalid game status');
      stage('game'); if(state.game.status==='finished') return fail(409,'Round finished');
      if(state.game.status===a.status) return current;
      state.game.status=a.status;
    }
  } else if(type==='SET_SELECTED'){
    stage('review');state.selected=strings(a.selected,foodIds) as IngredientId[];
    if(state.selected.some(id=>!available(state,id))) return fail(400,'Excluded selection');
  } else if(type==='CHOOSE_RECIPE'){
    stage('review');const id=validText(a.recipeId);const recipe=recipes.find(r=>r.id===id);
    if(!recipe||!Object.hasOwn(cookingPlans,id)) return fail(400,'Unknown recipe');
    if(recipe.foods.some(id=>!available(state,id))||recipe.allergens.some(a=>state.allergens.includes(a))) return fail(400,'Recipe does not meet exclusions');
    state.selectedRecipeId=id;state.stage='cooking';state.cooking={activeStepId:null,completedStepIds:[],childReportStepId:null};
  } else if(type==='BACK_TO_REVIEW'){
    stage('cooking','complete','review');state.stage='review';state.selectedRecipeId=null;state.cooking={activeStepId:null,completedStepIds:[],childReportStepId:null};
  } else {
    stage('cooking'); const id=validText(a.stepId); const steps=cookingPlans[state.selectedRecipeId??''];const step=steps?.find(s=>s.id===id);
    if(!step) return fail(400,'Unknown step');
    if(type==='ACTIVATE_STEP'){
      if(state.cooking.completedStepIds.includes(id)||!step.requires.every(dep=>state.cooking.completedStepIds.includes(dep))) return fail(409,'Step prerequisites not completed');
      if(state.cooking.activeStepId===id) return current;
      if(state.cooking.activeStepId) return fail(409,'Complete the active step first');
      state.cooking.activeStepId=id;state.cooking.childReportStepId=null;
    } else {
      if(state.cooking.activeStepId!==id) return fail(409,'Step is not active');
      if(type==='CHILD_DONE'){
        if(step.role!=='child') return fail(403,'This is an adult step');
        if(state.cooking.childReportStepId===id) return current;
        state.cooking.childReportStepId=id;
      } else {
        if(step.role==='child'&&state.cooking.childReportStepId!==id) return fail(409,'Wait for child report');
        state.cooking.completedStepIds.push(id);state.cooking.activeStepId=null;state.cooking.childReportStepId=null;
        if(steps.every(s=>state.cooking.completedStepIds.includes(s.id))) state.stage='complete';
      }
    }
  }
  state.revision++;return state;
}
type Room={id:string;code:string;adultToken:string;childToken:string|null;expires:number;state:RoomState};
const equal=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export class SessionStore {
  private rooms=new Map<string,Room>();
  constructor(privateOptions:{ttlMs?:number;maxRooms?:number;now?:()=>number}={}) {this.options={ttlMs:privateOptions.ttlMs??7_200_000,maxRooms:privateOptions.maxRooms??100,now:privateOptions.now??Date.now};}
  private options:{ttlMs:number;maxRooms:number;now:()=>number};
  private cleanup(){for(const [id,r]of this.rooms)if(r.expires<=this.options.now())this.rooms.delete(id);}
  create(body:unknown):RoomResponse {this.cleanup();const settings=validateSettings(body);if(this.rooms.size>=this.options.maxRooms) return fail(503,'Room capacity reached');
    let code:string;do{code=String(randomInt(0,1_000_000)).padStart(6,'0');}while([...this.rooms.values()].some(r=>r.code===code));
    const room:Room={id:randomUUID(),code,adultToken:randomBytes(32).toString('hex'),childToken:null,expires:this.options.now()+this.options.ttlMs,state:{revision:0,stage:'lobby',...settings,childJoined:false,game:{roundId:'',status:'idle',input:'camera',elapsed:0,evidence:freshEvidence()},selected:[],selectedRecipeId:null,cooking:{activeStepId:null,completedStepIds:[],childReportStepId:null}}};this.rooms.set(room.id,room);return this.response(room,'adult');
  }
  join(body:unknown):RoomResponse {this.cleanup();const {code}=strictObject(body,['code']);if(typeof code!=='string'||!/^\d{6}$/.test(code))return fail(400,'Invalid code');const room=[...this.rooms.values()].find(r=>r.code===code);if(!room)return fail(404,'Room not found');if(room.childToken)return fail(409,'Room already paired');room.childToken=randomBytes(32).toString('hex');room.expires=this.options.now()+this.options.ttlMs;room.state={...room.state,childJoined:true,revision:room.state.revision+1};return this.response(room,'child');}
  private response(room:Room,role:Role):RoomResponse{return{roomId:room.id,code:room.code,token:role==='adult'?room.adultToken:room.childToken!,role,state:structuredClone(room.state)};}
  private authenticate(id:string,token:string):{room:Room;role:Role}{this.cleanup();const room=this.rooms.get(id);if(!room)return fail(404,'Room not found or expired');if(!/^[0-9a-f]{64}$/.test(token))return fail(401,'Invalid token');const role=equal(token,room.adultToken)?'adult':room.childToken&&equal(token,room.childToken)?'child':null;if(!role)return fail(401,'Invalid token');return{room,role};}
  get(id:string,token:string){const{room,role}=this.authenticate(id,token);return{state:structuredClone(room.state),role,code:room.code};}
  action(id:string,token:string,body:unknown){const{room,role}=this.authenticate(id,token);room.state=applyAction(room.state,role,body,randomUUID());room.expires=this.options.now()+this.options.ttlMs;return this.get(id,token);}
  remove(id:string,token:string){const{role}=this.authenticate(id,token);if(role!=='adult')return fail(403,'Only adult can close room');this.rooms.delete(id);}
}
