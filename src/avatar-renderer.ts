import { faceCrop, type Crop, type DrawArm, type Geometry, type Landmark, type Point } from './avatar';

type Sprite = { image: HTMLImageElement; x: number; y: number; width: number; height: number };
async function sprite(name: string): Promise<Sprite> {
  const image = new Image(); image.src = `/avatar/${name}.png`; await image.decode();
  if (name === 'background') return { image, x: 0, y: 0, width: image.width, height: image.height };
  // Generated transparent sprites have margins; trim only their drawing rectangle in memory.
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
  let x = image.width, y = image.height, right = 0, bottom = 0;
  for (let row = 0; row < image.height; row++) for (let col = 0; col < image.width; col++) {
    if (pixels[(row * image.width + col) * 4 + 3] > 24) { x = Math.min(x, col); y = Math.min(y, row); right = Math.max(right, col); bottom = Math.max(bottom, row); }
  }
  canvas.width = canvas.height = 0;
  if (right < x || bottom < y) throw new Error(`Empty avatar sprite: ${name}`);
  return { image, x, y, width: right - x + 1, height: bottom - y + 1 };
}
function paint(ctx: CanvasRenderingContext2D, sprite: Sprite | undefined, x: number, y: number, width: number, height: number) {
  if (sprite) ctx.drawImage(sprite.image, sprite.x, sprite.y, sprite.width, sprite.height, x, y, width, height);
}
export class AvatarRenderer {
  private sprites: Record<string, Sprite> = {};
  readonly ready = Promise.all(['background', 'body', 'sleeve', 'hand'].map(async name => { this.sprites[name] = await sprite(name); }));
  private face = document.createElement('canvas');
  private crop: Crop | null = null;
  private hasFace = false;
  private lastFace = 0;
  constructor() { this.face.width = this.face.height = 192; }
  updateFace(points: Landmark[], video: HTMLVideoElement, now: number) {
    if (video.readyState < 2) return;
    const next = faceCrop(points, video.videoWidth, video.videoHeight);
    if (!next) return; // Keep the last face in memory on loss; never persist it or encode/upload it.
    const dt = Math.min(.2, (now - this.lastFace) / 1000), alpha = 1 - Math.exp(-dt / .12);
    if (!this.crop || now - this.lastFace > 500) this.crop = next;
    else for (const key of ['x', 'y', 'size'] as const) this.crop[key] += (next[key] - this.crop[key]) * alpha;
    this.lastFace = now;
    const ctx = this.face.getContext('2d')!;
    ctx.save(); ctx.clearRect(0, 0, 192, 192); ctx.translate(192, 0); ctx.scale(-1, 1);
    ctx.drawImage(video, this.crop.x, this.crop.y, this.crop.size, this.crop.size, 0, 0, 192, 192); ctx.restore(); this.hasFace = true;
  }
  background(ctx: CanvasRenderingContext2D, width: number, height: number) {
    ctx.fillStyle = '#e1e9ce'; ctx.fillRect(0, 0, width, height);
    // Stretch the quiet static wall to keep both corner decorations visible in portrait and landscape.
    paint(ctx, this.sprites.background, 0, 0, width, height);
  }
  draw(ctx: CanvasRenderingContext2D, layout: Geometry, arms: DrawArm[], sleeping: boolean, time: number) {
    const { scale: s, center: c, face: f } = layout;
    for (const arm of arms) {
      this.segment(ctx, arm.shoulder, arm.elbow, 47 * s);
      this.segment(ctx, arm.elbow, arm.wrist, 43 * s);
    }
    paint(ctx, this.sprites.body, c.x - 107 * s, c.y - 28 * s, 214 * s, 214 * s);
    ctx.save(); ctx.beginPath(); ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2); ctx.fillStyle = '#fff8e5'; ctx.fill(); ctx.clip();
    if (this.hasFace) ctx.drawImage(this.face, f.x - f.radius, f.y - f.radius, f.radius * 2, f.radius * 2);
    else {
      ctx.fillStyle = '#896f45'; ctx.lineWidth = 3 * s; ctx.strokeStyle = '#896f45';
      for (const sign of [-1, 1]) { ctx.beginPath(); ctx.arc(f.x + sign * 18 * s, f.y - 4 * s, 3 * s, 0, Math.PI * 2); ctx.fill(); }
      ctx.beginPath(); ctx.arc(f.x, f.y + 7 * s, 17 * s, .2, Math.PI - .2); ctx.stroke();
    }
    if (sleeping) { ctx.fillStyle = '#f5f0e555'; ctx.fillRect(f.x - f.radius, f.y - f.radius, f.radius * 2, f.radius * 2); }
    ctx.restore(); ctx.strokeStyle = '#fff9e9'; ctx.lineWidth = 6 * s; ctx.beginPath(); ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2); ctx.stroke();
    arms.forEach((arm, side) => {
      ctx.save(); ctx.translate(arm.hand.x, arm.hand.y); ctx.rotate(Math.atan2(arm.hand.y - arm.wrist.y, arm.hand.x - arm.wrist.x) + Math.PI / 2);
      if (side === 1) ctx.scale(-1, 1);
      paint(ctx, this.sprites.hand, -24 * s, -30 * s, 48 * s, 57 * s); ctx.restore();
      if (arm.active && !sleeping) { ctx.strokeStyle = '#fffbea'; ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.arc(arm.hand.x, arm.hand.y, 28 * s, 0, Math.PI * 2); ctx.stroke(); }
    });
    if (sleeping) {
      ctx.fillStyle = '#7b8b59'; ctx.font = `bold ${18 * s}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText('z z', f.x + f.radius + 20 * s, f.y - 20 * s + Math.sin(time / 500) * 3 * s);
    }
  }
  private segment(ctx: CanvasRenderingContext2D, from: Point, to: Point, width: number) {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    ctx.save(); ctx.translate(from.x, from.y); ctx.rotate(Math.atan2(to.y - from.y, to.x - from.x) - Math.PI / 2);
    paint(ctx, this.sprites.sleeve, -width / 2, -width / 2, width, length + width); ctx.restore();
  }
  destroy() { this.face.width = this.face.height = 0; this.crop = null; this.hasFace = false; }
}
