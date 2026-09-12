/**
 * Secret redaction.
 *
 * The surface document is meant to be committed to version control and read by
 * agents, CI, and strangers on the internet. Nothing that flows into it may
 * carry a credential. Two rules hold everywhere in this codebase:
 *
 *   1. Environment variable NAMES are surfaced; VALUES are never read.
 *   2. Any captured process output passes through `sanitizeOutput` before it is
 *      stored, no exceptions.
 *
 * This is deliberately over-eager. A redacted build log is a small annoyance; a
 * committed API key is an incident.
 */

export const REDACTION = "[redacted]";

/** Default cap for stored command output. */
export const MAX_SUMMARY_LENGTH = 2000;

interface Pattern {
  readonly name: string;
  readonly re: RegExp;
  readonly replace: string;
}

const PATTERNS: readonly Pattern[] = Object.freeze([
  {
    name: "private-key-block",
    re: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g,
    replace: REDACTION,
  },
  {
    name: "assignment",
    re: /\b([a-z0-9_.-]*(?:api[_-]?key|secret|token|password|passwd|pwd|credential|authorization|access[_-]?key)[a-z0-9_.-]*)\s*[:=]\s*["]?[^\s",;]{6,}/gi,
    replace: `$1=${REDACTION}`,
  },
  { name: "bearer", re: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, replace: `$1 ${REDACTION}` },
  { name: "aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: REDACTION },
  { name: "openai-key", re: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replace: REDACTION },
  { name: "stripe-key", re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}\b/g, replace: REDACTION },
  { name: "github-token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, replace: REDACTION },
  { name: "github-pat", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replace: REDACTION },
  { name: "slack-token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, replace: REDACTION },
  { name: "google-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: REDACTION },
  {
    name: "jwt",
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replace: REDACTION,
  },
  {
    name: "connection-string",
    re: /\b([a-z][a-z0-9+.-]*:\/\/)[^:/\s]+:[^@\s]+@/gi,
    replace: `$1${REDACTION}@`,
  },
]);

/** Variable names that imply the value is a credential. */
const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|API_KEY|APIKEY|ACCESS_KEY|AUTH)/i;

export function looksSecretName(name: string): boolean {
  return SECRET_NAME.test(name);
}

/** Apply every credential pattern. Safe to call on already-redacted text. */
export function redactText(input: string): string {
  let out = input;
  for (const p of PATTERNS) {
    out = out.replace(p.re, p.replace);
  }
  return out;
}

/**
 * Strip machine-identifying paths. An absolute path leaks the developer home
 * directory, the checkout location, and often the username.
 */
export function redactPaths(input: string, root?: string): string {
  let out = input;
  if (root) {
    const variants = [root, root.replace(/\\/g, "/"), root.replace(/\//g, "\\")];
    for (const v of variants) {
      if (v.length > 2) out = out.split(v).join(".");
    }
  }
  out = out.replace(/(?:[A-Za-z]:)?[\\/](?:Users|home)[\\/][^\\/\s:",]+/g, "~");
  /* Any other absolute path with at least two segments - CI workspaces
     (/builds/group/project, D:\agent\_work\1\s), container mounts, custom
     install locations. Relative paths and URLs (preceded by ':' or '/') are
     left alone. */
  out = out.replace(
    /(?<![\w:./~\\])(?:[A-Za-z]:)?[\\/](?:[^\\/\s:"',;)]+[\\/])+[^\\/\s:"',;)]*/g,
    "<path>"
  );
  return out;
}

export function truncate(input: string, max: number = MAX_SUMMARY_LENGTH): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max)}\n... [truncated ${input.length - max} chars]`;
}

export interface SanitizeOptions {
  root?: string;
  maxLength?: number;
}

/**
 * The single funnel every piece of captured process output must pass through
 * before it can be written to the surface document.
 */
export function sanitizeOutput(input: string, options: SanitizeOptions = {}): string {
  const normalized = input.replace(/\r\n/g, "\n").trim();
  const redacted = redactText(redactPaths(normalized, options.root));
  return truncate(redacted, options.maxLength ?? MAX_SUMMARY_LENGTH);
}

/** Exposed so the test suite can assert coverage of each pattern by name. */
export function patternNames(): string[] {
  return PATTERNS.map((p) => p.name);
}
