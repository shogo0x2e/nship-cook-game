import type { Arm } from './avatar';
import type { DiagnosticCode, DiagnosticMetrics } from './diagnostics-policy';

type Sample = { at:number; inferenceMs:number; width:number; height:number; arms:Arm[] };
const percentile = (values:number[], p:number) => { const sorted=[...values].sort((a,b)=>a-b); return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))] ?? 0; };
// Only window counts/timings leave this class. Previous angles are kept locally
// for one observation, never exported as telemetry or retained as a recording.
export class TrackingDiagnostics {
  private began:number|null=null;
  private previous:Sample|null=null;
  private samples=0;
  private valid=0;
  private jumps=0;
  private toggles=0;
  private everValid=false;
  private lastValid:number|null=null;
  private inference:number[]=[];
  private intervals:number[]=[];
  private reported=new Set<DiagnosticCode>();
  private report:(code:DiagnosticCode,metrics:DiagnosticMetrics)=>void;
  constructor(report:(code:DiagnosticCode,metrics:DiagnosticMetrics)=>void) {this.report=report;}
  reset(){this.began=null;this.previous=null;this.samples=0;this.valid=0;this.jumps=0;this.toggles=0;this.everValid=false;this.lastValid=null;this.inference=[];this.intervals=[];}
  observe(sample:Sample){
    if(!Number.isFinite(sample.at)||sample.at<0||this.previous&&sample.at<=this.previous.at)return;
    this.began??=sample.at;
    const valid=sample.arms.length===2&&sample.arms.every(arm=>arm.valid);
    const wasValid=this.previous?.arms.length===2&&this.previous.arms.every(arm=>arm.valid);
    if(this.previous){
      const interval=sample.at-this.previous.at;
      this.intervals.push(interval);if(this.intervals.length>180)this.intervals.shift();
      if(valid!==wasValid)this.toggles++;
      if(valid&&wasValid&&interval<=120&&sample.arms.some((arm,i)=>['upper','lower'].some(key=>{
        const delta=arm[key as 'upper'|'lower']-this.previous!.arms[i][key as 'upper'|'lower'];
        return Math.abs(Math.atan2(Math.sin(delta),Math.cos(delta)))>1.15;
      })))this.jumps++;
    }
    this.samples++;if(valid){this.valid++;this.everValid=true;this.lastValid=sample.at;}
    if(Number.isFinite(sample.inferenceMs)){this.inference.push(sample.inferenceMs);if(this.inference.length>180)this.inference.shift();}
    this.previous=sample;
    if(sample.at-this.began>=5000&&this.samples>=12){
      const metrics=this.metrics(sample.at);
      if(this.valid>=8&&(this.jumps>=12&&this.jumps/this.valid>.3||this.toggles>=12&&this.toggles/this.samples>.4))this.emit('tracking_unstable',metrics);
      if(this.valid>=8&&percentile(this.inference,.5)>250)this.emit('tracking_slow',metrics);
      this.began=sample.at;this.samples=0;this.valid=0;this.jumps=0;this.toggles=0;this.inference=[];this.intervals=[];
    }
  }
  poll(now:number){
    if(!this.previous||!this.everValid)return;
    if(now-this.previous.at>=5000){if(!this.reported.has('tracking_stalled'))this.emit('tracking_stalled',this.metrics(now));return;}
    if(this.lastValid!==null&&now-this.lastValid>=5000&&!this.reported.has('tracking_lost'))this.emit('tracking_lost',this.metrics(now));
  }
  private emit(code:DiagnosticCode,metrics:DiagnosticMetrics){if(!this.reported.has(code)){this.reported.add(code);this.report(code,metrics);}}
  private metrics(now:number):DiagnosticMetrics{return {samples:this.samples,valid_samples:this.valid,window_ms:now-(this.began??now),jumps:this.jumps,toggles:this.toggles,
    inference_p50_ms:percentile(this.inference,.5),inference_p95_ms:percentile(this.inference,.95),interval_p50_ms:percentile(this.intervals,.5),
    lost_ms:now-(this.lastValid??now),width:this.previous?.width??0,height:this.previous?.height??0};}
}
