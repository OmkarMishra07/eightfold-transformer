import fs from "node:fs";
import type { Attributed, CanonicalCandidate } from "../types.js";

/**
 * extract/recruiterCsv: parses a structured CSV export.
 * Expected columns (header-driven, order independent): name, email, phone,
 * current_company, title. Malformed rows (missing required cell, wrong column
 * count) are skipped with a warning -- they never crash the run.
 */
export interface RawRecruiterRow {
  rowNumber: number;
  name?: string;
  email?: string;
  phone?: string;
  current_company?: string;
  title?: string;
}

export function parseRecruiterCsv(filePath: string): { rows: RawRecruiterRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const text = fs.readFileSync(filePath, "utf-8").trim();
  if (!text) {
    warnings.push(`[recruiter_csv] ${filePath} is empty -- skipping.`);
    return { rows: [], warnings };
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const rows: RawRecruiterRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length !== header.length) {
      warnings.push(`[recruiter_csv] row ${i + 1} has ${cells.length} cells, expected ${header.length} -- skipped.`);
      continue;
    }
    const row: RawRecruiterRow = { rowNumber: i + 1 };
    header.forEach((h, idx) => {
      const v = cells[idx]?.trim();
      if (v) (row as any)[h] = v;
    });
    if (!row.name && !row.email) {
      warnings.push(`[recruiter_csv] row ${i + 1} has neither name nor email -- skipped (unusable).`);
      continue;
    }
    rows.push(row);
  }
  return { rows, warnings };
}

// Minimal CSV splitter that handles quoted fields with embedded commas.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Lift parsed CSV rows into Attributed<> fragments. One CSV row = one candidate
 * fragment to be merged later. We do NOT normalize here (that's normalize.ts's
 * job) -- extraction stays close to the raw source for traceability.
 */
export function csvRowToFragment(row: RawRecruiterRow): Partial<CanonicalCandidate> & { _matchHints: string[] } {
  const src = "recruiter_csv" as const;
  const mk = <T>(value: T): Attributed<T> => ({
    value,
    source: src,
    method: "direct_field",
    confidence: 0.7, // structured but single-source, unverified -- see confidence.ts for full scoring
    rawSourceId: `row ${row.rowNumber}`,
  });

  const frag: Partial<CanonicalCandidate> & { _matchHints: string[] } = { _matchHints: [] };
  if (row.name) frag.fullName = [mk(row.name)];
  if (row.email) {
    frag.emails = [mk(row.email.toLowerCase())];
    frag._matchHints.push(`email:${row.email.toLowerCase()}`);
  }
  if (row.phone) frag.phones = [mk(row.phone)];
  if (row.title || row.current_company) {
    frag.experience = [
      mk({
        company: row.current_company ?? "",
        title: row.title ?? "",
        start: null,
        end: null,
        summary: null,
      }),
    ];
  }
  return frag;
}
