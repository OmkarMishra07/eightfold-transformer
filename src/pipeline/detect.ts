import fs from "node:fs";
import path from "node:path";
import type { SourceType } from "../types.js";

export interface DetectedSource {
  type: SourceType | "unknown";
  filePath?: string;
  url?: string;
  reason: string;
}

/**
 * detect: classify a raw input (file path or URL string) into a SourceType.
 * Cheap, structural checks only -- no parsing of content yet (that's extract's job).
 * Unknown / unreadable inputs are tagged "unknown" rather than thrown away,
 * so the pipeline can log + skip them (robustness requirement).
 */
export function detectSource(input: string): DetectedSource {
  // URL-shaped inputs
  if (/^https?:\/\//i.test(input)) {
    if (/github\.com/i.test(input)) {
      return { type: "github", url: input, reason: "URL host matches github.com" };
    }
    if (/linkedin\.com/i.test(input)) {
      return { type: "linkedin", url: input, reason: "URL host matches linkedin.com" };
    }
    return { type: "unknown", url: input, reason: "Unrecognized URL host" };
  }

  // File-shaped inputs
  if (!fs.existsSync(input)) {
    return { type: "unknown", filePath: input, reason: "File does not exist" };
  }

  const ext = path.extname(input).toLowerCase();
  const base = path.basename(input).toLowerCase();

  if (ext === ".csv") {
    return { type: "recruiter_csv", filePath: input, reason: "CSV extension" };
  }
  if (ext === ".json") {
    return { type: "ats_json", filePath: input, reason: "JSON extension" };
  }
  if (ext === ".txt") {
    if (base.includes("note")) {
      return { type: "recruiter_notes", filePath: input, reason: "txt file named like notes" };
    }
    return { type: "recruiter_notes", filePath: input, reason: "Defaulting bare .txt to free-text notes" };
  }
  if (ext === ".pdf" || ext === ".docx") {
    return { type: "resume", filePath: input, reason: `${ext} extension implies resume/prose` };
  }

  return { type: "unknown", filePath: input, reason: `Unrecognized extension '${ext}'` };
}
