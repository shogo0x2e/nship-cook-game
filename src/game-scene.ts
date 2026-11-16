import { basketWidth, caughtAtBasket, freshEvidence, ingredients, lanes, maxPairs, pairSchedule, plateCount, plateSize, type IngredientId, type Evidence } from './game';
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
  let basketX = .5, targetX = .5, lastFrame = 0, animation = 0;
  // Feel knobs: fall speed (field heights per second), pause between pairs, and plate celebration length.
  const fallSpeed = .22, pairGap = .5, celebration = 1.5;
  const foods = ingredients.filter(i => options.allowed.includes(i.id)).map(i => i.id);
  const schedule = pairSchedule(foods, maxPairs);
  const emojiOf = (id: IngredientId) => ingredients.find(i => i.id === id)!.emoji;
  // One pair is on screen at a time. The unpicked one floats away ('leaving'); nothing is ever marked wrong.
  let items: {id:IngredientId;x:number;y:number;rotation:number;leaving:boolean;life:number}[] = [];
  let pops: {x:number;y:number;emoji:string;life:number}[] = [];
  let plates: IngredientId[][] = [[]];
  let spawned = 0, gap = .8, celebrate = 0, bounce = 0;
  let audio: AudioContext | null = null;
  const $ = <T extends HTMLElement>(selector:string) => container.querySelector<T>(selector);
  container.innerHTML = `<div class="game-heading"><span class="pill">${mode === 'camera' ? 'からだで あそぶ' : 'カメラなし・おためし'}</span><span class="game-counter" id="counter">おさら <b>1</b> / ${plateCount}</span></div><section class="field ${mode === 'camera' ? 'camera-field' : ''}" id="field" aria-label="左右にかごを動かして、ふたつのうち ひとつを えらぶ"><video id="camera" autoplay muted playsinline class="camera-video" ${mode === 'demo' ? 'hidden':''}></video><div class="field-tint"></div><canvas id="game-canvas" tabindex="0" role="img" aria-label="食材キャッチの遊び場"></canvas><div id="tracking-note" class="tracking-note" role="status"></div><div class="game-overlay"><div class="overlay-card"><span class="overlay-icon">🧺</span><h2>${mode==='camera'?'上半身を、うつしてね。':'かごを、左右へ。'}</h2><p>${mode==='camera'?'ふたつ おちてくるよ。すきなほうを ひとつ。<br>歩かず、ゆっくり左右に動こう。大人と安全を確認してね。':'ふたつ おちてくるよ。すきなほうを ひとつ。<br>どっちでも、とらなくても、だいじょうぶ。'}</p><p class="camera-status" id="camera-status" role="status">${mode==='camera'?'映像はこのタブレットの中だけで使います。':'映像は使いません。'}</p>${mode==='camera'?'<button class="button primary" data-game="prepare-camera">カメラを じゅんびする</button>':''}<button class="button primary" id="start-button" data-game="start" ${mode==='camera'?'disabled':''}>はじめる →</button></div></div></section><div class="game-bottom"><div class="caught-strip"><span>きょうの おさら</span><div class="plates" id="plates"></div></div><div class="game-actions"></div></div><p class="game-help">${mode==='camera'?'体の真ん中に、かごがついてくるよ。おさらに 3つ のせよう。':'指・マウスを左右へ / ← → キーでも動かせます。おさらに 3つ のせよう。'}</p>`;
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
  function finish(){if(phase==='finished'||disposed)return;phase='finished';camera.stop();cancelAnimationFrame(animation);const served=plates.filter(plate=>plate.length);container.innerHTML='<div class="child-center"><h1>おしまい！</h1>'+(served.length?`<div class="result-plates"><span>きょうの おさら</span>${platesHtml(served)}</div>`:'')+'<p id="result-message">結果を大人に送っています…</p><button class="button primary" data-game="retry-result" hidden>もう一度 送る</button></div>';void submitResult();}
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
    bounce = Math.max(0, bounce - dt * 3.5);
    if (celebrate > 0) {
      celebrate -= dt;
      if (celebrate <= 0) { if (plates.length >= plateCount) { finish(); return; } plates.push([]); renderPlates(); }
    } else if (!items.length) {
      gap -= dt;
      if (gap <= 0) { if (spawned >= maxPairs || !foods.length) { finish(); return; } spawn(); }
    }
    const falling = items.filter(item => !item.leaving);
    for (const item of items) {
      if (item.leaving) { item.y -= dt * .22; item.life -= dt * 1.5; }
      else { item.y += fallSpeed * dt; if (item.y > .9) item.life -= dt * 3; }
    }
    const picked = falling.find(item => caughtAtBasket({ x: item.x, previousY: item.y - fallSpeed * dt, y: item.y }, basketX, field.clientWidth));
    if (picked) {
      // Only a decided pair counts as offered: a pair the child let pass says nothing about either food.
      for (const item of falling) { evidence[item.id].offered++; item.leaving = item !== picked; }
      evidence[picked.id].caught++;
      items = items.filter(item => item !== picked);
      const plate = plates[plates.length - 1]; plate.push(picked.id); renderPlates();
      pops.push({ x: picked.x, y: .8, emoji: emojiOf(picked.id), life: 1 }); bounce = 1;
      // The same feedback for every food, so the effect never tells the child which one to want.
      if (plate.length >= plateSize) { celebrate = celebration; [523, 659, 784, 1047].forEach((freq, i) => tone(freq, i * .11, .3)); }
      else { tone(660, 0); tone(880, .08); }
    }
    const before = items.length;
    items = items.filter(item => item.life > 0 && item.y < 1.12);
    if (before && !items.length) gap = pairGap;
    pops.forEach(p => { p.life -= dt * 1.6; }); pops = pops.filter(p => p.life > 0);
  }
  draw(); animation = requestAnimationFrame(tick);
}
function spawn() {
  const ids = schedule.length ? schedule[spawned] : [foods[0]];
  const xs = ids.length === 2 ? lanes : [lanes[spawned % 2]];
  items = ids.map((id, i) => ({ id, x: xs[i], y: -.08, rotation: Math.random() * .3 - .15, leaving: false, life: 1 }));
  spawned++;
}
function platesHtml(list: IngredientId[][], current = -1) {
  return list.map((plate, index) => `<span class="plate${index === current ? ' current' : ''}${plate.length >= plateSize ? ' full' : ''}">${Array.from({ length: plateSize }, (_, slot) => `<i>${plate[slot] ? emojiOf(plate[slot]) : ''}</i>`).join('')}</span>`).join('');
}
function renderPlates() {
  const holder = $('#plates'); if (holder) holder.innerHTML = platesHtml(Array.from({ length: plateCount }, (_, index) => plates[index] ?? []), plates.length - 1);
  const counter = $('#counter b'); if (counter) counter.textContent = String(Math.min(plates.length, plateCount));
}
function startAudio() { try { audio ??= new AudioContext(); void audio.resume(); } catch { audio = null; } }
function tone(freq: number, delay: number, length = .16) {
  if (!audio) return;
  const oscillator = audio.createOscillator(), gain = audio.createGain(), at = audio.currentTime + delay;
  oscillator.frequency.value = freq;
  gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(.16, at + .015); gain.gain.exponentialRampToValueAtTime(.001, at + length);
  oscillator.connect(gain).connect(audio.destination); oscillator.start(at); oscillator.stop(at + length + .02);
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
  const emojiFont = (size: number) => `${size}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  for (const item of items) {
    ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, item.life)); ctx.translate(item.x * w, item.y * h); ctx.rotate(item.rotation);
    ctx.fillStyle = '#fff9'; ctx.beginPath(); ctx.arc(0, 0, Math.min(w * .05, 44), 0, Math.PI*2); ctx.fill();
    ctx.font = emojiFont(Math.min(w * .078, 66)); ctx.fillText(emojiOf(item.id), 0, 0); ctx.restore();
  }
  // The basket opening crosses the fixed catch line at y=.82.
  const bh = Math.min(h * .14, 70), bx = basketX * w, by = .82 * h + Math.sin(bounce * Math.PI) * bh * .16, bw = basketWidth(w);
  ctx.fillStyle = '#6d877533'; ctx.beginPath(); ctx.ellipse(bx, by+bh+9, bw*.48, 9, 0, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#966936'; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(bx, by+2, bw*.42, bh*.5, 0, Math.PI, Math.PI*2); ctx.stroke();
  ctx.fillStyle = '#dbaf70'; ctx.beginPath(); ctx.moveTo(bx-bw*.5, by); ctx.lineTo(bx+bw*.5,by); ctx.lineTo(bx+bw*.36,by+bh); ctx.quadraticCurveTo(bx,by+bh+8,bx-bw*.36,by+bh); ctx.closePath(); ctx.fill();
  ctx.save(); ctx.clip(); ctx.strokeStyle = '#b78a52'; ctx.lineWidth = 2;
  for(let i = -4; i < 5; i++){ ctx.beginPath(); ctx.moveTo(bx+i*bw/8, by); ctx.lineTo(bx+i*bw/8+12,by+bh+10); ctx.stroke(); }
  for(let y = 12; y < bh; y += 13){ ctx.beginPath(); ctx.moveTo(bx-bw/2,by+y); ctx.lineTo(bx+bw/2,by+y); ctx.stroke(); } ctx.restore();
  ctx.strokeStyle = '#b08046'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(bx-bw*.5,by); ctx.lineTo(bx+bw*.5,by); ctx.stroke();
  for (const pop of pops) {
    const grow = 1 - pop.life, size = Math.min(w * .07, 58);
    ctx.globalAlpha = pop.life; ctx.strokeStyle = '#fff'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(pop.x * w, pop.y * h, size * (.6 + grow * 1.1), 0, Math.PI * 2); ctx.stroke();
    ctx.font = emojiFont(size * (1 + grow * .3)); ctx.fillText(pop.emoji, pop.x * w, (pop.y - grow * .12) * h);
  }
  ctx.globalAlpha = 1;
  if (celebrate > 0) {
    const shown = Math.min(1, (celebration - celebrate) * 5, celebrate * 4), scale = .8 + shown * .2, size = Math.min(w * .09, 76);
    ctx.save(); ctx.globalAlpha = shown; ctx.translate(w / 2, h * .4); ctx.scale(scale, scale);
    ctx.fillStyle = '#fffdf5ee'; ctx.beginPath(); ctx.ellipse(0, 0, size * 2.7, size * 1.55, 0, 0, Math.PI * 2); ctx.fill();
    ctx.font = emojiFont(size); ctx.fillText(plates[plates.length - 1].map(emojiOf).join(' '), 0, -size * .4);
    ctx.fillStyle = '#34734c'; ctx.font = `bold ${size * .52}px ui-rounded, "Hiragino Maru Gothic ProN", sans-serif`; ctx.fillText('おさら できた！', 0, size * .72); ctx.restore();
  }
  if(mode === 'demo' && phase === 'setup'){ctx.fillStyle='#52856488';ctx.font='25px sans-serif';ctx.fillText('←                        →',w/2,h*.72);}
}
  function click(event:Event){
    const action=(event.target as HTMLElement).closest<HTMLElement>('[data-game]')?.dataset.game;
    if(action==='prepare-camera')void prepareCamera();
    if(action==='start'){if(!options.canPlay())return;if(mode==='camera'&&(cameraState!=='ready'||poseX===null||performance.now()-lastPose>=800))return;startAudio();phase='playing';container.querySelector('.game-overlay')?.remove();refreshActions();canvas.focus({preventScroll:true});void options.onStatus('playing').catch(()=>pause('つながりを確認してから、つづけてね。'));}
    if(action==='pause')pause();
    if(action==='resume'){if(!options.canPlay())return;startAudio();phase='playing';container.querySelector('.game-overlay')?.remove();refreshActions();canvas.focus({preventScroll:true});void options.onStatus('playing').catch(()=>pause('つながりを確認してから、つづけてね。'));}
    if(action==='finish')finish();
    if(action==='retry-result')void submitResult();
  }
  function pointer(event:PointerEvent){if(mode!=='demo'||!(event.target as HTMLElement).closest('#field')||(event.target as HTMLElement).closest('button'))return;const rect=field.getBoundingClientRect();targetX=Math.max(.09,Math.min(.91,(event.clientX-rect.left)/rect.width));}
  function key(event:KeyboardEvent){if(mode!=='demo'||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();targetX=Math.max(.09,Math.min(.91,targetX+(event.key==='ArrowLeft'?-.07:.07)));}
  function visibility(){if(document.hidden)pause('画面を離れたので、時間を止めたよ。');}
  container.addEventListener('click',click);container.addEventListener('pointermove',pointer);container.addEventListener('pointerdown',pointer);window.addEventListener('keydown',key);document.addEventListener('visibilitychange',visibility);
  renderPlates();animation=requestAnimationFrame(tick);
  return {pause,syncStatus(){if(phase==='playing'||phase==='paused')void options.onStatus(phase).catch(()=>{});},destroy(){disposed=true;void audio?.close().catch(()=>{});camera.stop();cancelAnimationFrame(animation);container.removeEventListener('click',click);container.removeEventListener('pointermove',pointer);container.removeEventListener('pointerdown',pointer);window.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',visibility);}};
}
