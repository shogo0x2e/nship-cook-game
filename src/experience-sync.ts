import {questionnaireVersion, type ExperiencePayload} from './experience-protocol.ts';
// @ts-expect-error Shared with the standalone HTML prototype.
import { newExperienceId } from '../design/recipe-prototype/experience-id.js';
export type Packet={id:string;key:string;payload:ExperiencePayload};
export type Acknowledgement={saved:true;id:string;sequence:number;complete:boolean;receipt:string|null;stale?:boolean};
const queueKey='cookgame-anonymous-outbox-v1';
function load():Record<string,Packet>{
 try{
  const value=JSON.parse(localStorage.getItem(queueKey)??'{}');
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  const result:Record<string,Packet>={};
  // Private-token keys keep colliding IDs separate.
  for(const p of Object.values(value) as Packet[]){
   if(p?.payload?.questionnaireVersion!==questionnaireVersion)continue;
   if(!p||typeof p.id!=='string'||!/^[a-f0-9]{64}$/.test(p.key)||!Number.isInteger(p.payload?.sequence))continue;
   if(!result[p.key]||result[p.key].payload.sequence<p.payload.sequence)result[p.key]=p;
  }
  return result;
 }catch{return {};}
}
const store=()=>{try{localStorage.setItem(queueKey,JSON.stringify(queue));}catch{/* Online delivery remains usable without storage. */}};
const queue=load();
store(); // Drop discarded test-era deliveries from persistent storage as well.
const aliases=new Map<string,string>();
const active=new Map<string,Promise<Acknowledgement>>();
let flushing:Promise<void>|null=null;
const listeners=new Set<(ack:Acknowledgement,key:string)=>void>();
const idListeners=new Set<(change:{key:string;id:string})=>void>();
export function onSaved(callback:(ack:Acknowledgement,key:string)=>void){listeners.add(callback);return()=>listeners.delete(callback);}
export function onIdChanged(callback:(change:{key:string;id:string})=>void){idListeners.add(callback);return()=>idListeners.delete(callback);}
class IdCollision extends Error{}
async function send(packet:Packet):Promise<Acknowledgement>{
 let response:Response;
 try{response=await fetch(`/api/experiences/${packet.id}`,{method:'PUT',credentials:'omit',headers:{'Content-Type':'application/json',Authorization:`Bearer ${packet.key}`},body:JSON.stringify(packet.payload),keepalive:true,signal:AbortSignal.timeout(10000)});}catch{throw new Error('通信できませんでした。接続を確認して、もう一度送信してください。');}
 if(!response.ok){
  const body=await response.json().catch(()=>null);
  if(response.status===409&&body?.error==='Experience ID collision')throw new IdCollision();
  throw new Error(response.status===409?'質問の版または提出済みの回答を確認してください。':'回答を送信できませんでした。接続を確認して、もう一度送信してください。');
 }
 const result=await response.json();
 if(result.saved!==true||result.id!==packet.id||!Number.isInteger(result.sequence))throw new Error('保存結果を確認できませんでした。もう一度送信してください。');
 return result as Acknowledgement;
}
export async function saveExperience(original:Packet):Promise<Acknowledgement>{
 const normalized={...original,id:aliases.get(original.key)??original.id};
 if(!queue[original.key]||queue[original.key].payload.sequence<=original.payload.sequence){queue[original.key]=normalized;store();}
 // Serialize requests per experience, retaining immutable sequence/body pairs.
 const task=(active.get(original.key)??Promise.resolve()).catch(()=>{}).then(async()=>{
  for(let attempt=0;attempt<6;attempt++){
   const packet={...original,id:aliases.get(original.key)??original.id};
   try{
    const ack=await send(packet);
    if(queue[packet.key]&&queue[packet.key].payload.sequence<=ack.sequence){delete queue[packet.key];store();}
    for(const listener of listeners)listener(ack,packet.key);
    return ack;
   }catch(error){
    if(!(error instanceof IdCollision)||attempt===5)throw error;
    const id=newExperienceId();aliases.set(original.key,id);
    if(queue[original.key]){queue[original.key]={...queue[original.key],id};store();}
    for(const listener of idListeners)listener({key:original.key,id});
   }
  }
  throw new Error('受付IDを発行できませんでした。もう一度送信してください。');
 });
 active.set(original.key,task);
 try{return await task;}finally{if(active.get(original.key)===task)active.delete(original.key);}
}
export function flushOutbox(){
 if(flushing)return flushing;
 flushing=(async()=>{for(const packet of Object.values(queue)){try{await saveExperience(packet);}catch{/* Retain pending deliveries without restoring the previous UI. */}}})().finally(()=>{flushing=null;});
 return flushing;
}
window.addEventListener('online',()=>void flushOutbox());
