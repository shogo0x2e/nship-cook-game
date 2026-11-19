import type { Landmark } from './avatar.ts';
export type FramingStatus = { face:boolean; elbows:boolean; hands:boolean; all:boolean };
type Part='face'|'elbows'|'hands';
const parts:Part[]=['face','elbows','hands'];
const visible=(p:Landmark|undefined,confidence:number)=>Boolean(p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&(p.visibility??0)>=confidence&&p.x>=.025&&p.x<=.975&&p.y>=.025&&p.y<=.975);
export function framingStatus(points:Landmark[],confidence=.6):FramingStatus{
 const good=(id:number)=>visible(points[id],confidence);
 const face=[0,2,5].every(good);
 const elbows=[11,12,13,14].every(good);
 const hands=[15,16].every(good)&&[17,19,21].some(good)&&[18,20,22].some(good);
 return {face,elbows,hands,all:face&&elbows&&hands};
}
// UI confirmation is deliberately calmer than individual model predictions.
const acquireMs=200, releaseMs=450, maxObservationGapMs=800, holdMs=2000;
type PartState={shown:boolean;goodSince:number|null;goodSamples:number;lostSince:number|null};
const freshPart=():PartState=>({shown:false,goodSince:null,goodSamples:0,lostSince:null});
export class FramingGate{
 private states:Record<Part,PartState>={face:freshPart(),elbows:freshPart(),hands:freshPart()};
 private lastCapture=-Infinity;
 private lastReceived=-Infinity;
 private lastSample=-Infinity;
 private heldMs=0;
 private previousGood=false;
 private completed=false;
 private clearTracking(){
  for(const part of parts)this.states[part]=freshPart();
  this.lastCapture=-Infinity;this.lastReceived=-Infinity;this.heldMs=0;this.previousGood=false;
 }
 reset(){this.clearTracking();this.lastSample=-Infinity;this.completed=false;}
 observe(points:Landmark[],capturedAt:number,receivedAt=capturedAt){
  if(!Number.isFinite(capturedAt)||!Number.isFinite(receivedAt)||receivedAt<capturedAt||capturedAt<=this.lastCapture)return;
  if(receivedAt-this.lastReceived>maxObservationGapMs||receivedAt<this.lastReceived)this.clearTracking();
  const previousCapture=this.lastCapture;
  const wasConfirmed=parts.every(part=>this.states[part].shown);
  const acquire=framingStatus(points,.6),retain=framingStatus(points,.5);
  let rawAll=true;
  for(const part of parts){
   const state=this.states[part],good=state.shown?retain[part]:acquire[part];
   rawAll=rawAll&&good;
   if(good){
    state.lostSince=null;
    if(!state.shown){
     state.goodSince??=receivedAt;state.goodSamples++;
     if(receivedAt-state.goodSince>=acquireMs&&state.goodSamples>=2)state.shown=true;
    }
   }else{
    state.goodSince=null;state.goodSamples=0;state.lostSince??=receivedAt;
    if(receivedAt-state.lostSince>=releaseMs)state.shown=false;
   }
  }
  const confirmed=parts.every(part=>this.states[part].shown);
  // Advance only on distinct, valid observations. Render frames never add evidence.
  if(!confirmed)this.heldMs=0;
  else if(wasConfirmed&&rawAll&&this.previousGood&&capturedAt-previousCapture<=maxObservationGapMs)this.heldMs+=capturedAt-previousCapture;
  this.previousGood=rawAll;this.lastCapture=capturedAt;this.lastReceived=receivedAt;
 }
 sample(now:number,visiblePage=true){
  if(!visiblePage||now<this.lastSample||now-this.lastReceived>maxObservationGapMs)this.clearTracking();
  this.lastSample=now;
  for(const part of parts){
   const state=this.states[part];
   if(state.lostSince!==null&&now-state.lostSince>=releaseMs)state.shown=false;
  }
  const status={face:this.states.face.shown,elbows:this.states.elbows.shown,hands:this.states.hands.shown,all:parts.every(part=>this.states[part].shown)};
  if(!status.all)this.heldMs=0;
  const progress=Math.min(1,this.heldMs/holdMs);
  const ready=status.all&&this.previousGood&&progress>=1;
  const advance=ready&&!this.completed;
  if(advance)this.completed=true;
  return {status,progress,advance,ready};
 }
}
