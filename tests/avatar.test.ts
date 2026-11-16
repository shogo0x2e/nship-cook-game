import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarLayout, faceCrop, firstHandCatch, placeArm, poseArms, smoothAngle, touchTime, type Landmark } from '../src/avatar.ts';
function pose() {
  const points: Landmark[] = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 0 }));
  const put = (i: number, x: number, y: number) => { points[i] = { x, y, visibility: 1 }; };
  put(11, .6, .6); put(13, .72, .5); put(15, .77, .3);
  put(12, .4, .6); put(14, .28, .5); put(16, .23, .3);
  put(0, .5, .3); put(7, .43, .28); put(8, .57, .28); put(2, .47, .27); put(5, .53, .27);
  return points;
}
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test('mirrored arms use pixel aspect ratio and point to the matching screen side', () => {
  const [left, right] = poseArms(pose(), 640, 480);
  assert.ok(left.valid && right.valid && left.raised && right.raised);
  close(left.upper, Math.atan2(-48, -76.8));
  close(right.upper, Math.atan2(-48, 76.8));
  const layout = avatarLayout(900, 560);
  assert.ok(placeArm(left, 0, layout).hand.x < layout.center.x);
  assert.ok(placeArm(right, 1, layout).hand.x > layout.center.x);
});
test('camera distance, translation and arm size do not change avatar reach', () => {
  const original = poseArms(pose(), 640, 480);
  const scaled = pose().map(p => ({ ...p, x: (p.x - .5) * .65 + .45, y: (p.y - .5) * .65 + .6 }));
  const distant = poseArms(scaled, 640, 480);
  for (let i = 0; i < 2; i++) { close(original[i].upper, distant[i].upper); close(original[i].lower, distant[i].lower); assert.equal(distant[i].raised, true); }
});
test('low visibility, invalid values, missing limbs and foreshortened arms disable control', () => {
  for (const value of [NaN, Infinity]) { const points = pose(); points[15].x = value; assert.equal(poseArms(points,640,480)[0].valid,false); }
  const hidden = pose(); hidden[13].visibility = .1; assert.equal(poseArms(hidden,640,480)[0].valid,false);
  const straightAtCamera = pose(); straightAtCamera[15] = { ...straightAtCamera[13] }; assert.equal(poseArms(straightAtCamera,640,480)[0].valid,false);
  assert.ok(poseArms([],640,480).every(arm => !arm.valid));
});
test('lowered hands are tracked but cannot catch', () => {
  const points = pose(); points[15].y = .8; points[16].y = .8;
  const arms = poseArms(points,640,480);
  assert.ok(arms.every(arm => arm.valid && !arm.raised));
  assert.ok(arms.every((arm,i) => !placeArm(arm,i,avatarLayout(900,560)).active));
});
test('angle filtering takes the short path across the pi boundary', () => {
  const angle = smoothAngle(Math.PI - .05, -Math.PI + .05, .02);
  assert.ok(angle > Math.PI - .05 && angle < Math.PI + .05);
  close(smoothAngle(1,2,0),1);
});
test('face crop follows ears, falls back to eyes, and stays square inside video', () => {
  const points = pose(), ears = faceCrop(points,640,480)!;
  close(ears.size, .14 * 640 * 1.6);
  points[7].visibility = 0; assert.ok(faceCrop(points,640,480));
  points[2].visibility = 0; assert.equal(faceCrop(points,640,480),null);
  const edge = pose().map(p => ({ ...p, x: p.x - .4, y: p.y - .25 }));
  const crop = faceCrop(edge,640,480)!; assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x+crop.size <= 640 && crop.y+crop.size <= 480);
});
test('a fast hand cannot tunnel through a moving food between frames', () => {
  const t = touchTime({x:100,y:100},{x:100,y:110},{x:0,y:100},{x:200,y:110},20)!;
  close(t,.4);
  assert.equal(touchTime({x:100,y:100},{x:100,y:110},{x:0,y:0},{x:200,y:0},20),null);
});
test('only the earliest of two hand contacts wins; exact ties can alternate neutrally', () => {
  const items = [{before:{x:10,y:0},after:{x:10,y:0}},{before:{x:90,y:0},after:{x:90,y:0}}];
  const hands = [{before:{x:0,y:0},after:{x:20,y:0},active:true},{before:{x:100,y:0},after:{x:80,y:0},active:true}];
  assert.equal(firstHandCatch(items,hands,2,0),0); assert.equal(firstHandCatch(items,hands,2,1),1);
  hands[1].before.x = 95; assert.equal(firstHandCatch(items,hands,2,0),1);
  hands.forEach(hand => {hand.active=false;}); assert.equal(firstHandCatch(items,hands,2,0),null);
});
test('targets stay symmetric and reachable on portrait, landscape and narrow fields', () => {
  for (const [w,h] of [[340,360],[740,620],[1048,480]]) {
    const l = avatarLayout(w,h); close(l.lanes[0] + l.lanes[1],1);
    assert.ok(l.lanes[0] > .1 && l.lanes[1] < .9);
    const arms=poseArms(pose(),640,480);
    arms.forEach((arm,i) => { const hand=placeArm(arm,i,l); assert.ok(hand.active); assert.ok(Math.abs(hand.hand.x-l.lanes[i]*w)<l.foodRadius+l.handRadius); });
  }
});
test('lowered hands stay inside the field in portrait and landscape', () => {
  for (const [w,h] of [[340,360],[740,620],[1048,480]]) {
    const l = avatarLayout(w,h);
    const arm = placeArm({upper:Math.PI/2,lower:Math.PI/2,valid:true,raised:false},0,l);
    assert.ok(arm.hand.y + 30 * l.scale < h);
  }
});
