/**
 * normalize: pure functions that take a raw value and a guessed locale/context
 * and return a normalized value or null if it can't be confidently normalized.
 * Never throws -- garbage in means null out, never a crash, never a fabricated value.
 */

// Phones -> E.164. We assume India (+91) as default country context for this
// assignment's dataset; a real system would take country from the candidate's
// resolved location. 10-digit local numbers get +91 prepended; numbers that
// already start with + are validated and passed through.
export function normalizePhoneE164(raw: string, defaultCountryCode = "91"): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    const onlyDigits = digits.slice(1);
    if (onlyDigits.length >= 8 && onlyDigits.length <= 15) return `+${onlyDigits}`;
    return null;
  }
  digits = digits.replace(/^0+/, ""); // strip trunk prefix like 0XXXXXXXXXX
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

// Dates -> YYYY-MM. Accepts "Jan 2021", "2021-01", "01/2021", "2021".
const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

export function normalizeDateYYYYMM(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (/^present|current|now$/i.test(s)) return null; // "current" maps to end:null, handled by caller

  let m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}`;

  m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;

  m = s.match(/^([a-z]{3,})\.?\s+(\d{4})$/);
  if (m && MONTHS[m[1].slice(0, 3)]) return `${m[2]}-${MONTHS[m[1].slice(0, 3)]}`;

  m = s.match(/^(\d{4})$/);
  if (m) return `${m[1]}-01`; // year-only: lowest-confidence guess, month defaulted

  return null;
}

// Country -> ISO-3166 alpha-2. Small lookup covering common free-text forms;
// unrecognized input returns null rather than guessing.
const COUNTRY_MAP: Record<string, string> = {
  india: "IN", "united states": "US", usa: "US", "u.s.a.": "US", "u.s.": "US",
  "united kingdom": "GB", uk: "GB", canada: "CA", germany: "DE", france: "FR",
  singapore: "SG", australia: "AU",
};

export function normalizeCountryISO(raw: string | null): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (COUNTRY_MAP[key]) return COUNTRY_MAP[key];
  if (/^[a-z]{2}$/i.test(key)) return key.toUpperCase(); // already looks like an alpha-2 code
  return null;
}

// Skill canonicalization: lowercase, trim, collapse known aliases to one
// canonical spelling so "ReactJS", "react.js", "React" all merge into "react".
const SKILL_ALIASES: Record<string, string> = {
  "react.js": "react", reactjs: "react", "node.js": "nodejs", nodejs: "nodejs",
  node: "nodejs", js: "javascript", ts: "typescript", "c++": "cpp", golang: "go",
};

export function normalizeSkillName(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return SKILL_ALIASES[key] ?? key;
}
