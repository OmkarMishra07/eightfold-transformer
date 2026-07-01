import Ajv from "ajv";
import type { OutputConfig } from "../types.js";

const ajv = new Ajv({ allowUnionTypes: true });

// JSON Schema for the DEFAULT output, mirroring the assignment's table exactly.
export const defaultSchema = {
  type: "object",
  required: ["candidate_id", "full_name", "emails", "phones"],
  properties: {
    candidate_id: { type: "string" },
    full_name: { type: ["string", "null"] },
    emails: { type: "array", items: { type: "string" } },
    phones: { type: "array", items: { type: "string" } },
    location: {
      type: "object",
      properties: {
        city: { type: ["string", "null"] },
        region: { type: ["string", "null"] },
        country: { type: ["string", "null"] },
      },
    },
    links: {
      type: "object",
      properties: {
        linkedin: { type: ["string", "null"] },
        github: { type: ["string", "null"] },
        portfolio: { type: ["string", "null"] },
        other: { type: "array", items: { type: "string" } },
      },
    },
    headline: { type: ["string", "null"] },
    years_experience: { type: ["number", "null"] },
    skills: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          confidence: { type: "number" },
          sources: { type: "array", items: { type: "string" } },
        },
      },
    },
    experience: { type: "array" },
    education: { type: "array" },
    provenance: { type: "array" },
    overall_confidence: { type: "number" },
  },
} as const;

const validateDefault = ajv.compile(defaultSchema);

export function validateDefaultOutput(output: unknown): { valid: boolean; errors: string[] } {
  const valid = validateDefault(output);
  return { valid: !!valid, errors: (validateDefault.errors ?? []).map((e) => `${e.instancePath} ${e.message}`) };
}

/**
 * validateConfig: sanity-checks a runtime OutputConfig before we ever run a
 * candidate through it -- catching typos/malformed configs early rather than
 * failing confusingly mid-projection (robustness requirement).
 */
export function validateConfig(config: OutputConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(config.fields) || config.fields.length === 0) {
    errors.push("config.fields must be a non-empty array.");
  }
  for (const f of config.fields ?? []) {
    if (!f.path) errors.push(`field missing 'path': ${JSON.stringify(f)}`);
    if (!f.from) errors.push(`field missing 'from': ${JSON.stringify(f)}`);
    if (!["string", "number", "boolean", "string[]", "number[]", "object", "object[]"].includes(f.type)) {
      errors.push(`field '${f.path}' has invalid type '${f.type}'`);
    }
  }
  if (!["null", "omit", "error"].includes(config.on_missing)) {
    errors.push(`config.on_missing must be one of null|omit|error, got '${config.on_missing}'`);
  }
  return { valid: errors.length === 0, errors };
}
