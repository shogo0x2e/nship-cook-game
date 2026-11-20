import './style.css';
import { mountGame } from './game-scene';
import { ingredients } from './game';
import { type CameraSource, type Tracking } from './pose';
import { type Landmark } from './avatar';

// A separate local review page, with no login, session writes or evidence upload.
const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `<header class="header"><span class="brand">🌱 もぐもぐキャッチ</span><a href="/" class="text-button">家庭アカウントの画面へ</a></header><main class="page game-page"><div class="poc-toolbar"><div><span class="audience">アバターの試作</span><p>カメラで感触を試せます。このページの結果は家庭アカウントには送りません。</p></div><div class="poc-modes"><button class="button small primary" data-mode="camera">カメラで試す</button><button class="button small secondary" data-mode="sample">動きの見本</button><button class="text-button" data-mode="demo">かごで試す</button></div></div><div id="sample-controls" class="sample-controls" hidden><span>見本の動き・カメラ不使用</span><label>動き <select id="sample-pose"><option value="auto">左右に手をのばす</option><option value="left">左だけ上げる</option><option value="right">右だけ上げる</option><option value="both">両手を上げる</option><option value="down" selected>両手を下げる</option><option value="cross">胸の前で腕を曲げる</option><option value="lost">検出が切れたとき</option></select></label></div><div id="preview-game"></div></main>`;
let pose = 'down';
root.querySelector('#sample-pose')!.addEventListener('change', event => { pose = (event.target as HTMLSelectElement).value; });
class SampleCamera implements CameraSource {
  private frame = 0;
  private stream?: MediaStream;
  private stopped = false;
  constructor(private callback: (tracking: Tracking) => void) {}
  async start(video: HTMLVideoElement) {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d')!;
    this.stream = canvas.captureStream(30); video.srcObject = this.stream;
    const tick = (now: number) => {
      if (this.stopped) return;
      const points: Landmark[] = Array.from({ length: 33 }, () => ({ x: .5, y: .6, visibility: 0 }));
      const put = (i: number, x: number, y: number) => { points[i] = { x, y, visibility: pose === 'lost' ? 0 : 1 }; };
      put(0, .5, .33); put(7, .43, .31); put(8, .57, .31); put(2, .47, .30); put(5, .53, .30);
      const left = pose === 'both' || pose === 'left' || (pose === 'auto' && Math.sin(now / 1600) < 0);
      const right = pose === 'both' || pose === 'right' || (pose === 'auto' && !left);
      [[11, 13, 15], [12, 14, 16]].forEach(([s, e, w], side) => {
        const lifted = side === 0 ? left : right;
        const upper = pose === 'cross' ? (side === 0 ? .9 : 2.24) : side === 0 ? (lifted ? -2.55 : 2.2) : (lifted ? -.59 : .94);
        const lower = pose === 'cross' ? (side === 0 ? -.45 : 3.59) : side === 0 ? (lifted ? -2.02 : 1.7) : (lifted ? -1.12 : 1.44);
        put(s, side === 0 ? .6 : .4, .58);
        put(e, points[s].x - Math.cos(upper) * 74 / 640, points[s].y + Math.sin(upper) * 74 / 480);
        put(w, points[e].x - Math.cos(lower) * 70 / 640, points[e].y + Math.sin(lower) * 70 / 480);
      });
      ctx.fillStyle = '#e3e9d6'; ctx.fillRect(0, 0, 640, 480);
      ctx.fillStyle = '#f2dba8'; ctx.beginPath(); ctx.arc(320, 140, 62, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6d563e'; for (const x of [300, 340]) { ctx.beginPath(); ctx.arc(x, 133, 5, 0, Math.PI * 2); ctx.fill(); }
      ctx.lineWidth = 4; ctx.strokeStyle = '#6d563e'; ctx.beginPath(); ctx.arc(320, 146, 21, .15, Math.PI - .15); ctx.stroke();
      ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.strokeStyle = '#9caa7b';
      for (const [a, b] of [[11, 13], [13, 15], [12, 14], [14, 16]]) { ctx.beginPath(); ctx.moveTo(points[a].x * 640, points[a].y * 480); ctx.lineTo(points[b].x * 640, points[b].y * 480); ctx.stroke(); }
      this.callback({ points, width: 640, height: 480, x: .5, inferenceMs: 0, capturedAt: now });
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
    await video.play();
    if (this.stopped) this.stream.getTracks().forEach(track => track.stop());
  }
  stop() { this.stopped = true; cancelAnimationFrame(this.frame); this.stream?.getTracks().forEach(track => track.stop()); }
}
let game: ReturnType<typeof mountGame> | undefined;
function show(mode: string) {
  game?.destroy();
  root.querySelector<HTMLElement>('#sample-controls')!.hidden = mode !== 'sample';
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  const container = root.querySelector<HTMLElement>('#preview-game')!;
  game = mountGame(container, {
    showPreview: true,
    input: mode === 'demo' ? 'demo' : 'camera', allowed: ingredients.map(food => food.id), canPlay: () => true,
    cameraFactory: mode === 'sample' ? callback => new SampleCamera(callback) : undefined,
    onStatus: async () => {},
    onFinish: async evidence => { container.querySelector('#result-message')!.textContent = '試作のおためし、おつかれさま！上のボタンから何度でも試せます。結果は送信していません。'; const detail=document.createElement('details'); detail.className='preview-record'; const summary=document.createElement('summary'); summary.textContent='今回の記録を確認（端末内のみ）'; const data=document.createElement('pre'); data.id='preview-evidence'; data.textContent=JSON.stringify(evidence,null,2); detail.append(summary,data); container.append(detail); },
  });
  if (mode === 'sample') container.querySelector<HTMLButtonElement>('[data-game="prepare-camera"]')!.click();
}
root.addEventListener('click', event => {
  const mode = (event.target as HTMLElement).closest<HTMLElement>('[data-mode]')?.dataset.mode;
  if (mode) show(mode);
});
window.addEventListener('pagehide', () => game?.destroy());
show(new URLSearchParams(location.search).get('mode') === 'camera' ? 'camera' : 'sample');
