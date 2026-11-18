import { basketWidth, caughtAtBasket, freshEvidence, ingredients, lanes, maxPairs, pairSchedule, plateCount, plateSize, type IngredientId, type Evidence } from './game';
import { PoseCamera, type Tracking, type CameraSource } from './pose';
import { avatarLayout, gestureTargets, GestureHold, firstHandCatch, placeArm, poseArms, restingArms, smoothAngle, trackingTimeout, type DrawArm, type Geometry } from './avatar';
import { AvatarRenderer } from './avatar-renderer';
import { challengeSeconds, challengeMaxPairs, catchPoints, challengeScore, type ChallengeResult, type CatchMoment, type PlayVariant } from './challenge';

type Options = { input: 'camera' | 'demo'; variant?:PlayVariant; best?:number; allowed: IngredientId[]; canPlay: () => boolean; onStatus: (status:'playing'|'paused') => Promise<unknown>; onFinish: (evidence:Evidence,challenge?:ChallengeResult) => Promise<unknown>; cameraFactory?: (callback: (tracking: Tracking) => void) => CameraSource };
export function mountGame(container: HTMLElement, options: Options) {
  const mode = options.input;
  const challenge=options.variant==='challenge';
  let activeSeconds=0,spawnAtMs=0,countdown=challenge?3:0;
  const catches:CatchMoment[]=[];
  let result:ChallengeResult|undefined;
  let score=0,scorePulse=0;
  const scorePops:{x:number;y:number;points:number;life:number;plate:boolean}[]=[];
  let phase: 'setup'|'playing'|'paused'|'finished' = 'setup';
  let disposed = false;
  let cameraState = mode === 'camera' ? 'idle' : 'ready';
  let cameraMessage = '';
  let targetArms = restingArms(), displayedArms = restingArms();
  let lastPose = -Infinity, sampleGap = 0;
  let previousHands: DrawArm[] = [], wasTracked = false;
  const gestureHold = new GestureHold();
  let gestureProgress = 0, gestureTarget: number | null = null;
  let assetsReady = mode === 'demo';
  const avatar = mode === 'camera' ? new AvatarRenderer() : null;
  let lastTracking: Tracking | null = null;
  let evidence = freshEvidence();
  let basketX = .5, targetX = .5, lastFrame = 0, animation = 0;
  // Feel knobs: fall speed (field heights per second), pause between pairs, and plate celebration length.
  let fallSpeed = challenge ? .34 : .22;
  const pairGap = challenge ? .18 : .5, celebration = challenge ? .45 : 1.5;
  const foods = ingredients.filter(i => options.allowed.includes(i.id)).map(i => i.id);
  const pairLimit=challenge?challengeMaxPairs:maxPairs;
  const schedule = pairSchedule(foods, pairLimit);
  const emojiOf = (id: IngredientId) => ingredients.find(i => i.id === id)!.emoji;
  // One pair is on screen at a time. The unpicked one floats away ('leaving'); nothing is ever marked wrong.
  let items: {id:IngredientId;x:number;y:number;rotation:number;leaving:boolean;life:number}[] = [];
  let pops: {x:number;y:number;emoji:string;life:number}[] = [];
  let plates: IngredientId[][] = [[]];
  let spawned = 0, gap = .8, celebrate = 0, bounce = 0;
  let audio: AudioContext | null = null;
  const $ = <T extends HTMLElement>(selector:string) => container.querySelector<T>(selector);
  container.innerHTML = `<div class="game-heading"><span class="pill">${mode === 'camera' ? 'すきなほうへ、てをのばそう！' : 'カメラなし・おためし'}</span><span class="game-counter" id="counter">おさら <b>1</b> / ${plateCount}</span></div><section class="field ${mode === 'camera' ? 'camera-field' : ''}" id="field" aria-label="${mode === 'camera' ? '座ったまま手を伸ばして、ふたつのうち ひとつを えらぶ' : '左右にかごを動かして、ふたつのうち ひとつを えらぶ'}"><video id="camera" autoplay muted playsinline class="camera-video avatar-source" ${mode === 'demo' ? 'hidden':''}></video><div class="field-tint"></div><canvas id="game-canvas" tabindex="0" role="img" aria-label="食材キャッチの遊び場"></canvas><div id="tracking-note" class="tracking-note" role="status"></div><div class="game-overlay setup-overlay"><div class="overlay-card"><span class="overlay-icon">${mode === 'camera' ? '🌱' : '🧺'}</span><h2>${mode==='camera'?'すわって、てをのばそう。':'かごを、左右へ。'}</h2><p>${mode==='camera'?'顔と両ひじ・両手が うつるようにしてね。<br>肩より上に手をのばして、すきな食材にタッチ。<br>どっちでも、とらなくても、だいじょうぶ。':'ふたつ おちてくるよ。すきなほうを ひとつ。<br>どっちでも、とらなくても、だいじょうぶ。'}</p><p class="camera-status" id="camera-status" role="status">${mode==='camera'?'映像はこのタブレットの中だけで使います。':'映像は使いません。'}</p>${mode==='camera'?'<button class="button primary" data-game="prepare-camera">カメラを じゅんびする</button>':''}<button class="button primary" id="start-button" data-game="start" ${mode==='camera'?'disabled':''}>はじめる →</button></div></div></section><div class="game-bottom"><div class="caught-strip"><span>きょうの おさら</span><div class="plates" id="plates"></div></div><div class="game-actions"></div></div><p class="game-help">${mode==='camera'?'すわったまま、肩より上に手をのばしてね。手の輪がタッチの目印だよ。':'指・マウスを左右へ / ← → キーでも動かせます。おさらに 3つ のせよう。'}</p>${mode === 'camera' ? '<details class="tracking-debug"><summary>大人向け：カメラと検出の確認</summary><div class="debug-content"><canvas id="pose-debug" width="320" height="240" aria-label="端末内のカメラと肩・肘・手首の検出"></canvas><div><p id="pose-metrics"></p><p>緑の点：検出できています。点が途切れたら、顔と両ひじ・両手が入るようにカメラを調整してください。立ったり歩いたりする必要はありません。</p><p>この映像・点・顔画像は端末内だけで使い、送信・保存しません。</p></div></div></details>' : ''}`;
  const canvas = $<HTMLCanvasElement>('#game-canvas')!;
  const field = $('#field')!;
  if(challenge){
    container.classList.add('challenge-game');field.dataset.variant='challenge';
    $('#counter')!.innerHTML=`あと <b id="challenge-time">${challengeSeconds}</b> 秒`;
    const hud=document.createElement('div');hud.className='challenge-hud';
    hud.innerHTML=`<div><span>SCORE</span><strong id="live-score">0</strong></div><div class="live-best"><span>自己ベスト</span><strong>${(options.best??0).toLocaleString('ja-JP')}</strong><span id="best-target">${options.best?'記録をこえよう':'はじめての記録をつくろう'}</span></div><progress id="challenge-clock" max="${challengeSeconds}" value="${challengeSeconds}" aria-label="残り時間"></progress>`;
    field.before(hud);
    $('.setup-overlay h2')!.textContent='45秒、好きな食材をキャッチ。';
    $('.setup-overlay .overlay-card>p')!.innerHTML='すばやく取るとボーナス。3個でおさら完成！<br>どの食材も同じ点。見送りの減点はありません。';
    $('.game-help')!.textContent=mode==='camera'?'好きなほうへ手をのばそう。カメラが見失った間は、時間も止まります。':'指・マウス・← → キーで移動。見送っても減点なし。';
  }
  const video = $<HTMLVideoElement>('#camera')!;
  const camera = (options.cameraFactory ?? (callback => new PoseCamera(callback)))(tracking => {
    if (disposed) return;
    if (lastTracking) sampleGap = tracking.capturedAt - lastTracking.capturedAt;
    lastTracking = tracking; lastPose = tracking.capturedAt;
    targetArms = poseArms(tracking.points, tracking.width, tracking.height);
    avatar?.updateFace(tracking.points, video, performance.now());
    updateTracking();
  });
  void avatar?.ready.then(() => { if (!disposed) { assetsReady = true; updateTracking(); } }).catch(() => {
    if (!disposed) { cameraState = 'error'; cameraMessage = '絵を読み込めませんでした。ページを再読み込みしてください。'; updateTracking(); }
  });
  const isTracked = () => targetArms.every(arm => arm.valid) && performance.now() - lastPose < trackingTimeout;
  function updateTracking() {
    const valid = isTracked();
    const status = $('#camera-status');
    const message = cameraState === 'error' ? cameraMessage : cameraState === 'loading' ? 'カメラと姿勢モデルを準備中…' : !assetsReady ? '絵を準備中…' : cameraState === 'ready' && valid ? '手をかさねて、輪がいっぱいになるまで まってね。' : cameraState === 'ready' ? '顔と両ひじ・両手を、うつしてね。' : '';
    if (status && message && status.textContent !== message) status.textContent = message;
    if (mode === 'camera') for (const button of container.querySelectorAll<HTMLButtonElement>('[data-game="start"], [data-game="resume"]')) button.disabled = cameraState !== 'ready' || !valid || !assetsReady || !options.canPlay();
  }
  async function prepareCamera() {
    if(cameraState==='loading'||cameraState==='ready')return;
    if(!options.cameraFactory && (!isSecureContext || !navigator.mediaDevices?.getUserMedia)) {
      cameraState='error';cameraMessage='カメラには信頼済みのHTTPSが必要です。大人の画面でカメラなしを選び直すこともできます。';updateTracking();return;
    }
    cameraState='loading';updateTracking();
    const prepare=$<HTMLButtonElement>('[data-game="prepare-camera"]');if(prepare)prepare.disabled=true;
    try { await camera.start($<HTMLVideoElement>('#camera')!); if(disposed)return;cameraState='ready'; field.classList.add('camera-prepared'); showGestureControls('start'); updateTracking(); }
    catch(error){if(disposed)return;camera.stop();cameraState='error'; const name=error instanceof Error?error.name:'';cameraMessage=name==='NotAllowedError'?'カメラが許可されていません。大人の人に確認してね。':name==='NotFoundError'?'カメラが見つかりません。大人の人に確認してね。':!isSecureContext?'カメラには信頼済みのHTTPSが必要です。大人の人に確認してね。':'カメラを使えません。大人の人に確認してね。'; if(prepare){prepare.disabled=false;prepare.textContent='もう一度 じゅんびする';}updateTracking();}
  }
  function showGestureControls(action: 'start' | 'resume', message = '') {
    container.querySelector('.game-overlay')?.remove();
    gestureHold.reset(action === 'resume'); gestureProgress = 0; gestureTarget = null;
    const overlay = document.createElement('div'); overlay.className = 'game-overlay gesture-overlay';
    const label = action === 'start' ? 'はじめる' : 'つづける';
    overlay.innerHTML = `${action === 'resume' ? '<h2 class="gesture-title">ひとやすみ</h2><p class="gesture-message"></p>' : '<p id="camera-status" class="gesture-message" role="status"></p>'}<p class="gesture-help">どちらかの「${label}」に、手をかさねよう</p>${[0,1].map(side => `<button type="button" ${side === 0 && action === 'start' ? 'id="start-button"' : ''} class="gesture-button" data-game="${action}" data-gesture-side="${side}" aria-label="${label}（${side === 0 ? '左' : '右'}）。手を重ねるか、タップしてください。">${label}</button>`).join('')}${action === 'resume' ? '<button class="text-button gesture-finish" data-game="finish">ここまでで おわる</button>' : ''}`;
    if (message) overlay.querySelector('.gesture-message')!.textContent = message;
    field.appendChild(overlay); positionGestureButtons();
  }
  function positionGestureButtons() {
    const targets = gestureTargets(avatarLayout(field.clientWidth, field.clientHeight));
    container.querySelectorAll<HTMLButtonElement>('[data-gesture-side]').forEach(button => {
      const target = targets[Number(button.dataset.gestureSide)];
      button.style.left = `${target.x-target.radius}px`; button.style.top = `${target.y-target.radius}px`;
      button.style.width = button.style.height = `${target.radius*2}px`;
    });
  }
  function beginPlaying() {
    if (disposed || !['setup', 'paused'].includes(phase) || !options.canPlay()) return;
    if (mode === 'camera' && (cameraState !== 'ready' || !assetsReady || !isTracked())) return;
    startAudio(); phase = 'playing'; gestureHold.reset(); gestureProgress = 0; gestureTarget = null;
    previousHands = []; wasTracked = false;
    container.querySelector('.game-overlay')?.remove(); refreshActions(); canvas.focus({preventScroll:true});
    void options.onStatus('playing').catch(() => pause('つながりを確認してから、つづけてね。'));
  }
  function updateGesture(hands: DrawArm[], layout: Geometry, dt: number, tracked: boolean) {
    if (mode !== 'camera' || cameraState !== 'ready' || (phase !== 'setup' && phase !== 'paused')) return;
    if (!tracked || !options.canPlay()) {
      gestureHold.reset(phase === 'paused'); gestureProgress = 0; gestureTarget = null;
      field.dataset.gestureProgress = '0'; return;
    }
    const targets = gestureTargets(layout);
    // A stationary overlap is deliberate; a fly-by or a missing/stale pose resets the dwell.
    const target = targets.findIndex(target => hands.some(hand => hand.active && Math.hypot(hand.hand.x-target.x,hand.hand.y-target.y) <= target.radius + layout.handRadius*.5));
    gestureTarget = target < 0 ? null : target;
    gestureProgress = gestureHold.update(gestureTarget, dt);
    field.dataset.gestureProgress = String(gestureProgress);
    if (gestureProgress >= 1) beginPlaying();
  }
  function drawGestureButtons(ctx: CanvasRenderingContext2D, layout: Geometry) {
    if (mode !== 'camera' || cameraState !== 'ready' || (phase !== 'setup' && phase !== 'paused')) return;
    const ready = assetsReady && isTracked() && options.canPlay();
    const label = phase === 'setup' ? 'はじめる' : 'つづける';
    const targets = gestureTargets(layout);
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    targets.forEach((target,i) => {
      ctx.fillStyle = ready ? '#de735d' : '#dbb4a2'; ctx.strokeStyle = '#fff9e9'; ctx.lineWidth = 4 * layout.scale;
      ctx.beginPath(); ctx.arc(target.x,target.y,target.radius,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fffdf3'; ctx.font = `bold ${Math.max(12,16*layout.scale)}px ui-rounded, sans-serif`; ctx.fillText(label,target.x,target.y);
      if (gestureTarget === i && gestureProgress > 0) {
        ctx.strokeStyle = '#fffdf3'; ctx.lineWidth = Math.max(4,6*layout.scale); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(target.x,target.y,target.radius+7*layout.scale,-Math.PI/2,-Math.PI/2+Math.PI*2*gestureProgress); ctx.stroke();
      }
    }); ctx.restore();
  }
  function refreshActions(){const actions=$('.game-actions');if(actions)actions.innerHTML=phase==='playing'?'<button class="button small secondary" data-game="pause">Ⅱ おやすみ</button><button class="text-button" data-game="finish">ここまでで おわる</button>':'';}
  function pause(message='じゅんびができたら、つづけよう。') {
    if(disposed||phase!=='playing')return;phase='paused';void options.onStatus('paused').catch(()=>{});
    if(mode==='camera'){showGestureControls('resume',message);refreshActions();return;}
    const overlay=document.createElement('div');overlay.className='game-overlay';
    const card=document.createElement('div');card.className='overlay-card';
    card.innerHTML='<h2>ひとやすみ</h2><p></p><button class="button primary" data-game="resume">つづける →</button><button class="text-button" data-game="finish">ここまでで おわる</button>';
    card.querySelector('p')!.textContent=message;overlay.appendChild(card);field.appendChild(overlay);refreshActions();
  }
  async function submitResult(){
    const message=$('#result-message');if(message)message.textContent='結果を大人に送っています…';
    try{await options.onFinish(evidence,result);}catch{if(disposed)return;if(message)message.textContent='送れませんでした。つながったら、もう一度送ってね。';const retry=$('[data-game="retry-result"]');if(retry)retry.hidden=false;}
  }
  function finish(completed=false){if(phase==='finished'||disposed)return;phase='finished';if(challenge)result={activeMs:completed?challengeSeconds*1000:Math.min(challengeSeconds*1000,Math.round(activeSeconds*1000)),completed,catches:[...catches]};camera.stop();video.srcObject=null;void audio?.close().catch(()=>{});audio=null;avatar?.destroy();cancelAnimationFrame(animation);const served=plates.filter(plate=>plate.length);container.innerHTML='<div class="child-center"><h1>おしまい！</h1>'+(served.length?`<div class="result-plates"><span>きょうの おさら</span>${platesHtml(served)}</div>`:'')+'<p id="result-message">結果を大人に送っています…</p><button class="button primary" data-game="retry-result" hidden>もう一度 送る</button></div>';void submitResult();}
function tick(now: number) {
  if (disposed || phase === 'finished' || !canvas || !field) return;
  const dt = lastFrame ? Math.min((now - lastFrame) / 1000, .07) : 0; lastFrame = now;
  const tracked = mode === 'demo' || (assetsReady && cameraState === 'ready' && isTracked());
  const layout = avatarLayout(field.clientWidth, field.clientHeight);
  if (mode === 'camera') {
    updateTracking();
    displayedArms = targetArms.map((arm, i) => arm.valid && now-lastPose < trackingTimeout ? { ...arm, upper: smoothAngle(displayedArms[i].upper, arm.upper, dt), lower: smoothAngle(displayedArms[i].lower, arm.lower, dt) } : { ...displayedArms[i], valid: false, raised: false }) as typeof targetArms;
  }
  const hands = displayedArms.map((arm, i) => placeArm({ ...arm, valid: tracked && arm.valid }, i, layout));
  const note = $('#tracking-note');
  if (note) note.textContent = mode === 'camera' && !tracked && phase === 'playing' ? '両ひじと両手をうつしてね。時間は止まっているよ。' : '';
  if (mode === 'camera') field.dataset.tracked = String(tracked);
  field.dataset.phase = phase;
  updateGesture(hands, layout, dt, tracked);
  basketX += (targetX - basketX) * (1 - Math.exp(-dt * 13));
  if (phase === 'playing' && tracked) {
    if(challenge&&countdown>0){
      const previous=Math.ceil(countdown);countdown=Math.max(0,countdown-dt);
      if(Math.ceil(countdown)!==previous)tone(countdown===0?1047:523,0,.1);
      draw();drawDebug(now);animation=requestAnimationFrame(tick);return;
    }
    if(challenge){
      activeSeconds=Math.min(challengeSeconds,activeSeconds+dt);field.dataset.activeMs=String(Math.round(activeSeconds*1000));
      const left=Math.ceil(challengeSeconds-activeSeconds);$('#challenge-time')!.textContent=String(left);
      ($<HTMLProgressElement>('#challenge-clock')!).value=challengeSeconds-activeSeconds;
      field.classList.toggle('last-seconds',left<=10);
      if(activeSeconds>=challengeSeconds){finish(true);return;}
      fallSpeed=.34+.14*(activeSeconds/challengeSeconds);
      scorePulse=Math.max(0,scorePulse-dt*3);
      scorePops.forEach(pop=>pop.life-=dt*1.2);for(let i=scorePops.length-1;i>=0;i--)if(scorePops[i].life<=0)scorePops.splice(i,1);
    }
    bounce = Math.max(0, bounce - dt * 3.5);
    if (celebrate > 0) {
      celebrate -= dt;
      if (celebrate <= 0) { if (!challenge&&plates.length >= plateCount) { finish(); return; } plates.push([]); renderPlates(); }
    } else if (!items.length) {
      gap -= dt;
      if (gap <= 0) { if (!foods.length||(!challenge&&spawned>=pairLimit)) { finish(); return; } if(spawned<pairLimit)spawn(); }
    }
    const falling = items.filter(item => !item.leaving);
    for (const item of items) {
      if (item.leaving) { item.y -= dt * .22; item.life -= dt * 1.5; }
      else { item.y += fallSpeed * dt; if (item.y > .9) item.life -= dt * 3; }
    }
    const handPick = mode === 'camera' ? firstHandCatch(
      falling.map(item => ({ before: { x: item.x * field.clientWidth, y: (item.y - fallSpeed * dt) * field.clientHeight }, after: { x: item.x * field.clientWidth, y: item.y * field.clientHeight } })),
      hands.map((hand, i) => ({ before: wasTracked && previousHands[i]?.active ? previousHands[i].hand : hand.hand, after: hand.hand, active: hand.active })),
      layout.handRadius + layout.foodRadius, spawned % 2,
    ) : null;
    const picked = mode === 'camera' ? (handPick === null ? undefined : falling[handPick]) : falling.find(item => caughtAtBasket({ x: item.x, previousY: item.y - fallSpeed * dt, y: item.y }, basketX, field.clientWidth));
    if (picked) {
      // Only a decided pair counts as offered: a pair the child let pass says nothing about either food.
      for (const item of falling) { evidence[item.id].offered++; item.leaving = item !== picked; }
      evidence[picked.id].caught++;
      items = items.filter(item => item !== picked);
      const plate = plates[plates.length - 1]; plate.push(picked.id); renderPlates();
      if(challenge){
        const atMs=Math.round(activeSeconds*1000),reactionMs=Math.max(0,atMs-spawnAtMs);
        catches.push({atMs,reactionMs});score=challengeScore(catches);scorePulse=1;
        const plateBonus=plate.length===plateSize;
        scorePops.push({x:picked.x,y:mode==='camera'?picked.y:.78,points:catchPoints(reactionMs)+(plateBonus?150:0),life:1,plate:plateBonus});
        $('#live-score')!.textContent=score.toLocaleString('ja-JP');
        $('#best-target')!.textContent=score>(options.best??0)?'完走で自己ベスト！':`あと${((options.best??0)-score+1).toLocaleString('ja-JP')}点で更新`;
        $('.challenge-hud')!.classList.remove('score-bump');void $('.challenge-hud')!.offsetWidth;$('.challenge-hud')!.classList.add('score-bump');
      }
      pops.push({ x: picked.x, y: mode === 'camera' ? picked.y : .8, emoji: emojiOf(picked.id), life: 1 }); bounce = 1;
      // The same feedback for every food, so the effect never tells the child which one to want.
      if (plate.length >= plateSize) { celebrate = celebration; [523, 659, 784, 1047].forEach((freq, i) => tone(freq, i * .11, .3)); }
      else { tone(660, 0); tone(880, .08); }
    }
    const before = items.length;
    items = items.filter(item => item.life > 0 && item.y < 1.12);
    if (before && !items.length) gap = pairGap;
    pops.forEach(p => { p.life -= dt * 1.6; }); pops = pops.filter(p => p.life > 0);
  }
  previousHands = hands; wasTracked = tracked && phase === 'playing';
  draw(); drawDebug(now); animation = requestAnimationFrame(tick);
}
function spawn() {
  spawnAtMs=Math.round(activeSeconds*1000);
  const ids = schedule.length ? schedule[spawned] : [foods[0]];
  const positions = mode === 'camera' ? avatarLayout(field.clientWidth, field.clientHeight).lanes : lanes;
  const xs = ids.length === 2 ? positions : [positions[spawned % 2]];
  items = ids.map((id, i) => ({ id, x: xs[i], y: -.08, rotation: Math.random() * .3 - .15, leaving: false, life: 1 }));
  spawned++;
}
function platesHtml(list: IngredientId[][], current = -1) {
  return list.map((plate, index) => `<span class="plate${index === current ? ' current' : ''}${plate.length >= plateSize ? ' full' : ''}">${Array.from({ length: plateSize }, (_, slot) => `<i>${plate[slot] ? emojiOf(plate[slot]) : ''}</i>`).join('')}</span>`).join('');
}
function renderPlates() {
  const holder = $('#plates'); if (holder) holder.innerHTML = challenge?platesHtml(plates.slice(-3),Math.min(plates.length,3)-1):platesHtml(Array.from({ length: plateCount }, (_, index) => plates[index] ?? []), plates.length - 1);
  const counter = $('#counter b'); if (counter&&!challenge) counter.textContent = String(Math.min(plates.length, plateCount));
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
  const layout = avatarLayout(w, h);
  if (avatar) {
    avatar.background(ctx, w, h);
    drawGestureButtons(ctx, layout);
    avatar.draw(ctx, layout, displayedArms.map((arm, i) => placeArm(arm, i, layout)), cameraState === 'ready' && !displayedArms.some(arm => arm.valid), performance.now());
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const emojiFont = (size: number) => `${size}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  for (const item of items) {
    ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, item.life)); ctx.translate(item.x * w, item.y * h); ctx.rotate(item.rotation);
    ctx.fillStyle = '#fff9'; ctx.beginPath(); ctx.arc(0, 0, mode === 'camera' ? layout.foodRadius : Math.min(w * .05, 44), 0, Math.PI*2); ctx.fill();
    ctx.font = emojiFont(mode === 'camera' ? layout.foodRadius * 1.5 : Math.min(w * .078, 66)); ctx.fillText(emojiOf(item.id), 0, 0); ctx.restore();
  }
  if (mode === 'demo') {
  // The basket opening crosses the fixed catch line at y=.82.
  const bh = Math.min(h * .14, 70), bx = basketX * w, by = .82 * h + Math.sin(bounce * Math.PI) * bh * .16, bw = basketWidth(w);
  ctx.fillStyle = '#6d877533'; ctx.beginPath(); ctx.ellipse(bx, by+bh+9, bw*.48, 9, 0, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#966936'; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(bx, by+2, bw*.42, bh*.5, 0, Math.PI, Math.PI*2); ctx.stroke();
  ctx.fillStyle = '#dbaf70'; ctx.beginPath(); ctx.moveTo(bx-bw*.5, by); ctx.lineTo(bx+bw*.5,by); ctx.lineTo(bx+bw*.36,by+bh); ctx.quadraticCurveTo(bx,by+bh+8,bx-bw*.36,by+bh); ctx.closePath(); ctx.fill();
  ctx.save(); ctx.clip(); ctx.strokeStyle = '#b78a52'; ctx.lineWidth = 2;
  for(let i = -4; i < 5; i++){ ctx.beginPath(); ctx.moveTo(bx+i*bw/8, by); ctx.lineTo(bx+i*bw/8+12,by+bh+10); ctx.stroke(); }
  for(let y = 12; y < bh; y += 13){ ctx.beginPath(); ctx.moveTo(bx-bw/2,by+y); ctx.lineTo(bx+bw/2,by+y); ctx.stroke(); } ctx.restore();
  ctx.strokeStyle = '#b08046'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(bx-bw*.5,by); ctx.lineTo(bx+bw*.5,by); ctx.stroke();
  }
  for (const pop of pops) {
    const grow = 1 - pop.life, size = Math.min(w * .07, 58);
    ctx.globalAlpha = pop.life; ctx.strokeStyle = '#fff'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(pop.x * w, pop.y * h, size * (.6 + grow * 1.1), 0, Math.PI * 2); ctx.stroke();
    ctx.font = emojiFont(size * (1 + grow * .3)); ctx.fillText(pop.emoji, pop.x * w, (pop.y - grow * .12) * h);
  }
  ctx.globalAlpha = 1;
  if(challenge){
    for(const pop of scorePops){
      ctx.save();ctx.globalAlpha=Math.max(0,pop.life);ctx.translate(pop.x*w,(pop.y-(1-pop.life)*.14)*h);
      ctx.fillStyle=pop.plate?'#a04712':'#245a3e';ctx.strokeStyle='#fffdf5';ctx.lineWidth=6;
      ctx.font=`900 ${Math.min(w*.065,42)*(1+scorePulse*.1)}px ui-rounded,sans-serif`;
      ctx.strokeText(`+${pop.points}`,0,0);ctx.fillText(`+${pop.points}`,0,0);
      if(pop.plate){ctx.font=`bold ${Math.min(w*.03,20)}px sans-serif`;ctx.fillText('おさら完成！',0,28);}
      ctx.restore();
    }
    if(countdown>0&&phase==='playing'){
      ctx.save();ctx.fillStyle='#fffdf5dc';ctx.fillRect(0,0,w,h);ctx.fillStyle='#285e42';
      ctx.font=`900 ${Math.min(w*.2,120)}px ui-rounded,sans-serif`;ctx.fillText(String(Math.ceil(countdown)),w/2,h*.43);
      ctx.font='bold 20px sans-serif';ctx.fillText('好きなほうを、すばやくキャッチ',w/2,h*.57);ctx.restore();
    }
  }
  if (celebrate > 0) {
    const shown = Math.min(1, (celebration - celebrate) * 5, celebrate * 4), scale = .8 + shown * .2, size = Math.min(w * .09, 76);
    ctx.save(); ctx.globalAlpha = shown; ctx.translate(w / 2, h * .4); ctx.scale(scale, scale);
    ctx.fillStyle = '#fffdf5ee'; ctx.beginPath(); ctx.ellipse(0, 0, size * 2.7, size * 1.55, 0, 0, Math.PI * 2); ctx.fill();
    ctx.font = emojiFont(size); ctx.fillText(plates[plates.length - 1].map(emojiOf).join(' '), 0, -size * .4);
    ctx.fillStyle = '#34734c'; ctx.font = `bold ${size * .52}px ui-rounded, "Hiragino Maru Gothic ProN", sans-serif`; ctx.fillText('おさら できた！', 0, size * .72); ctx.restore();
  }
  if(mode === 'demo' && phase === 'setup'){ctx.fillStyle='#52856488';ctx.font='25px sans-serif';ctx.fillText('←                        →',w/2,h*.72);}
}
  function drawDebug(now: number) {
    const detail = $<HTMLDetailsElement>('.tracking-debug');
    if (!detail?.open) return;
    const debug = $<HTMLCanvasElement>('#pose-debug')!, ctx = debug.getContext('2d')!;
    ctx.clearRect(0, 0, 320, 240);
    if (video.readyState >= 2) { ctx.save(); ctx.translate(320, 0); ctx.scale(-1, 1); ctx.drawImage(video, 0, 0, 320, 240); ctx.restore(); }
    ctx.lineWidth = 3;
    for (const [a, b] of [[11, 13], [13, 15], [12, 14], [14, 16]]) {
      const p = lastTracking?.points[a], q = lastTracking?.points[b];
      if (!p || !q || (p.visibility ?? 0) < .55 || (q.visibility ?? 0) < .55) continue;
      ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo((1-p.x)*320,p.y*240); ctx.lineTo((1-q.x)*320,q.y*240); ctx.stroke();
      for (const point of [p,q]) { ctx.fillStyle = '#4bc59b'; ctx.beginPath(); ctx.arc((1-point.x)*320,point.y*240,5,0,Math.PI*2); ctx.fill(); }
    }
    const metrics = $('#pose-metrics')!;
    const labels = targetArms.map((arm, i) => `${i === 0 ? '画面の左手' : '画面の右手'}：${!arm.valid ? '検出待ち' : arm.raised ? 'タッチできます' : '肩より上へ'}`);
    metrics.textContent = `${labels.join(' ／ ')}。推論 ${Math.round(lastTracking?.inferenceMs ?? 0)} ms ・更新 ${sampleGap > 0 ? Math.round(1000 / sampleGap) : 0} 回/秒 ・最新データ ${Number.isFinite(lastPose) ? Math.round(now-lastPose) : '—'} ms前（画面までの遅れとは異なります）。`;
  }
  function click(event:Event){
    const action=(event.target as HTMLElement).closest<HTMLElement>('[data-game]')?.dataset.game;
    if(action==='prepare-camera'){if(event.isTrusted)startAudio();void prepareCamera();}
    if(action==='start'||action==='resume')beginPlaying();
    if(action==='pause')pause();
    if(action==='finish')finish();
    if(action==='retry-result')void submitResult();
  }
  function pointer(event:PointerEvent){if(mode!=='demo'||!(event.target as HTMLElement).closest('#field')||(event.target as HTMLElement).closest('button'))return;const rect=field.getBoundingClientRect();targetX=Math.max(.09,Math.min(.91,(event.clientX-rect.left)/rect.width));}
  function key(event:KeyboardEvent){if(mode!=='demo'||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();targetX=Math.max(.09,Math.min(.91,targetX+(event.key==='ArrowLeft'?-.07:.07)));}
  function resize(){ positionGestureButtons(); gestureHold.reset(phase === 'paused'); gestureProgress=0; previousHands = []; wasTracked = false; if(mode === 'camera'){const xs=avatarLayout(field.clientWidth,field.clientHeight).lanes;for(const item of items)item.x=xs[item.x<.5?0:1];}}
  window.addEventListener('resize',resize);
  function visibility(){if(document.hidden)pause('画面を離れたので、時間を止めたよ。');}
  container.addEventListener('click',click);container.addEventListener('pointermove',pointer);container.addEventListener('pointerdown',pointer);window.addEventListener('keydown',key);document.addEventListener('visibilitychange',visibility);
  renderPlates();animation=requestAnimationFrame(tick);
  return {pause,syncStatus(){if(phase==='playing'||phase==='paused')void options.onStatus(phase).catch(()=>{});},destroy(){disposed=true;window.removeEventListener('resize',resize);void audio?.close().catch(()=>{});camera.stop();video.srcObject=null;avatar?.destroy();cancelAnimationFrame(animation);container.removeEventListener('click',click);container.removeEventListener('pointermove',pointer);container.removeEventListener('pointerdown',pointer);window.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',visibility);}};
}
