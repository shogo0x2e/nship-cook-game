import type { CameraSource, Tracking } from './pose';
import type { Landmark } from './avatar';
export class TrialSampleCamera implements CameraSource {
  private frame = 0;
  private stream?: MediaStream;
  private stopped = false;
  constructor(private callback: (tracking: Tracking) => void) {}
  async start(video: HTMLVideoElement) {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d')!;
    this.stream = canvas.captureStream(30); video.srcObject = this.stream;
    const started=performance.now();
    const tick = (now: number) => {
      if (this.stopped) return;
      const pose:string = now-started<3600?'both':'auto';
      const points: Landmark[] = Array.from({ length: 33 }, () => ({ x: .5, y: .6, visibility: 0 }));
      const put = (i: number, x: number, y: number) => { points[i] = { x, y, visibility: 1 }; };
      put(0, .5, .33); put(7, .43, .31); put(8, .57, .31); put(2, .47, .30); put(5, .53, .30);
      const left = pose === 'both' || pose === 'left' || (pose === 'auto' && Math.sin(now / 1600) < 0);
      const right = pose === 'both' || pose === 'right' || (pose === 'auto' && !left);
      [[11, 13, 15], [12, 14, 16]].forEach(([s, e, w], side) => {
        const lifted = side === 0 ? left : right;
        const upper = side === 0 ? (lifted ? -2.55 : 2.2) : (lifted ? -.59 : .94);
        const lower = side === 0 ? (lifted ? -2.02 : 1.7) : (lifted ? -1.12 : 1.44);
        put(s, side === 0 ? .6 : .4, .58);
        put(e, points[s].x - Math.cos(upper) * 74 / 640, points[s].y + Math.sin(upper) * 74 / 480);
        put(w, points[e].x - Math.cos(lower) * 70 / 640, points[e].y + Math.sin(lower) * 70 / 480);
      });
      for(const [w,ids] of [[15,[17,19,21]],[16,[18,20,22]]] as const)for(const id of ids)put(id,points[w].x,points[w].y-.015);
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
