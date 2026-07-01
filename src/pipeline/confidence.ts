import type { Attributed, SourceType } from "../types.js";

/**
 * confidence: turns a base per-field confidence (set at extraction time,
 * reflecting source reliability + extraction method) into a final score
 * that also accounts for cross-source agreement.
 *
 * Policy:
 *  - Start from the highest base confidence among candidates for a field.
 *  - Each additional source that AGREES (same normalized value) adds a
 *    corroboration bonus, capped so confidence never exceeds 0.98
 *    (we never claim certainty -- "wrong-but-confident" is the thing we're
 *    explicitly trying to avoid per the problem statement).
 *  - If sources DISAGREE, the winner's confidence is penalized slightly,
 *    because a contested field is inherently less trustworthy even if we
 *    picked the "best" answer.
 */
const CORROBORATION_BONUS = 0.12;
const DISAGREEMENT_PENALTY = 0.08;
const MAX_CONFIDENCE = 0.98;

export function scoreField<T>(
  candidates: Attributed<T>[],
  winnerValue: T,
  normalize: (v: T) => string = (v) => JSON.stringify(v)
): number {
  if (candidates.length === 0) return 0;
  const winnerKey = normalize(winnerValue);
  const agreeing = candidates.filter((c) => normalize(c.value) === winnerKey);
  const disagreeing = candidates.length - agreeing.length;

  const base = Math.max(...agreeing.map((c) => c.confidence));
  const corroboration = Math.min((agreeing.length - 1) * CORROBORATION_BONUS, 0.3);
  const penalty = disagreeing > 0 ? DISAGREEMENT_PENALTY : 0;

  return Math.round(Math.min(base + corroboration - penalty, MAX_CONFIDENCE) * 100) / 100;
}

// Source reliability ranking, used as a merge tie-breaker when confidence
// scores are equal. Structured/operator-entered data outranks inferred data.
export const SOURCE_PRIORITY: SourceType[] = [
  "recruiter_csv",
  "ats_json",
  "linkedin",
  "github",
  "resume",
  "recruiter_notes",
];

export function sourcePriorityRank(s: SourceType): number {
  const idx = SOURCE_PRIORITY.indexOf(s);
  return idx === -1 ? SOURCE_PRIORITY.length : idx;
}
