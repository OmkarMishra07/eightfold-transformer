import type { Attributed, CanonicalCandidate } from "../types.js";

/**
 * extract/github: pulls a public GitHub profile via the REST API.
 * Unstructured in the sense the assignment means it: there's no fixed
 * "candidate record" shape on the other end, we're inferring skills/headline
 * from free-form profile + repo data rather than reading named fields.
 *
 * Network/auth failures degrade gracefully: we return an empty fragment +
 * a warning, never throw, so one bad URL can't take down the whole batch.
 */
export interface GithubProfile {
  login: string;
  name: string | null;
  bio: string | null;
  blog: string | null;
  location: string | null;
  email: string | null;
}

export interface GithubRepo {
  name: string;
  language: string | null;
  description: string | null;
  fork: boolean;
}

function usernameFromUrl(url: string): string | null {
  const m = url.match(/github\.com\/([A-Za-z0-9-]+)\/?$/);
  return m ? m[1] : null;
}

export async function fetchGithubFragment(
  url: string
): Promise<{ fragment: Partial<CanonicalCandidate> & { _matchHints: string[] }; warnings: string[] }> {
  const warnings: string[] = [];
  const username = usernameFromUrl(url);
  if (!username) {
    warnings.push(`[github] could not parse username from '${url}' -- skipped.`);
    return { fragment: { _matchHints: [] }, warnings };
  }

  let profile: GithubProfile;
  let repos: GithubRepo[] = [];
  try {
    const profRes = await fetch(`https://api.github.com/users/${username}`, {
      headers: { "User-Agent": "eightfold-candidate-transformer" },
    });
    if (!profRes.ok) {
      warnings.push(`[github] ${username}: API returned ${profRes.status} -- skipped.`);
      return { fragment: { _matchHints: [] }, warnings };
    }
    profile = await profRes.json();

    const repoRes = await fetch(`https://api.github.com/users/${username}/repos?per_page=100`, {
      headers: { "User-Agent": "eightfold-candidate-transformer" },
    });
    if (repoRes.ok) {
      repos = await repoRes.json();
    } else {
      warnings.push(`[github] ${username}: repo list returned ${repoRes.status} -- continuing without repos.`);
    }
  } catch (err: any) {
    warnings.push(`[github] ${username}: network error (${err?.message ?? err}) -- skipped.`);
    return { fragment: { _matchHints: [] }, warnings };
  }

  const src = "github" as const;
  const mk = <T>(value: T, method: Attributed<T>["method"] = "api_fetch", confidence = 0.55): Attributed<T> => ({
    value,
    source: src,
    method,
    confidence, // unstructured / inferred fields default lower than a recruiter's direct field
    rawSourceId: username,
  });

  const fragment: Partial<CanonicalCandidate> & { _matchHints: string[] } = { _matchHints: [] };
  if (profile.name) fragment.fullName = [mk(profile.name)];
  if (profile.email) {
    fragment.emails = [mk(profile.email.toLowerCase(), "api_fetch", 0.65)];
    fragment._matchHints.push(`email:${profile.email.toLowerCase()}`);
  }
  fragment._matchHints.push(`github:${username}`);
  if (profile.bio) fragment.headline = [mk(profile.bio)];
  if (profile.location) {
    fragment.location = {
      city: [mk(profile.location, "regex_extraction", 0.3)], // free text, often "City, Country" -- low-confidence guess
      region: [mk(null)],
      country: [mk(null)],
    };
  }
  fragment.links = {
    linkedin: [mk(null)],
    github: [mk(`https://github.com/${username}`, "direct_field", 0.9)],
    portfolio: [mk(profile.blog || null, "direct_field", profile.blog ? 0.6 : 0)],
    other: [],
  };

  // Languages used across non-fork repos become inferred skills.
  const langCounts = new Map<string, number>();
  for (const r of repos) {
    if (r.fork || !r.language) continue;
    langCounts.set(r.language, (langCounts.get(r.language) ?? 0) + 1);
  }
  if (langCounts.size > 0) {
    const skills = new Map<string, Attributed<string>[]>();
    for (const [lang, count] of langCounts) {
      // confidence scales mildly with repeated use across repos, capped at 0.6
      const conf = Math.min(0.3 + count * 0.05, 0.6);
      skills.set(lang.toLowerCase(), [mk(lang, "heuristic_inference", conf)]);
    }
    fragment.skills = skills;
  }

  return { fragment, warnings };
}
