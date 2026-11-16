import { basketWidth, caughtAtBasket, freshEvidence, ingredients, type IngredientId, type Evidence } from './game';
import { PoseCamera, type Tracking } from './pose';

type Options = { input: 'camera' | 'demo'; allowed: IngredientId[]; canPlay: () => boolean; onStatus: (status:'playing'|'paused') => Promise<unknown>; onFinish: (evidence:Evidence) => Promise<unknown> };
export function mountGame(container: HTMLElement, options: Options) {
  const mode = options.input;
  let phase: 'setup'|'playing'|'paused'|'finished' = 'setup';
  let disposed = false;
  let cameraState = mode === 'camera' ? 'idle' : 'ready';
  let cameraMessage = '';
  let poseX: number | null = null;
  let lastPose = 0;
  let lastTracking: Tracking | null = null;
  let evidence = freshEvidence();
  let elapsed = 0, spawnClock = .8, dropIndex = 0, basketX = .5, targetX = .5, lastFrame = 0, animation = 0;
  let drops: {id:IngredientId;x:number;y:number;speed:number;rotation:number}[]=[];
  let pops:{x:number;y:number;emoji:string;life:number}[]=[];
  const duration = 30;
  const $ = <T extends HTMLElement>(selector:string) => container.querySelector<T>(selector);
  container.innerHTML = `<div class="game-heading"><span class="pill">${mode === 'camera' ? 'からだで あそぶ' : 'カメラなし・おためし'}</span><span class="game-counter" id="counter">あと <b>30</b> びょう</span></div><section class="field ${mode === 'camera' ? 'camera-field' : ''}" id="field" aria-label="左右にかごを動かして食材をキャッチ"><video id="camera" autoplay muted playsinline class="camera-video" ${mode === 'demo' ? 'hidden':''}></video><div class="field-tint"></div><canvas id="game-canvas" tabindex="0" role="img" aria-label="食材キャッチの遊び場"></canvas><div id="tracking-note" class="tracking-note" role="status"></div><div class="game-overlay"><div class="overlay-card"><span class="overlay-icon">🧺</span><h2>${mode==='camera'?'上半身を、うつしてね。':'かごを、左右へ。'}</h2><p>${mode==='camera'?'歩かず、ゆっくり左右に動こう。<br>大人とまわりの安全を確認してね。':'指・マウスを左右に動かしてね。<br>とりのがしても、だいじょうぶ。'}</p><p class="camera-status" id="camera-status" role="status">${mode==='camera'?'映像はこのタブレットの中だけで使います。':'映像は使いません。'}</p>${mode==='camera'?'<button class="button primary" data-game="prepare-camera">カメラを じゅんびする</button>':''}<button class="button primary" id="start-button" data-game="start" ${mode==='camera'?'disabled':''}>はじめる →</button></div></div></section><div class="game-bottom"><div class="caught-strip"><span>かごのなか</span><b id="caught-foods">まだ からっぽ</b></div><div class="game-actions"></div></div><p class="game-help">${mode==='camera'?'体の真ん中に、かごがついてくるよ。ゆっくり左右へ。':'指・マウスを左右へ / ← → キーでも動かせます。'}</p>`;
  const canvas = $<HTMLCanvasElement>('#game-canvas')!;
  const field = $('#field')!;
  const camera = new PoseCamera(tracking => { if(disposed)return; lastTracking=tracking;poseX=tracking.x;if(poseX!==null)lastPose=performance.now(); updateTracking(); });
  function updateTracking() {
    const valid=poseX!==null&&performance.now()-lastPose<800;
    const status=$('#camera-status');
    const message=cameraState==='error'?cameraMessage:cameraState==='ready'&&valid?'✓ じゅんびOK！':cameraState==='loading'?'カメラと姿勢モデルを準備中…':cameraState==='ready'?'上半身をうつしてね。':'';
    if(status&&message&&status.textContent!==message)status.textContent=message;
    const start=$<HTMLButtonElement>('#start-button');if(start&&mode==='camera')start.disabled=cameraState!=='ready'||!valid;
  }
  async function prepareCamera() {
    if(cameraState==='loading'||cameraState==='ready')return;
    if(!isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      cameraState='error';cameraMessage='カメラには信頼済みのHTTPSが必要です。大人の画面でカメラなしを選び直すこともできます。';updateTracking();return;
    }
    cameraState='loading';updateTracking();
    const prepare=$<HTMLButtonElement>('[data-game="prepare-camera"]');if(prepare)prepare.disabled=true;
    try { await camera.start($<HTMLVideoElement>('#camera')!); if(disposed)return;cameraState='ready'; if(prepare)prepare.remove();updateTracking(); }
    catch(error){if(disposed)return;camera.stop();cameraState='error'; const name=error instanceof Error?error.name:'';cameraMessage=name==='NotAllowedError'?'カメラが許可されていません。大人の人に確認してね。':name==='NotFoundError'?'カメラが見つかりません。大人の人に確認してね。':!isSecureContext?'カメラには信頼済みのHTTPSが必要です。大人の人に確認してね。':'カメラを使えません。大人の人に確認してね。'; if(prepare){prepare.disabled=false;prepare.textContent='もう一度 じゅんびする';}updateTracking();}
  }
  function refreshActions(){const actions=$('.game-actions');if(actions)actions.innerHTML=phase==='playing'?'<button class="button small secondary" data-game="pause">Ⅱ おやすみ</button><button class="text-button" data-game="finish">ここまでで おわる</button>':'';}
  function pause(message='じゅんびができたら、つづけよう。') {
    if(disposed||phase!=='playing')return;phase='paused';void options.onStatus('paused').catch(()=>{});
    const overlay=document.createElement('div');overlay.className='game-overlay';
    const card=document.createElement('div');card.className='overlay-card';
    card.innerHTML='<h2>ひとやすみ</h2><p></p><button class="button primary" data-game="resume">つづける →</button><button class="text-button" data-game="finish">ここまでで おわる</button>';
    card.querySelector('p')!.textContent=message;overlay.appendChild(card);field.appendChild(overlay);refreshActions();
  }
  async function submitResult(){
    const message=$('#result-message');if(message)message.textContent='結果を大人に送っています…';
    try{await options.onFinish(evidence);}catch{if(disposed)return;if(message)message.textContent='送れませんでした。つながったら、もう一度送ってね。';const retry=$('[data-game="retry-result"]');if(retry)retry.hidden=false;}
  }
  function finish(){if(phase==='finished'||disposed)return;phase='finished';camera.stop();cancelAnimationFrame(animation);container.innerHTML='<div class="child-center"><h1>おしまい！</h1><p id="result-message">結果を大人に送っています…</p><button class="button primary" data-game="retry-result" hidden>もう一度 送る</button></div>';void submitResult();}
function tick(now: number) {
  if (disposed || phase === 'finished' || !canvas || !field) return;
  const dt = lastFrame ? Math.min((now - lastFrame) / 1000, .07) : 0; lastFrame = now;
  const tracked = mode === 'demo' || (poseX !== null && now - lastPose < 800);
  const note = $('#tracking-note');
  if (note) note.textContent = mode === 'camera' && !tracked && phase === 'playing' ? '上半身をうつしてね。時間は止まっているよ。' : '';
  if (mode === 'camera' && poseX !== null) {
    const video = $<HTMLVideoElement>('#camera');
    if (video?.videoWidth) {
      const ratio = Math.max(field.clientWidth / video.videoWidth, field.clientHeight / video.videoHeight);
      const width = video.videoWidth * ratio;
      targetX = Math.min(.91, Math.max(.09, (poseX * width + (field.clientWidth - width) / 2) / field.clientWidth));
    }
  }
  basketX += (targetX - basketX) * (1 - Math.exp(-dt * 13));
  if (phase === 'playing' && tracked) {
    elapsed += dt; spawnClock += dt;
    if (elapsed >= duration) { finish(); return; }
    if (spawnClock >= .95) {
      spawnClock = 0;
      const foods = ingredients.filter(i => options.allowed.includes(i.id));
      const food = foods[dropIndex % foods.length];
      // Cycle through each available ingredient fairly; positions vary between rounds.
      drops.push({ id: food.id, x: .13 + Math.random() * .74, y: -.08, speed: .14 + Math.random() * .025, rotation: Math.random() * .3 - .15 });
      evidence[food.id].offered++; dropIndex++;
    }
    drops = drops.filter(d => {
      const previousY = d.y; d.y += d.speed * dt;
      if (caughtAtBasket({ x: d.x, previousY, y: d.y }, basketX, field!.clientWidth)) {
        evidence[d.id].caught++; pops.push({ x: d.x, y: .78, emoji: ingredients.find(i => i.id === d.id)!.emoji, life: 1 }); updateCaught(); return false;
      }
      return d.y < 1.12;
    });
    pops.forEach(p => { p.life -= dt * 1.5; p.y -= dt * .1; }); pops = pops.filter(p => p.life > 0);
  }
  const counter = $('#counter b'); const seconds = String(Math.max(0, Math.ceil(duration - elapsed))); if (counter && counter.textContent !== seconds) counter.textContent = seconds;
  draw(); animation = requestAnimationFrame(tick);
}
function updateCaught() {
  const caught = ingredients.filter(i => evidence[i.id].caught > 0);
  const text = $('#caught-foods'); if (text) text.textContent = caught.length ? caught.map(i => `${i.emoji} ${evidence[i.id].caught}`).join('  ') : 'まだ からっぽ';
}
function draw() {
  if (!canvas || !field) return;
  const w = field.clientWidth, h = field.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  if (mode === 'camera' && lastTracking?.points.length) {
    const video = $<HTMLVideoElement>('#camera')!;
    if (video.videoWidth) {
      const ratio = Math.max(w / video.videoWidth, h / video.videoHeight), vw = video.videoWidth * ratio, vh = video.videoHeight * ratio;
      ctx.strokeStyle = '#fff9'; ctx.lineWidth = 3;
      for (const [a, b] of [[11,12], [11,13], [13,15], [12,14], [14,16], [11,23], [12,24], [23,24]]) {
        const pa = lastTracking.points[a], pb = lastTracking.points[b];
        if ((pa?.visibility ?? 0) < .6 || (pb?.visibility ?? 0) < .6) continue;
        ctx.beginPath(); ctx.moveTo((1 - pa.x) * vw + (w - vw)/2, pa.y * vh + (h-vh)/2); ctx.lineTo((1 - pb.x) * vw + (w-vw)/2, pb.y * vh+(h-vh)/2); ctx.stroke();
      }
    }
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const drop of drops) {
    const food = ingredients.find(i => i.id === drop.id)!;
    ctx.save(); ctx.translate(drop.x * w, drop.y * h); ctx.rotate(drop.rotation);
    ctx.fillStyle = '#fff9'; ctx.beginPath(); ctx.arc(0, 0, Math.min(w * .036, 33), 0, Math.PI*2); ctx.fill();
    ctx.font = `${Math.min(w * .057, 51)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`; ctx.fillText(food.emoji, 0, 0); ctx.restore();
  }
  // The basket opening crosses the fixed catch line at y=.82.
  const bx = basketX * w, by = .82 * h, bw = basketWidth(w), bh = Math.min(h * .14, 70);
  ctx.fillStyle = '#6d877533'; ctx.beginPath(); ctx.ellipse(bx, by+bh+9, bw*.48, 9, 0, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#966936'; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(bx, by+2, bw*.42, bh*.5, 0, Math.PI, Math.PI*2); ctx.stroke();
  ctx.fillStyle = '#dbaf70'; ctx.beginPath(); ctx.moveTo(bx-bw*.5, by); ctx.lineTo(bx+bw*.5,by); ctx.lineTo(bx+bw*.36,by+bh); ctx.quadraticCurveTo(bx,by+bh+8,bx-bw*.36,by+bh); ctx.closePath(); ctx.fill();
  ctx.save(); ctx.clip(); ctx.strokeStyle = '#b78a52'; ctx.lineWidth = 2;
  for(let i = -4; i < 5; i++){ ctx.beginPath(); ctx.moveTo(bx+i*bw/8, by); ctx.lineTo(bx+i*bw/8+12,by+bh+10); ctx.stroke(); }
  for(let y = 12; y < bh; y += 13){ ctx.beginPath(); ctx.moveTo(bx-bw/2,by+y); ctx.lineTo(bx+bw/2,by+y); ctx.stroke(); } ctx.restore();
  ctx.strokeStyle = '#b08046'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(bx-bw*.5,by); ctx.lineTo(bx+bw*.5,by); ctx.stroke();
  for(const pop of pops){ctx.globalAlpha=pop.life; ctx.fillStyle='#34734c'; ctx.font='bold 24px sans-serif'; ctx.fillText(`${pop.emoji} +1`, pop.x*w,pop.y*h); } ctx.globalAlpha=1;
  if(mode === 'demo' && phase === 'setup'){ctx.fillStyle='#52856488';ctx.font='25px sans-serif';ctx.fillText('←                        →',w/2,h*.72);}
}
  function click(event:Event){
    const action=(event.target as HTMLElement).closest<HTMLElement>('[data-game]')?.dataset.game;
    if(action==='prepare-camera')void prepareCamera();
    if(action==='start'){if(!options.canPlay())return;if(mode==='camera'&&(cameraState!=='ready'||poseX===null||performance.now()-lastPose>=800))return;phase='playing';container.querySelector('.game-overlay')?.remove();refreshActions();canvas.focus({preventScroll:true});void options.onStatus('playing').catch(()=>pause('つながりを確認してから、つづけてね。'));}
    if(action==='pause')pause();
    if(action==='resume'){if(!options.canPlay())return;phase='playing';container.querySelector('.game-overlay')?.remove();refreshActions();canvas.focus({preventScroll:true});void options.onStatus('playing').catch(()=>pause('つながりを確認してから、つづけてね。'));}
    if(action==='finish')finish();
    if(action==='retry-result')void submitResult();
  }
  function pointer(event:PointerEvent){if(mode!=='demo'||!(event.target as HTMLElement).closest('#field')||(event.target as HTMLElement).closest('button'))return;const rect=field.getBoundingClientRect();targetX=Math.max(.09,Math.min(.91,(event.clientX-rect.left)/rect.width));}
  function key(event:KeyboardEvent){if(mode!=='demo'||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();targetX=Math.max(.09,Math.min(.91,targetX+(event.key==='ArrowLeft'?-.07:.07)));}
  function visibility(){if(document.hidden)pause('画面を離れたので、時間を止めたよ。');}
  container.addEventListener('click',click);container.addEventListener('pointermove',pointer);container.addEventListener('pointerdown',pointer);window.addEventListener('keydown',key);document.addEventListener('visibilitychange',visibility);
  animation=requestAnimationFrame(tick);
  return {pause,syncStatus(){if(phase==='playing'||phase==='paused')void options.onStatus(phase).catch(()=>{});},destroy(){disposed=true;camera.stop();cancelAnimationFrame(animation);container.removeEventListener('click',click);container.removeEventListener('pointermove',pointer);container.removeEventListener('pointerdown',pointer);window.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',visibility);}};
}
