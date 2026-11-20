import test from 'node:test';
import assert from 'node:assert/strict';
import {DiagnosticLimiter,sanitizeDiagnostic,diagnosticBrowser,diagnosticErrorKind,type DiagnosticCode,type DiagnosticMetrics} from '../src/diagnostics-policy.ts';
import {TrackingDiagnostics} from '../src/tracking-diagnostics.ts';
const arms=(angle=0,valid=true)=>[0,1].map(()=>({upper:angle,lower:angle,valid,raised:true}));
const sample=(at:number,angle=0,valid=true,inferenceMs=20)=>({at,arms:arms(angle,valid),inferenceMs,width:640,height:480});
test('ordinary movement, isolated misses and three fps latency do not report unstable tracking',()=>{
 const events:DiagnosticCode[]=[];const monitor=new TrackingDiagnostics(code=>events.push(code));
 for(let at=0;at<15000;at+=50)monitor.observe(sample(at,Math.sin(at/700)*1.5,at%1050!==0));
 assert.deepEqual(events,[]);monitor.reset();
 for(let at=0;at<15000;at+=330)monitor.observe(sample(at,Math.sin(at/700)*1.5,true,180));
 assert.deepEqual(events,[]);
});
test('repeated violent angle reversals emit one aggregate warning, never the angles',()=>{
 const events:{code:DiagnosticCode;metrics:DiagnosticMetrics}[]=[];const monitor=new TrackingDiagnostics((code,metrics)=>events.push({code,metrics}));
 for(let at=0;at<16000;at+=50)monitor.observe(sample(at,at%100===0?0:2.5));
 assert.equal(events.length,1);assert.equal(events[0].code,'tracking_unstable');assert.ok(events[0].metrics.jumps!>=12);
 assert.ok(!/arms|angle|points|upper|lower/.test(JSON.stringify(events)));
});
test('sustained acquisition loss and stalled output are distinct; framing absence and background resets do not count',()=>{
 const events:DiagnosticCode[]=[];const monitor=new TrackingDiagnostics(code=>events.push(code));
 for(let at=0;at<6000;at+=50){monitor.observe(sample(at,0,false));monitor.poll(at);}assert.deepEqual(events,[]);
 monitor.observe(sample(6000));
 for(let at=6050;at<12000;at+=50){monitor.observe(sample(at,0,false));monitor.poll(at);}assert.deepEqual(events,['tracking_lost']);
 monitor.poll(18000);monitor.poll(19000);assert.deepEqual(events,['tracking_lost','tracking_stalled']);
 monitor.reset();monitor.poll(100000);assert.equal(events.length,2);
});
test('sustained slow inference reports once without labelling slow normal movement unstable',()=>{
 const events:DiagnosticCode[]=[];const monitor=new TrackingDiagnostics(code=>events.push(code));
 for(let at=0;at<16000;at+=400)monitor.observe(sample(at,Math.sin(at/900),true,320));
 assert.deepEqual(events,['tracking_slow']);
});
test('a stopped result stream is not also counted as repeated missing detections',()=>{
 const events:DiagnosticCode[]=[];const monitor=new TrackingDiagnostics(code=>events.push(code));monitor.observe(sample(0));
 for(let at=5000;at<15000;at+=50)monitor.poll(at);
 assert.deepEqual(events,['tracking_stalled']);
});
test('Chromium-based browsers and iOS Chrome are identified separately without exporting a raw user agent',()=>{
 assert.equal(diagnosticBrowser('Chrome/140.0.0.0 Safari/537.36 Edg/140.0.1').name,'Edge');
 assert.equal(diagnosticBrowser('Chrome/140.0.0.0 Safari/537.36 SamsungBrowser/29.0').name,'Samsung Internet');
 assert.deepEqual(diagnosticBrowser('CriOS/140.0.0.0 Mobile/15 Safari/604.1'),{name:'Chrome',version:'140.0.0.0'});
 assert.equal(diagnosticBrowser('Version/26.0 Mobile/15 Safari/604.1').name,'Safari');
});
test('allowlist drops survey text, credentials, request details, media, landmarks and source query strings',()=>{
 const secret='PRIVATE_SENTINEL';const origin='https://cookgame.shogo0x2e.com';
 const result=sanitizeDiagnostic({event_id:'a'.repeat(32),message:secret,request:{url:secret,headers:{Authorization:secret}},user:{email:secret},breadcrumbs:[{message:secret}],extra:{comment:secret,points:secret},
  tags:{diagnostic_code:'pose_inference',error_kind:'TypeError',comment:secret},contexts:{diagnostics:{samples:50,width:640,points:secret},private:{comment:secret}},
  exception:{values:[{type:secret,value:secret,stacktrace:{frames:[{filename:origin+'/assets/app-check.js?token='+secret,function:'detect',lineno:10,vars:{points:secret}}, {filename:'https://external.test/'+secret}]}}]}},
  {experienceId:'7K3M9R',deviceId:'12345678-1234-4123-8123-123456789abc',screen:'game',demo:true},
  {browser:{name:'Chrome'},os:{name:'Android'},device:{model:'SM-F966B'}},'cookgame@test',origin);
 assert.ok(result);assert.ok(!JSON.stringify(result).includes(secret));assert.equal(result.environment,'demo');assert.equal(result.tags?.experience_id,'7K3M9R');
 assert.deepEqual(result.contexts?.diagnostics,{samples:50,width:640});assert.equal(result.exception?.values?.[0].stacktrace?.frames?.length,1);
 assert.equal(result.exception?.values?.[0].stacktrace?.frames?.[0].filename,origin+'/assets/app-check.js');
 assert.equal(result.request,undefined);assert.equal(result.user,undefined);assert.equal(result.breadcrumbs,undefined);assert.equal(result.extra,undefined);
});
test('unknown event categories are rejected and repetition is bounded per document',()=>{
 const device={browser:{name:'Chrome'},os:{name:'Android'},device:{}};
 assert.equal(sanitizeDiagnostic({tags:{diagnostic_code:'unknown'}},{},device,'test','https://test.invalid'),null);
 const limiter=new DiagnosticLimiter();assert.equal(limiter.accept('pose_inference','Error'),true);assert.equal(limiter.accept('pose_inference','Error'),false);
 for(let i=0;i<11;i++)assert.equal(limiter.accept('app_error',String(i)),true);assert.equal(limiter.accept('asset_load','Error'),false);
 assert.equal(diagnosticErrorKind(new Error('arbitrary free text')),'Error');assert.equal(diagnosticErrorKind(new Error('WebAssembly memory access out of bounds')),'memory');
});
