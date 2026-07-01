// ============================================================================
// CANONICAL INTERNAL RECORD
// This is the engine's "source of truth" shape. It is intentionally richer
// than the default output schema: every field is a VALUE + WHERE IT CAME FROM,
// so projection to any output shape (default or custom config) is just a
// read over this structure -- we never lose provenance by normalizing early.
// ============================================================================

export type SourceType =
  | "recruiter_csv"
  | "ats_json"
  | "github"
  | "linkedin"
  | "resume"
  | "recruiter_notes";

export type ExtractionMethod =
  | "direct_field"        // copied straight from a structured field
  | "api_fetch"           // pulled from a live API call
  | "regex_extraction"    // pulled out of free text with a pattern
  | "heuristic_inference" // guessed from context (e.g. years_experience from earliest job date)
  | "normalization";      // value passed through a normalizer (format change only)

// A single attributed value: every fact in the system carries this envelope.
export interface Attributed<T> {
  value: T;
  source: SourceType;
  method: ExtractionMethod;
  confidence: number; // 0..1, source+method+agreement based (see confidence.ts)
  rawSourceId?: string; // e.g. csv row number, file name -- for debugging/audit
}

export interface CanonicalCandidate {
  candidateId: string; // generated match key, not from any single source
  fullName: Attributed<string>[];          // multiple sources may all claim a name; we keep all, pick winner at merge
  emails: Attributed<string>[];
  phones: Attributed<string>[];
  location: {
    city: Attributed<string | null>[];
    region: Attributed<string | null>[];
    country: Attributed<string | null>[];
  };
  links: {
    linkedin: Attributed<string | null>[];
    github: Attributed<string | null>[];
    portfolio: Attributed<string | null>[];
    other: Attributed<string>[];
  };
  headline: Attributed<string | null>[];
  yearsExperience: Attributed<number | null>[];
  skills: Map<string, Attributed<string>[]>; // canonical skill name -> list of (raw mention, source)
  experience: Attributed<ExperienceEntry>[];
  education: Attributed<EducationEntry>[];
}

export interface ExperienceEntry {
  company: string;
  title: string;
  start: string | null; // YYYY-MM
  end: string | null;   // YYYY-MM or null = current
  summary: string | null;
}

export interface EducationEntry {
  institution: string;
  degree: string | null;
  field: string | null;
  endYear: number | null;
}

// ============================================================================
// FINAL "WINNER" RECORD -- after merge + confidence, before projection.
// One value per field (or one array of de-duplicated values), each tagged
// with where it won from. This is what gets projected into output shapes.
// ============================================================================

export interface ResolvedField<T> {
  value: T;
  sources: SourceType[]; // every source that contributed/agreed
  method: ExtractionMethod;
  confidence: number;
}

export interface ResolvedCandidate {
  candidateId: string;
  fullName: ResolvedField<string | null>;
  emails: ResolvedField<string[]>;
  phones: ResolvedField<string[]>;
  location: {
    city: ResolvedField<string | null>;
    region: ResolvedField<string | null>;
    country: ResolvedField<string | null>;
  };
  links: ResolvedField<{ linkedin: string | null; github: string | null; portfolio: string | null; other: string[] }>;
  headline: ResolvedField<string | null>;
  yearsExperience: ResolvedField<number | null>;
  skills: ResolvedField<{ name: string; confidence: number; sources: SourceType[] }[]>;
  experience: ResolvedField<ExperienceEntry>[]; // each experience entry resolved independently
  education: ResolvedField<EducationEntry>[];
  overallConfidence: number;
}

// ============================================================================
// RUNTIME OUTPUT CONFIG (the "required twist")
// ============================================================================

export type OnMissing = "null" | "omit" | "error";
export type NormalizeKind = "E164" | "canonical" | "ISO-3166" | "YYYY-MM" | "none";

export interface FieldConfig {
  path: string;           // output key path, e.g. "primary_email" or "location.country"
  from: string;            // canonical source path, e.g. "emails[0]" or "skills[].name"
  type: "string" | "number" | "boolean" | "string[]" | "number[]" | "object" | "object[]";
  required?: boolean;
  normalize?: NormalizeKind;
}

export interface OutputConfig {
  fields: FieldConfig[];
  include_confidence: boolean;
  include_provenance?: boolean;
  on_missing: OnMissing;
}
