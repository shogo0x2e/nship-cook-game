// Pure, device-local pose geometry. Coordinates here never enter the session API.
export type Point = { x: number; y: number };
export type Landmark = Point & { visibility?: number };
export type Arm = { upper: number; lower: number; raised: boolean; valid: boolean };
export type Arms = [Arm, Arm];
export type Crop = { x: number; y: number; size: number };
export const trackingTimeout = 250;
export const restingArms = (): Arms => [
  { upper: 2.25, lower: 1.7, raised: false, valid: false },
  { upper: .89, lower: 1.44, raised: false, valid: false },
];
const good = (p?: Landmark): p is Landmark => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility ?? 0) >= .55 && p.x >= -.05 && p.x <= 1.05 && p.y >= -.05 && p.y <= 1.05;
export function poseArms(points: Landmark[], width: number, height: number): Arms {
  const resting = restingArms();
  if (width <= 0 || height <= 0 || !good(points[11]) || !good(points[12])) return resting;
  const span = Math.hypot((points[11].x - points[12].x) * width, (points[11].y - points[12].y) * height);
  if (span < width * .06) return resting;
  return [[11, 13, 15], [12, 14, 16]].map(([s, e, w], index) => {
    const shoulder = points[s], elbow = points[e], wrist = points[w];
    if (![shoulder, elbow, wrist].every(good)) return resting[index];
    const upper = { x: -(elbow.x - shoulder.x) * width, y: (elbow.y - shoulder.y) * height };
    const lower = { x: -(wrist.x - elbow.x) * width, y: (wrist.y - elbow.y) * height };
    // Near-zero projected segments (e.g. pointing at the camera) have unstable angles.
    if (Math.hypot(upper.x, upper.y) < span * .12 || Math.hypot(lower.x, lower.y) < span * .12) return resting[index];
    return { upper: Math.atan2(upper.y, upper.x), lower: Math.atan2(lower.y, lower.x), raised: (shoulder.y - wrist.y) * height > span * .08, valid: true };
  }) as Arms;
}
export function smoothAngle(previous: number, next: number, dt: number, tau = .055): number {
  const delta = Math.atan2(Math.sin(next - previous), Math.cos(next - previous));
  return previous + delta * (1 - Math.exp(-Math.max(0, dt) / tau));
}
export function faceCrop(points: Landmark[], width: number, height: number): Crop | null {
  const nose = points[0];
  if (!good(nose) || width <= 0 || height <= 0) return null;
  const ears = good(points[7]) && good(points[8]);
  const a = points[ears ? 7 : 2], b = points[ears ? 8 : 5];
  if (!good(a) || !good(b)) return null;
  const span = Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
  if (span < width * .025) return null;
  const size = Math.min(width, height, Math.max(32, span * (ears ? 1.6 : 3.6)));
  const cx = (a.x + b.x) * width / 2;
  const cy = nose.y * height - size * .14;
  return { x: Math.max(0, Math.min(width - size, cx - size / 2)), y: Math.max(0, Math.min(height - size, cy - size / 2)), size };
}
export function avatarLayout(width: number, height: number) {
  const scale = Math.min(width / 900, height / 560);
  const center = { x: width / 2, y: Math.min(height * .62, height - 248 * scale) };
  return { scale, center, shoulderOffset: 70 * scale, upperLength: 95 * scale, lowerLength: 90 * scale, handExtension: 18 * scale,
    handRadius: 24 * scale, foodRadius: 34 * scale,
    lanes: [(center.x - 214 * scale) / width, (center.x + 214 * scale) / width] as [number, number],
    face: { x: center.x, y: center.y - 72 * scale, radius: 63 * scale } };
}
export type Geometry = ReturnType<typeof avatarLayout>;
export type DrawArm = { shoulder: Point; elbow: Point; wrist: Point; hand: Point; active: boolean };
export function placeArm(arm: Arm, side: number, layout: Geometry): DrawArm {
  const shoulder = { x: layout.center.x + (side === 0 ? -1 : 1) * layout.shoulderOffset, y: layout.center.y };
  const elbow = { x: shoulder.x + Math.cos(arm.upper) * layout.upperLength, y: shoulder.y + Math.sin(arm.upper) * layout.upperLength };
  const wrist = { x: elbow.x + Math.cos(arm.lower) * layout.lowerLength, y: elbow.y + Math.sin(arm.lower) * layout.lowerLength };
  const hand = { x: wrist.x + Math.cos(arm.lower) * layout.handExtension, y: wrist.y + Math.sin(arm.lower) * layout.handExtension };
  return { shoulder, elbow, wrist, hand, active: arm.valid && arm.raised && hand.y < shoulder.y - 8 * layout.scale };
}
// Relative swept-circle collision catches fast hands even between inference/render frames.
export function touchTime(foodBefore: Point, foodAfter: Point, handBefore: Point, handAfter: Point, radius: number): number | null {
  const p = { x: foodBefore.x - handBefore.x, y: foodBefore.y - handBefore.y };
  const v = { x: foodAfter.x - handAfter.x - p.x, y: foodAfter.y - handAfter.y - p.y };
  const c = p.x * p.x + p.y * p.y - radius * radius;
  if (c <= 0) return 0;
  const a = v.x * v.x + v.y * v.y, b = 2 * (p.x * v.x + p.y * v.y);
  const discriminant = b * b - 4 * a * c;
  if (a < 1e-9 || discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
export function firstHandCatch(items: { before: Point; after: Point }[], hands: { before: Point; after: Point; active: boolean }[], radius: number, tieSide: number): number | null {
  let picked: number | null = null, earliest = Infinity;
  items.forEach((item, i) => hands.forEach(hand => {
    if (!hand.active) return;
    const time = touchTime(item.before, item.after, hand.before, hand.after, radius);
    if (time !== null && (time < earliest - 1e-6 || (Math.abs(time - earliest) <= 1e-6 && i === tieSide))) { earliest = time; picked = i; }
  }));
  return picked;
}
