import test from 'node:test';
import assert from 'node:assert/strict';
import {FramingGate,framingStatus} from '../src/camera-framing.ts';
const body=(visibility=1)=>Array.from({length:33},()=>({x:.5,y:.5,visibility}));
const observe=(gate:FramingGate,time:number,points=body(),latency=0)=>{gate.observe(points,time,time+latency);return gate.sample(time+latency);};
test('framing requires both arms and visible hands, not just inferred off-screen landmarks',()=>{
 const points=body();assert.equal(framingStatus(points).all,true);
 for(const id of [11,12,13,14,15,16,17,18,19,20,21,22])points[id].visibility=.1;
 assert.deepEqual(framingStatus(points),{face:true,elbows:false,hands:false,all:false});
 const clipped=body();clipped[13].x=1.1;assert.equal(framingStatus(clipped).elbows,false);
 const tips=body();for(const id of [17,19,21])tips[id].visibility=0;assert.equal(framingStatus(tips).hands,false);
 const invalid=body();invalid[0].x=NaN;assert.equal(framingStatus(invalid).face,false);
});
test('valid observed frames for two seconds advance once, after confirming the initial pose',()=>{
 const gate=new FramingGate();let advances=0;
 for(let time=0;time<=3000;time+=50){const result=observe(gate,time);if(time<2200)assert.equal(result.advance,false);if(result.advance)advances++;}
 assert.equal(advances,1);
});
test('brief low confidence or missed detections do not flash confirmed indicators or reset progress',()=>{
 const gate=new FramingGate();for(let t=0;t<=1000;t+=50)observe(gate,t);
 const before=gate.sample(1000).progress;assert.ok(before>0);
 const missed=observe(gate,1050,[]);assert.equal(missed.status.all,true);assert.equal(missed.progress,before);assert.equal(missed.advance,false);
 assert.equal(observe(gate,1100).status.all,true);
 for(let t=1150;t<=1600;t+=50)assert.equal(observe(gate,t,body(t%100===0?.58:.62)).status.all,true);
 assert.ok(gate.sample(1600).progress>before);
});
test('a slow 3 fps detector and inference latency do not produce alternating detected/missing states',()=>{
 const gate=new FramingGate();let advances=0;
 for(let captured=0;captured<=3600;captured+=300){
  const result=observe(gate,captured,body(),280);
  if(captured>=300)assert.equal(result.status.all,true);
  if(result.advance)advances++;
  assert.equal(gate.sample(captured+550).status.all,captured>=300);
 }
 assert.equal(advances,1);
});
test('sustained loss clears confirmation, while a single frame, duplicates and render-only time cannot advance',()=>{
 const gate=new FramingGate();observe(gate,0);assert.equal(gate.sample(700).status.all,false);
 gate.reset();for(let t=0;t<=1000;t+=50)observe(gate,t);
 const progress=gate.sample(1000).progress;
 assert.equal(gate.sample(1700).progress,progress);assert.equal(gate.sample(1700).advance,false);
 assert.equal(gate.sample(1850).status.all,false);assert.equal(gate.sample(1850).progress,0);
 for(let t=1900;t<=2500;t+=50)observe(gate,t);
 for(let t=2550;t<=2950;t+=50)assert.equal(observe(gate,t,[]).status.all,true);
 assert.equal(observe(gate,3000,[]).status.all,false);assert.equal(gate.sample(3000).progress,0);
 gate.reset();for(let t=0;t<=500;t+=50)observe(gate,t);
 for(let t=550;t<=2500;t+=50){gate.observe(body(),500,t);assert.equal(gate.sample(t).advance,false);}
});
test('a brief miss at the finish cannot auto-advance, and backgrounding resets confirmation',()=>{
 const gate=new FramingGate();for(let t=0;t<=2150;t+=50)observe(gate,t);
 assert.equal(observe(gate,2200,[]).advance,false);assert.equal(gate.sample(2250).advance,false);
 assert.equal(gate.sample(2300,false).status.all,false);
 const restarted=observe(gate,2350);assert.equal(restarted.progress,0);assert.equal(restarted.advance,false);
});
