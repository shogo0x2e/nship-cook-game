import { ingredients, recipes, type IngredientId, type Recipe } from './content.ts';
export { ingredients, recipes, type IngredientId, type Recipe } from './content.ts';

export type Evidence = Record<IngredientId, { offered: number; caught: number }>;
export function freshEvidence(): Evidence {
  return Object.fromEntries(ingredients.map(i => [i.id, { offered: 0, caught: 0 }])) as Evidence;
}
export function hintIds(evidence: Evidence): IngredientId[] {
  return ingredients.filter(i => evidence[i.id].caught > 0)
    .sort((a, b) => (evidence[b.id].caught / Math.max(1, evidence[b.id].offered)) - (evidence[a.id].caught / Math.max(1, evidence[a.id].offered)) || evidence[b.id].caught - evidence[a.id].caught)
    .map(i => i.id).slice(0, 3);
}
// Two lanes far enough apart that the basket can only reach one: every pair is a real choice.
export const lanes = [.3, .7] as const;
export const plateSize = 3, plateCount = 3, maxPairs = 20;
export type Pair = [left: IngredientId, right: IngredientId];
/**
 * Two-choice schedule that keeps the offer itself neutral: every ingredient appears equally often
 * (round-robin blocks), no pairing repeats until all have been shown, and sides are balanced, so a
 * pick reflects the child rather than what happened to be offered more or closer.
 */
export function pairSchedule(ids: IngredientId[], count: number, random: () => number = Math.random): Pair[] {
  if (ids.length < 2) return [];
  const shuffle = <T>(list: T[]) => { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; };
  const ring: (IngredientId | null)[] = shuffle([...ids]); if (ring.length % 2) ring.push(null);
  const side = new Map(ids.map(id => [id, 0])); // left minus right appearances
  const pairs: Pair[] = [];
  while (pairs.length < count) {
    const block: Pair[] = [];
    for (let i = 0; i < ring.length / 2; i++) { const a = ring[i], b = ring[ring.length - 1 - i]; if (a && b) block.push([a, b]); }
    for (const [a, b] of shuffle(block)) {
      const diff = side.get(a)! - side.get(b)!;
      const [left, right] = diff < 0 || (diff === 0 && random() < .5) ? [a, b] : [b, a];
      side.set(left, side.get(left)! + 1); side.set(right, side.get(right)! - 1); pairs.push([left, right]);
    }
    ring.splice(1, 0, ring.pop() as IngredientId | null);
  }
  return pairs.slice(0, count);
}
export function basketWidth(stageWidth: number): number { return Math.min(stageWidth * .19, 165); }
export function caughtAtBasket(item: { x: number; previousY: number; y: number }, basketX: number, stageWidth = 800): boolean {
  // Allow the edge of a food to overlap the basket opening, using the same geometry as rendering.
  const radius = (basketWidth(stageWidth) / 2 + Math.min(stageWidth * .018, 16)) / stageWidth;
  return item.previousY < 0.82 && item.y >= 0.82 && Math.abs(item.x - basketX) <= radius;
}
export function mirroredTorsoX(landmarks: { x: number; visibility?: number }[]): number | null {
  const left = landmarks[11]; const right = landmarks[12];
  if (!left || !right || !Number.isFinite(left.x) || !Number.isFinite(right.x) || (left.visibility ?? 0) < 0.6 || (right.visibility ?? 0) < 0.6) return null;
  return Math.min(0.91, Math.max(0.09, 1 - (left.x + right.x) / 2));
}
export function recommend(selected: IngredientId[], excluded: Set<IngredientId>, allergens: Set<string>): Recipe[] {
  return recipes.filter(r => !r.foods.some(f => excluded.has(f)) && !r.allergens.some(a => allergens.has(a)))
    .sort((a, b) => b.foods.filter(f => selected.includes(f)).length - a.foods.filter(f => selected.includes(f)).length)
    .slice(0, 3);
}
