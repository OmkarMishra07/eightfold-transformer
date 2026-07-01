import fs from "node:fs";
import path from "node:path";
import { detectSource } from "./pipeline/detect.js";
import { parseRecruiterCsv, csvRowToFragment } from "./sources/recruiterCsv.js";
import { fetchGithubFragment } from "./sources/github.js";
import { matchFragments, combineGroup, resolveCandidate, type Fragment } from "./pipeline/merge.js";
import { inferDerivedFields } from "./pipeline/infer.js";
import { projectDefault, projectWithConfig } from "./pipeline/project.js";
import { validateDefaultOutput, validateConfig } from "./pipeline/validate.js";
import type { OutputConfig } from "./types.js";

interface Args {
  inputs: string[];
  configPath?: string;
  outPath?: string;
}

function parseArgs(argv: string[]): Args {
  const inputs: string[] = [];
  let configPath: string | undefined;
  let outPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--config") configPath = argv[++i];
    else if (argv[i] === "--out") outPath = argv[++i];
    else inputs.push(argv[i]);
  }
  return { inputs, configPath, outPath };
}

async function run() {
  const { inputs, configPath, outPath } = parseArgs(process.argv.slice(2));
  if (inputs.length === 0) {
    console.error("Usage: tsx src/cli.ts <input1> [input2 ...] [--config config.json] [--out output.json]");
    process.exit(1);
  }

  const allWarnings: string[] = [];
  const fragments: Fragment[] = [];

  // -------- DETECT + EXTRACT --------
  for (const input of inputs) {
    const detected = detectSource(input);
    switch (detected.type) {
      case "recruiter_csv": {
        const { rows, warnings } = parseRecruiterCsv(detected.filePath!);
        allWarnings.push(...warnings);
        for (const row of rows) fragments.push(csvRowToFragment(row));
        break;
      }
      case "ats_json": {
        allWarnings.push(`[ats_json] ${detected.filePath}: parser not wired into this minimal build (descoped -- see README). Skipped.`);
        break;
      }
      case "github": {
        const { fragment, warnings } = await fetchGithubFragment(detected.url!);
        allWarnings.push(...warnings);
        fragments.push(fragment);
        break;
      }
      case "linkedin":
        allWarnings.push(`[linkedin] ${detected.url}: descoped, no public API available for this assignment. Skipped.`);
        break;
      case "resume":
        allWarnings.push(`[resume] ${detected.filePath}: descoped in this minimal build. Skipped.`);
        break;
      case "recruiter_notes":
        allWarnings.push(`[recruiter_notes] ${detected.filePath}: descoped in this minimal build. Skipped.`);
        break;
      default:
        allWarnings.push(`[unknown] '${input}': ${detected.reason}. Skipped -- a missing/garbage source must not crash the run.`);
    }
  }

  // -------- MERGE --------
  const groups = matchFragments(fragments.filter((f) => f._matchHints.length > 0 || Object.keys(f).length > 1));
  const canonicalCandidates = groups.map(combineGroup);
  canonicalCandidates.forEach(inferDerivedFields);

  // -------- CONFIDENCE + RESOLVE --------
  const resolved = canonicalCandidates.map(resolveCandidate);

  // -------- PROJECT + VALIDATE --------
  let results: unknown[];
  if (configPath) {
    const config: OutputConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const configCheck = validateConfig(config);
    if (!configCheck.valid) {
      console.error("Invalid config:\n" + configCheck.errors.join("\n"));
      process.exit(1);
    }
    results = resolved.map((r) => {
      const { output, errors } = projectWithConfig(r, config);
      if (errors.length) allWarnings.push(...errors.map((e) => `[project:${r.candidateId}] ${e}`));
      return output;
    });
  } else {
    results = resolved.map((r) => {
      const output = projectDefault(r);
      const { valid, errors } = validateDefaultOutput(output);
      if (!valid) allWarnings.push(...errors.map((e) => `[validate:${r.candidateId}] ${e}`));
      return output;
    });
  }

  const json = JSON.stringify(results, null, 2);
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, json);
    console.error(`Wrote ${results.length} candidate(s) to ${outPath}`);
  } else {
    console.log(json);
  }

  if (allWarnings.length) {
    console.error(`\n--- ${allWarnings.length} warning(s) ---`);
    for (const w of allWarnings) console.error(w);
  }
}

run();
