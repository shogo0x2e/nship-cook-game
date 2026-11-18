export const challengeSeconds = 45;
export const challengeMaxPairs = 64;
export const challengeRules = 'catch-45-v1';
export type PlayVariant = 'simple' | 'challenge';
export type CatchMoment = { atMs: number; reactionMs: number };
export type ChallengeResult = { activeMs: number; completed: boolean; catches: CatchMoment[] };
export type DailyFeedback = {
  ageGroup: 'lower' | 'upper' | 'middle' | 'other' | 'unspecified';
  frequency: 'daily' | 'weekly' | 'sometimes' | 'no' | 'unsure';
  reason: string;
  fun: number | null;
};
export type ChallengeRun = Omit<ChallengeResult,'catches'> & {
  caught: number;
  roundId: string; input: 'camera' | 'demo'; comparisonKey: string;
  finishedAt: number; score: number; previousBest: number; feedback?: DailyFeedback;
};
export type ChallengeProgress = { best: Record<string, number>; runs: ChallengeRun[] };
export function freshChallengeProgress(): ChallengeProgress { return { best: {}, runs: [] }; }
export function comparisonKey(input: 'camera' | 'demo', foods: string[]): string {
  return `${challengeRules}:${input}:${[...foods].sort().join(',')}`;
}
// Every food earns the same points. Passing a pair never deducts points or breaks a chain.
export function catchPoints(reactionMs: number): number {
  return 100 + Math.round(100 * (1 - Math.min(3000, Math.max(0, reactionMs)) / 3000));
}
export function challengeScore(catches: CatchMoment[]): number {
  return catches.reduce((sum, item) => sum + catchPoints(item.reactionMs), 0) + Math.floor(catches.length / 3) * 150;
}
export function validateChallengeResult(value: unknown, caught: number): ChallengeResult {
  const invalid = () => { throw new Error('Invalid challenge result'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(',') !== 'activeMs,catches,completed' ||
      typeof v.activeMs !== 'number' || !Number.isInteger(v.activeMs) || v.activeMs < 0 || v.activeMs > challengeSeconds * 1000 ||
      typeof v.completed !== 'boolean' || (v.completed && v.activeMs !== challengeSeconds * 1000) ||
      !Array.isArray(v.catches) || v.catches.length !== caught || caught > challengeMaxPairs) return invalid();
  let previous = -1;
  const catches = v.catches.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return invalid();
    const c = item as Record<string, unknown>;
    if (Object.keys(c).sort().join(',') !== 'atMs,reactionMs' || typeof c.atMs !== 'number' || !Number.isInteger(c.atMs) ||
        c.atMs < previous || c.atMs < 0 || c.atMs > (v.activeMs as number) || typeof c.reactionMs !== 'number' ||
        !Number.isInteger(c.reactionMs) || c.reactionMs < 0 || c.reactionMs > c.atMs) return invalid();
    previous = c.atMs;
    return { atMs: c.atMs, reactionMs: c.reactionMs };
  });
  return { activeMs: v.activeMs, completed: v.completed, catches };
}
export function validateDailyFeedback(value: unknown): DailyFeedback {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid feedback');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(',') !== 'ageGroup,frequency,fun,reason' ||
      !['lower','upper','middle','other','unspecified'].includes(v.ageGroup as string) ||
      !['daily','weekly','sometimes','no','unsure'].includes(v.frequency as string) ||
      typeof v.reason !== 'string' || v.reason.length > 300 ||
      (v.fun !== null && (typeof v.fun !== 'number' || !Number.isInteger(v.fun) || v.fun < 1 || v.fun > 5))) throw new Error('Invalid feedback');
  return { ageGroup: v.ageGroup as DailyFeedback['ageGroup'], frequency: v.frequency as DailyFeedback['frequency'], reason: v.reason.trim(), fun: v.fun as number | null };
}
