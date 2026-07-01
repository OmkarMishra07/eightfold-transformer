import type { OutputConfig, ResolvedCandidate, FieldConfig } from "../types.js";
import { normalizePhoneE164, normalizeCountryISO, normalizeSkillName } from "./normalize.js";

// ---------------------------------------------------------------------------
// DEFAULT PROJECTION: produces exactly the schema from the problem statement.
// This is just a fixed reading of the ResolvedCandidate -- no path language
// needed because the shape is hardcoded and known in advance.
// ---------------------------------------------------------------------------
export function projectDefault(r: ResolvedCandidate) {
  const provenance: { field: string; source: string; method: string }[] = [];
  const note = (field: string, sources: string[], method: string) => {
    // Only record provenance for fields that actually resolved to a value
    // from somewhere; a null/missing field has no source to attribute.
    for (const s of sources) provenance.push({ field, source: s, method });
  };

  note("full_name", r.fullName.sources, r.fullName.method);
  note("emails", r.emails.sources, r.emails.method);
  note("phones", r.phones.sources, r.phones.method);
  note("location.city", r.location.city.sources, r.location.city.method);
  note("location.country", r.location.country.sources, r.location.country.method);
  note("headline", r.headline.sources, r.headline.method);
  note("years_experience", r.yearsExperience.sources, r.yearsExperience.method);
  for (const s of r.skills.value) note(`skills.${s.name}`, s.sources, "heuristic_inference");

  return {
    candidate_id: r.candidateId,
    full_name: r.fullName.value,
    emails: r.emails.value,
    phones: r.phones.value.map((p) => normalizePhoneE164(p) ?? p),
    location: {
      city: r.location.city.value,
      region: r.location.region.value,
      country: normalizeCountryISO(r.location.country.value),
    },
    links: r.links.value,
    headline: r.headline.value,
    years_experience: r.yearsExperience.value,
    skills: r.skills.value.map((s) => ({ name: normalizeSkillName(s.name), confidence: s.confidence, sources: s.sources })),
    experience: r.experience.map((e) => e.value),
    education: r.education.map((e) => e.value),
    provenance,
    overall_confidence: r.overallConfidence,
  };
}

// ---------------------------------------------------------------------------
// CUSTOM PROJECTION: drives output shape from a runtime FieldConfig[].
// "from" is a small path language over a flattened view of the resolved
// candidate:
//   - dot notation for nesting:           location.country
//   - [n] for a fixed array index:        emails[0]
//   - [] for "map every element":         skills[].name
// ---------------------------------------------------------------------------
function buildFlatView(r: ResolvedCandidate) {
  return {
    candidate_id: r.candidateId,
    full_name: r.fullName.value,
    emails: r.emails.value,
    phones: r.phones.value,
    location: { city: r.location.city.value, region: r.location.region.value, country: r.location.country.value },
    links: r.links.value,
    headline: r.headline.value,
    years_experience: r.yearsExperience.value,
    skills: r.skills.value, // [{name, confidence, sources}]
    experience: r.experience.map((e) => e.value),
    education: r.education.map((e) => e.value),
    overall_confidence: r.overallConfidence,
  };
}

function getPath(obj: any, path: string): unknown {
  const tokens = path.match(/[^.\[\]]+|\[\]|\[\d+\]/g) ?? [];
  let cur: any = obj;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (cur === undefined || cur === null) return undefined;
    if (t === "[]") {
      const rest = tokens.slice(i + 1).join("");
      if (!Array.isArray(cur)) return undefined;
      return cur.map((item) => (rest ? getPath(item, rest) : item));
    } else if (/^\[\d+\]$/.test(t)) {
      const idx = Number(t.slice(1, -1));
      cur = Array.isArray(cur) ? cur[idx] : undefined;
    } else {
      cur = cur[t];
    }
  }
  return cur;
}

function applyNormalize(value: unknown, kind: FieldConfig["normalize"]): unknown {
  if (value === undefined || value === null) return value;
  switch (kind) {
    case "E164":
      return Array.isArray(value) ? value.map((v) => normalizePhoneE164(String(v))) : normalizePhoneE164(String(value));
    case "ISO-3166":
      return Array.isArray(value) ? value.map((v) => normalizeCountryISO(String(v))) : normalizeCountryISO(String(value));
    case "canonical":
      return Array.isArray(value) ? value.map((v) => normalizeSkillName(String(v))) : normalizeSkillName(String(value));
    default:
      return value;
  }
}

function setPath(obj: any, path: string, value: unknown) {
  const keys = path.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in cur)) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

export interface ProjectionResult {
  output: Record<string, unknown>;
  errors: string[];
}

export function projectWithConfig(r: ResolvedCandidate, config: OutputConfig): ProjectionResult {
  const flat = buildFlatView(r);
  const output: Record<string, unknown> = {};
  const errors: string[] = [];
  const provenance: { field: string; source: string; method: string }[] = [];

  for (const fc of config.fields) {
    let value = getPath(flat, fc.from);
    const isMissing =
      value === undefined || value === null || (Array.isArray(value) && value.length === 0) || value === "";

    if (isMissing) {
      if (fc.required && config.on_missing === "error") {
        errors.push(`Required field '${fc.path}' (from '${fc.from}') is missing.`);
        continue;
      }
      if (config.on_missing === "omit") continue; // drop the key entirely
      setPath(output, fc.path, null); // "null" policy (also the fallback for non-required missing fields)
      continue;
    }

    value = applyNormalize(value, fc.normalize);
    setPath(output, fc.path, value);

    if (config.include_provenance) {
      // best-effort: only top-level scalar resolved fields carry direct provenance
      const sourceField = (r as any)[toCamel(fc.from.split(/[.\[]/)[0])];
      if (sourceField?.sources) {
        for (const s of sourceField.sources) provenance.push({ field: fc.path, source: s, method: sourceField.method });
      }
    }
  }

  if (config.include_confidence) {
    output["overall_confidence"] = r.overallConfidence;
  }
  if (config.include_provenance) {
    output["provenance"] = provenance;
  }

  return { output, errors };
}

function toCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
