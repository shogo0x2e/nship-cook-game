// Control stops on invalid input immediately. Visual feedback tolerates brief gaps.
// Slow inference must be judged against its observed cadence, not a fixed 250ms.
export class TrackingStability {
 private captured=-Infinity;
 private received=-Infinity;
 private valid=false;
 private shown=false;
 private acquired=false;
 private lostSince:number|null=null;
 private goodSince:number|null=null;
 private goodSamples=0;
 private intervals:number[]=[];
 private freshnessMs=250;
 reset(){this.captured=-Infinity;this.received=-Infinity;this.valid=false;this.shown=false;this.acquired=false;this.lostSince=null;this.goodSince=null;this.goodSamples=0;this.intervals=[];this.freshnessMs=250;}
 observe(valid:boolean,capturedAt:number,receivedAt:number){
  if(!Number.isFinite(capturedAt)||!Number.isFinite(receivedAt)||receivedAt<capturedAt||capturedAt<=this.captured)return;
  const interval=capturedAt-this.captured;
  if(Number.isFinite(interval)&&interval>0&&interval<=800){
   this.intervals.push(interval);if(this.intervals.length>5)this.intervals.shift();
   const sorted=[...this.intervals].sort((a,b)=>a-b);
   this.freshnessMs=Math.min(800,Math.max(250,sorted[Math.floor(sorted.length/2)]*1.8+(receivedAt-capturedAt)));
  }
  // An old result cannot revive tracking or its on-screen confirmation.
  this.valid=valid&&receivedAt-capturedAt<=this.freshnessMs;
  this.captured=capturedAt;this.received=receivedAt;
  if(this.valid){
   this.lostSince=null;this.goodSince??=receivedAt;this.goodSamples++;
   if(!this.acquired||(this.goodSamples>=2&&receivedAt-this.goodSince>=200)){this.shown=true;this.acquired=true;}
  }else{
   this.goodSince=null;this.goodSamples=0;this.lostSince??=receivedAt;
  }
 }
 sample(now:number){
  const fresh=now>=this.received&&now-this.captured<=this.freshnessMs&&now-this.received<=this.freshnessMs;
  if(!fresh){this.lostSince??=this.captured+this.freshnessMs;this.goodSince=null;this.goodSamples=0;}
  if(this.lostSince!==null&&now-this.lostSince>=450)this.shown=false;
  return {control:this.shown&&fresh&&this.valid,visible:this.shown};
 }
}
