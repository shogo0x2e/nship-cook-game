import test from 'node:test';
import assert from 'node:assert/strict';
import {TrackingStability} from '../src/tracking-stability.ts';
test('one missed detection disables catches immediately without flashing visual feedback',()=>{
 const gate=new TrackingStability();gate.observe(true,0,0);assert.deepEqual(gate.sample(0),{control:true,visible:true});
 gate.observe(false,50,50);assert.deepEqual(gate.sample(50),{control:false,visible:true});
 gate.observe(true,100,100);assert.deepEqual(gate.sample(100),{control:true,visible:true});
 for(let t=150;t<=2000;t+=50){gate.observe(t%150!==0,t,t);assert.equal(gate.sample(t).visible,true);}
});
test('three fps inference with latency stays tracked between observations',()=>{
 const gate=new TrackingStability();
 for(let t=0;t<=3000;t+=300){
  gate.observe(true,t,t+280);
  if(t>=300)for(let received=t+280;received<t+580;received+=16){assert.equal(gate.sample(received).control,true);assert.equal(gate.sample(received).visible,true);}
 }
});
test('sustained loss shows one stable message and recovery requires multiple observations',()=>{
 const gate=new TrackingStability();for(let t=0;t<=500;t+=50)gate.observe(true,t,t);
 for(let t=550;t<=1100;t+=50){gate.observe(false,t,t);assert.equal(gate.sample(t).control,false);assert.equal(gate.sample(t).visible,t<1000);}
 gate.observe(true,1150,1150);assert.deepEqual(gate.sample(1150),{control:false,visible:false});
 gate.observe(false,1200,1200);assert.equal(gate.sample(1200).visible,false);
 for(let t=1250;t<1450;t+=50){gate.observe(true,t,t);assert.equal(gate.sample(t).visible,false);}
 gate.observe(true,1450,1450);assert.deepEqual(gate.sample(1450),{control:true,visible:true});
});
test('a hung detector or repeated old frames cannot keep controls enabled',()=>{
 const gate=new TrackingStability();for(let t=0;t<=1200;t+=300)gate.observe(true,t,t+200);
 assert.equal(gate.sample(1500).control,true);
 gate.observe(true,1200,1800);assert.equal(gate.sample(2100).control,false);
 assert.equal(gate.sample(2500).visible,false);
});
test('backgrounding resets both display and controls',()=>{
 const gate=new TrackingStability();gate.observe(true,0,0);gate.reset();assert.deepEqual(gate.sample(10),{control:false,visible:false});
});
