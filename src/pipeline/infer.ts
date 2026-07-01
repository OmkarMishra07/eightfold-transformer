import type { CanonicalCandidate } from "../types.js";

/**
 * inferDerivedFields: fills gaps that no single source states directly but
 * can be reasonably computed from what we already have. Currently:
 * years_experience, when absent, is derived from the earliest experience
 * start date to now. Low confidence (0.4) because it's a guess based on
 * possibly-incomplete experience history, not a stated fact.
 */
export function inferDerivedFields(c: CanonicalCandidate): void {
  if (c.yearsExperience.length > 0) return; // never override a stated value
  const starts = c.experience
    .map((e) => e.value.start)
    .filter((s): s is string => !!s)
    .map((s) => new Date(`${s}-01`));
  if (starts.length === 0) return;

  const earliest = starts.reduce((a, b) => (a < b ? a : b));
  const years = (Date.now() - earliest.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  c.yearsExperience.push({
    value: Math.round(years * 10) / 10,
    source: c.experience[0].source,
    method: "heuristic_inference",
    confidence: 0.4,
  });
}
