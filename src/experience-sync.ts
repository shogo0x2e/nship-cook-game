import type { ExperiencePayload } from './experience-protocol.ts';
export type Packet={id:string;key:string;payload:ExperiencePayload};
export type Acknowledgement={saved:true;id:string;sequence:number;complete:boolean;receipt:string|null;stale?:boolean};
const queueKey='cookgame-anonymous-outbox-v1';
const load=():Record<string,Packet>=>{try{const value=JSON.parse(localStorage.getItem(queueKey)??'{}');if(!value||typeof value!=='object'||Array.isArray(value))return {};return Object.fromEntries(Object.entries(value).filter(([id,p])=>Boolean(p&&typeof p==='object'&&(p as Packet).id===id&&(p as Packet).payload&&Number.isInteger((p as Packet).payload.sequence)))) as Record<string,Packet>;}catch{return {};}};
const store=(queue:Record<string,Packet>)=>{try{localStorage.setItem(queueKey,JSON.stringify(queue));}catch{/* Online saving still works when browser persistence is unavailable. */}};
let queue=load();let flushing:Promise<void>|null=null;
const listeners=new Set<(ack:Acknowledgement)=>void>();
export function onSaved(callback:(ack:Acknowledgement)=>void){listeners.add(callback);return()=>listeners.delete(callback);}
async function send(packet:Packet):Promise<Acknowledgement>{
 let response:Response;
 try{response=await fetch(`/api/experiences/${packet.id}`,{method:'PUT',credentials:'omit',headers:{'Content-Type':'application/json',Authorization:`Bearer ${packet.key}`},body:JSON.stringify(packet.payload),signal:AbortSignal.timeout(10000)});}catch{throw new Error('通信できませんでした。接続を確認して、もう一度送信してください。');}
 if(!response.ok)throw new Error(response.status===409?'質問の版または提出済みの回答を確認してください。':'回答を送信できませんでした。接続を確認して、もう一度送信してください。');
 const result=await response.json();if(result.saved!==true||result.id!==packet.id||!Number.isInteger(result.sequence))throw new Error('保存結果を確認できませんでした。もう一度送信してください。');
 return result as Acknowledgement;
}
export async function saveExperience(packet:Packet):Promise<Acknowledgement>{
 if(!queue[packet.id]||queue[packet.id].payload.sequence<=packet.payload.sequence){queue[packet.id]=packet;store(queue);}
 // Each request carries an immutable sequence/body pair. A lost acknowledgement can be retried safely.
 const ack=await send(packet);
 if(queue[packet.id]&&queue[packet.id].payload.sequence<=ack.sequence){delete queue[packet.id];store(queue);}
 for(const listener of listeners)listener(ack);
 return ack;
}
export function flushOutbox(){
 if(flushing)return flushing;
 flushing=(async()=>{for(const packet of Object.values(queue)){try{await saveExperience(packet);}catch{/* Keep this response for the next explicit/online retry. */}}})().finally(()=>{flushing=null;});
 return flushing;
}
window.addEventListener('online',()=>void flushOutbox());
