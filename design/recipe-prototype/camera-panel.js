export const cameraGuide = `<svg class="body-guide" viewBox="0 0 640 600" aria-hidden="true" focusable="false">
 <g class="guide-outline" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
  <ellipse class="guide-face" cx="320" cy="130" rx="51" ry="63"/>
  <path class="guide-torso" d="M296 190 V215 Q262 219 241 236 M344 190 V215 Q378 219 399 236 M242 298 L237 523 Q320 540 403 523 L398 298"/>
  <path class="guide-arms" d="M241 236 L187 306 L158 208 M242 298 L188 354 Q170 375 155 347 L122 246 M399 236 L453 306 L482 208 M398 298 L452 354 Q470 375 485 347 L518 246"/>
  <path class="guide-hands" d="M158 208 L160 166 Q158 148 145 148 Q132 148 132 168 L130 203 Q125 210 119 203 L109 189 Q100 177 90 184 Q82 191 89 203 L122 246 M482 208 L480 166 Q482 148 495 148 Q508 148 508 168 L510 203 Q515 210 521 203 L531 189 Q540 177 550 184 Q558 191 551 203 L518 246"/>
 </g></svg>`;
export const framingFeedbackHTML=()=>`<div class="camera-detection" aria-label="カメラの自動検出状況">${[['face','顔'],['elbows','両ひじ'],['hands','両手']].map(([id,label])=>`<div class="detection-item" data-part="${id}"><span class="detection-icon" aria-hidden="true">○</span><span>${label}</span><small>未検出</small></div>`).join('')}</div><div class="camera-auto-status"><p class="framing-message" role="status" aria-live="polite">カメラを起動すると、自動で確認します。</p><progress class="framing-progress" max="1" value="0" aria-label="姿勢の確認" hidden></progress></div>`;
export function cameraPanelHTML(){return `<div class="camera-frame camera-auto-frame"><video class="framing-video" autoplay muted playsinline aria-label="鏡映しのカメラプレビュー"></video>${cameraGuide}<p class="framing-hint">顔・両ひじ・両手を画面に入れてください</p></div>${framingFeedbackHTML()}<button type="button" class="primary" data-framing-start>カメラを起動<span aria-hidden="true">→</span></button><p class="camera-error" role="alert"></p>`;}
export function bindFramingFeedback(container,frame){
 const message=container.querySelector('.framing-message'),progress=container.querySelector('progress');
 const countdown=container.querySelector('.framing-countdown');
 const lastParts={face:null,elbows:null,hands:null};let lastText='';
 function update(result){
  for(const id of ['face','elbows','hands']){
   const found=result.status[id];
   if(lastParts[id]===found)continue;
   lastParts[id]=found;
   const item=container.querySelector(`[data-part="${id}"]`);
   item.classList.toggle('is-detected',found);item.querySelector('.detection-icon').textContent=found?'✓':'○';item.querySelector('small').textContent=found?'確認できました':'未検出';
   frame.classList.toggle(`has-${id}`,found);
  }
  if(progress.hidden===result.status.all)progress.hidden=!result.status.all;
  if(progress.value!==result.progress)progress.value=result.progress;
  if(countdown){
   countdown.hidden=!result.status.all;
   const text=String(Math.max(1,Math.ceil((1-result.progress)*2)));
   if(countdown.firstElementChild.textContent!==text)countdown.firstElementChild.textContent=text;
  }
  const missing=[['face','顔'],['elbows','両ひじ'],['hands','両手']].filter(([id])=>!result.status[id]).map(([,label])=>label);
  const next=result.status.all?`そのまま、あと${Math.max(1,Math.ceil((1-result.progress)*2))}秒で始まります。`:`${missing.join('・')}が映るように、少し離れてください。`;
  if(next!==lastText){message.textContent=next;lastText=next;}
 }
 return update;
}
export function mountCameraPanel(container,{onReady,cameraFactory,loadRuntime=()=>import.meta.env?.DEV?import('/src/camera-runtime.ts'):import(/* @vite-ignore */ '/camera-runtime.js')}={}){
 container.innerHTML=cameraPanelHTML();
 const video=container.querySelector('video'),frame=container.querySelector('.camera-frame'),start=container.querySelector('[data-framing-start]'),message=container.querySelector('.framing-message'),error=container.querySelector('.camera-error'),progress=container.querySelector('progress');
 let source=null,gate=null,raf=0,disposed=false,generation=0,busy=false;
 const update=bindFramingFeedback(container,frame);
 async function activate(){
  if(busy||disposed)return;busy=true;error.textContent='';start.disabled=true;start.textContent='準備中…';message.textContent='カメラと姿勢の検出を準備しています…';
  const current=++generation;
  try{
   const runtime=await loadRuntime();if(disposed||current!==generation)return;
   gate=new runtime.FramingGate();
   source=(cameraFactory??(callback=>new runtime.PoseCamera(callback)))(tracking=>{if(!disposed&&current===generation)gate.observe(tracking.points,tracking.capturedAt,performance.now());});
   await source.start(video);if(disposed||current!==generation)return;
   frame.classList.add('has-video');start.hidden=true;busy=false;
   if(video.videoWidth&&video.videoHeight)frame.style.aspectRatio=`${video.videoWidth} / ${video.videoHeight}`;
   const tick=now=>{
    if(disposed||current!==generation)return;
    const result=gate.sample(now,!document.hidden);update(result);
    if(result.advance){message.textContent='確認できました。ゲームが始まります。';void onReady?.();return;}
    raf=requestAnimationFrame(tick);
   };raf=requestAnimationFrame(tick);
  }catch(cause){
   if(disposed||current!==generation)return;
   source?.stop();video.srcObject=null;frame.classList.remove('has-video');busy=false;start.disabled=false;start.hidden=false;start.textContent='もう一度カメラを起動';
   error.textContent=cause?.name==='NotAllowedError'?'カメラが許可されていません。ブラウザの設定を確認してください。':'カメラを準備できませんでした。接続とブラウザの設定を確認してください。';message.textContent='姿勢はまだ確認できていません。';
  }
 }
 start.addEventListener('click',activate);
 return {start:activate,destroy(){disposed=true;generation++;cancelAnimationFrame(raf);source?.stop();video.srcObject=null;start.removeEventListener('click',activate);}};
}
