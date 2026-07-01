# Eightfold Candidate Data Transformer

Multi-source candidate data transformer for the Eightfold Engineering Intern
assignment. Detects → extracts → normalizes → merges → scores confidence →
projects → validates, turning messy multi-source candidate data into one
canonical, traceable profile.

## Quick start

```bash
npm install
npm test                 # 14 unit tests, no extra framework

# Default schema, one structured + one unstructured source
npx tsx src/cli.ts sample-data/recruiter_export.csv https://github.com/octocat

# Write to a file instead of stdout
npx tsx src/cli.ts sample-data/recruiter_export.csv https://github.com/octocat --out out.json

# Custom runtime config (the "required twist")
npx tsx src/cli.ts sample-data/recruiter_export.csv --config config/example-config.json
```

Inputs can be mixed freely on the command line — any number of CSV files and
GitHub profile URLs, in any order. The tool auto-detects each input's type.

## What's implemented vs. descoped

**Implemented (2 of the 6 source types, one full structured + one full
unstructured, as the assignment requires at minimum):**
- Recruiter CSV export (structured)
- GitHub profile via live REST API (unstructured) — name, bio→headline,
  location, blog→portfolio, and **inferred skills from repo languages**

**Descoped, on purpose, given the time box** (each one logs a clear warning
and is skipped rather than crashing the run):
- ATS JSON blob — field-name mapping is mechanically the same idea as CSV
  extraction (different shape, same "direct_field" extraction pattern), so I
  prioritized breadth of the *pipeline* (merge/confidence/project/validate)
  over a third structured parser that wouldn't exercise new logic.
- LinkedIn — no public, ToS-compliant API available for an assignment-scale
  project; scraping is both against LinkedIn's terms and unreliable to demo.
- Resume PDF/DOCX, recruiter notes (.txt) — both are "extract structured
  facts from prose" problems (regex/NLP over free text). Same reasoning as
  ATS JSON: valuable, but additive complexity on the extraction edge, not the
  core engine. The `detectSource` + extractor interface already has the slot
  ready (see `src/sources/`, `SourceType` in `src/types.ts`) — adding one is
  a new file implementing the same `Fragment` contract, no engine changes.

This was a deliberate scope cut, not an oversight — see the design doc for
the full reasoning.

## Architecture

```
detect → extract → (combine fragments) → match/merge → infer → confidence → project → validate
```

- `src/pipeline/detect.ts` — classifies a raw input (file/URL) into a SourceType
- `src/sources/*.ts` — one file per source; each turns raw input into
  `Fragment` objects (partial canonical records tagged with match hints)
- `src/pipeline/merge.ts` — union-find matching on shared keys (email, github
  username, phone) → combines matched fragments → resolves one winner per
  field
- `src/pipeline/confidence.ts` — scores fields based on source reliability +
  cross-source agreement/disagreement
- `src/pipeline/infer.ts` — fills `years_experience` from earliest
  experience start date when no source states it directly
- `src/pipeline/normalize.ts` — phone→E.164, date→YYYY-MM, country→ISO-3166,
  skill aliasing
- `src/pipeline/project.ts` — `projectDefault` (fixed schema) and
  `projectWithConfig` (runtime config-driven projection)
- `src/pipeline/validate.ts` — Ajv schema check (default) / config-shape
  check (custom)
- `src/cli.ts` — wires it all together

Full reasoning (merge policy, confidence formula, edge cases handled, what
was deliberately left out) is in the one-page design doc,
`Omkar Mishra_omkarmishra07@gmail.com_Eightfold.pdf`.

## Sample data

- `sample-data/recruiter_export.csv` — 4 rows: two clean, one with a
  malformed cell count (tests the "garbage row doesn't crash the run"
  requirement), one clean
- `config/example-config.json` — a runtime config that renames fields,
  normalizes phone/country/skills, and turns on provenance + confidence
- `sample-data/output_default.json` / `output_custom.json` — outputs from
  the commands above, committed so reviewers can see results without running
  anything

## Known edge cases handled (see tests + sample run for live proof)

1. **Malformed CSV row** (wrong cell count) → skipped with a warning, run
   continues. (`sample-data/recruiter_export.csv` row 4 triggers this live.)
2. **Unreachable/rate-limited API source** (e.g. GitHub's unauthenticated
   60 req/hr cap) → caught, warned, skipped — never throws and never takes
   down the batch. This happens live in the sample run above (shared sandbox
   IPs are usually already near the GitHub rate limit) and is a good thing
   to point at in the demo video.
3. **Same person, different identifying key per source** — matching is
   transitive (union-find over match keys), so A↔B via email and B↔C via
   GitHub username correctly merges all three into one candidate, not two.
4. **Conflicting values across sources** (e.g. two different names) —
   highest-confidence value wins; ties broken by source priority
   (recruiter_csv > ats_json > linkedin > github > resume > notes); the
   *loser* still lowers the winner's confidence slightly, since a contested
   field is never as trustworthy as an uncontested one.
5. **Garbage/unnormalizable values** (e.g. phone `"not-a-phone"`) →
   normalizers return `null` rather than inventing or passing through junk.

## What I'd add with more time

- ATS JSON + resume + notes extractors (same `Fragment` contract, see above)
- A real fuzzy-name+company match key as a fallback when no shared
  identifier exists across sources (currently: email/phone/github-handle
  only — two sources with *only* a matching name would not merge, which is
  the conservative, safer failure mode but loses some recall)
- Token-bucket retry/backoff for API sources instead of single-attempt
