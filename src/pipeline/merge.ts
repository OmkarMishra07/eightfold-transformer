import type { Attributed, CanonicalCandidate, ResolvedCandidate, SourceType } from "../types.js";
import { scoreField, sourcePriorityRank } from "./confidence.js";
import { normalizeSkillName } from "./normalize.js";
import crypto from "node:crypto";

export type Fragment = Partial<CanonicalCandidate> & { _matchHints: string[] };

// ---------------------------------------------------------------------------
// MATCH: group fragments that represent the same person.
// Policy: union-find over match keys (lowercased email, github username,
// phone). Any shared key merges two fragments into the same group. This
// correctly handles "same person, different combination of shared keys
// across >2 sources" (transitive matching), which a simple pairwise email
// check would miss.
//
// Fragments with NO match hints at all (e.g. a CSV row with neither email
// nor any other identifier -- shouldn't happen given extract-time filtering,
// but defensively handled) become their own singleton group.
// ---------------------------------------------------------------------------
export function matchFragments(fragments: Fragment[]): Fragment[][] {
  const parent = fragments.map((_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) i = parent[i];
    return i;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  const keyToFragmentIdx = new Map<string, number>();
  fragments.forEach((frag, i) => {
    for (const key of frag._matchHints) {
      const existing = keyToFragmentIdx.get(key);
      if (existing !== undefined) union(existing, i);
      else keyToFragmentIdx.set(key, i);
    }
  });

  const groups = new Map<number, Fragment[]>();
  fragments.forEach((frag, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(frag);
  });
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// COMBINE: stack a matched group's fragments into one CanonicalCandidate,
// concatenating Attributed<> arrays per field (no winner picked yet).
// ---------------------------------------------------------------------------
export function combineGroup(group: Fragment[]): CanonicalCandidate {
  const candidateId = crypto.randomUUID();
  const c: CanonicalCandidate = {
    candidateId,
    fullName: [], emails: [], phones: [],
    location: { city: [], region: [], country: [] },
    links: { linkedin: [], github: [], portfolio: [], other: [] },
    headline: [], yearsExperience: [],
    skills: new Map(),
    experience: [], education: [],
  };

  for (const f of group) {
    if (f.fullName) c.fullName.push(...f.fullName);
    if (f.emails) c.emails.push(...f.emails);
    if (f.phones) c.phones.push(...f.phones);
    if (f.location) {
      c.location.city.push(...f.location.city);
      c.location.region.push(...f.location.region);
      c.location.country.push(...f.location.country);
    }
    if (f.links) {
      c.links.linkedin.push(...f.links.linkedin);
      c.links.github.push(...f.links.github);
      c.links.portfolio.push(...f.links.portfolio);
      c.links.other.push(...f.links.other);
    }
    if (f.headline) c.headline.push(...f.headline);
    if (f.yearsExperience) c.yearsExperience.push(...f.yearsExperience);
    if (f.experience) c.experience.push(...f.experience);
    if (f.education) c.education.push(...f.education);
    if (f.skills) {
      for (const [name, attrs] of f.skills) {
        const canon = normalizeSkillName(name);
        if (!c.skills.has(canon)) c.skills.set(canon, []);
        c.skills.get(canon)!.push(...attrs);
      }
    }
  }
  return c;
}

// ---------------------------------------------------------------------------
// RESOLVE: pick one winner per scalar field. Winner selection policy:
//   1. Highest confidence wins.
//   2. Tie -> higher source priority wins (SOURCE_PRIORITY in confidence.ts).
//   3. Still tied -> first-seen wins (stable, deterministic).
// Arrays (emails, phones, skills) are de-duplicated unions rather than
// single winners, since a candidate legitimately has multiple emails/phones.
// ---------------------------------------------------------------------------
function pickWinner<T>(attrs: Attributed<T>[], normalize: (v: T) => string = (v) => JSON.stringify(v)) {
  if (attrs.length === 0) return null;
  const sorted = [...attrs].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return sourcePriorityRank(a.source) - sourcePriorityRank(b.source);
  });
  const winner = sorted[0];
  const confidence = scoreField(attrs, winner.value, normalize);
  const sources = [...new Set(attrs.filter((a) => normalize(a.value) === normalize(winner.value)).map((a) => a.source))];
  return { value: winner.value, sources, method: winner.method, confidence };
}

function dedupeArray<T>(attrs: Attributed<T>[], normalize: (v: T) => string = (v) => JSON.stringify(v)) {
  const seen = new Map<string, { value: T; sources: SourceType[] }>();
  for (const a of attrs) {
    const key = normalize(a.value);
    if (!seen.has(key)) seen.set(key, { value: a.value, sources: [] });
    seen.get(key)!.sources.push(a.source);
  }
  return [...seen.values()];
}

export function resolveCandidate(c: CanonicalCandidate): ResolvedCandidate {
  const name = pickWinner(c.fullName) ?? { value: null, sources: [], method: "direct_field" as const, confidence: 0 };
  const emailsDedup = dedupeArray(c.emails);
  const phonesDedup = dedupeArray(c.phones);
  const city = pickWinner(c.location.city) ?? { value: null, sources: [], method: "direct_field" as const, confidence: 0 };
  const region = pickWinner(c.location.region) ?? { value: null, sources: [], method: "direct_field" as const, confidence: 0 };
  const country = pickWinner(c.location.country) ?? { value: null, sources: [], method: "direct_field" as const, confidence: 0 };
  const headline = pickWinner(c.headline) ?? { value: null, sources: [], method: "direct_field" as const, confidence: 0 };
  const years = pickWinner(c.yearsExperience) ?? { value: null, sources: [], method: "direct_field" as const, confidence: 0 };

  const linkedin = pickWinner(c.links.linkedin);
  const github = pickWinner(c.links.github);
  const portfolio = pickWinner(c.links.portfolio);
  const otherLinks = dedupeArray(c.links.other).map((x) => x.value);

  const skills = [...c.skills.entries()].map(([name, attrs]) => {
    const winner = pickWinner(attrs)!;
    return { name, confidence: winner.confidence, sources: winner.sources };
  }).sort((a, b) => b.confidence - a.confidence);

  const experience = c.experience.map((e) => ({
    value: e.value,
    sources: [e.source],
    method: e.method,
    confidence: e.confidence,
  }));
  const education = c.education.map((e) => ({
    value: e.value,
    sources: [e.source],
    method: e.method,
    confidence: e.confidence,
  }));

  const allConfidences = [
    name.confidence, city.confidence, headline.confidence, years.confidence,
    ...skills.map((s) => s.confidence),
    ...emailsDedup.map(() => 0.8), ...phonesDedup.map(() => 0.8),
  ].filter((x) => x > 0);
  const overallConfidence = allConfidences.length
    ? Math.round((allConfidences.reduce((a, b) => a + b, 0) / allConfidences.length) * 100) / 100
    : 0;

  return {
    candidateId: c.candidateId,
    fullName: name,
    emails: { value: emailsDedup.map((e) => e.value), sources: [...new Set(emailsDedup.flatMap((e) => e.sources))], method: "direct_field", confidence: emailsDedup.length ? 0.9 : 0 },
    phones: { value: phonesDedup.map((p) => p.value), sources: [...new Set(phonesDedup.flatMap((p) => p.sources))], method: "direct_field", confidence: phonesDedup.length ? 0.85 : 0 },
    location: { city, region, country },
    links: {
      value: {
        linkedin: linkedin?.value ?? null,
        github: github?.value ?? null,
        portfolio: portfolio?.value ?? null,
        other: otherLinks,
      },
      sources: [...new Set([...(linkedin?.sources ?? []), ...(github?.sources ?? []), ...(portfolio?.sources ?? [])])],
      method: "direct_field",
      confidence: Math.max(linkedin?.confidence ?? 0, github?.confidence ?? 0, portfolio?.confidence ?? 0),
    },
    headline,
    yearsExperience: years,
    skills: { value: skills, sources: [...new Set(skills.flatMap((s) => s.sources))], method: "heuristic_inference", confidence: skills.length ? skills[0].confidence : 0 },
    experience,
    education,
    overallConfidence,
  };
}
