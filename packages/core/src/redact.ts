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
    /* Every quantifier here is bounded. An unbounded `[a-z0-9_.-]*` before the
       keyword made the match quadratic in the length of any long dash- or
       dot-separated token, and captured output is attacker-shaped. */
    name: "assignment",
    re: /\b([a-z0-9_.-]{0,128}?(?:api[_-]?key|secret|token|password|passwd|pwd|credential|authorization|access[_-]?key|private[_-]?key)[a-z0-9_.-]{0,128})\s*[:=]\s*["]?[^\s",;]{6,}/gi,
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
    /* Bounded for the same reason: an unbounded password class ran to the end
       of the text looking for `@` once per `://`. */
    name: "connection-string",
    re: /\b([a-z][a-z0-9+.-]{0,32}:\/\/)[^:/\s@]{1,128}:[^@\s]{1,256}@/gi,
    replace: `$1${REDACTION}@`,
  },
]);

/**
 * Redaction is regular-expression work, and the caller hands it whatever a
 * project command printed. Only the part that can survive the length cap is
 * scanned, plus this much headroom so a credential straddling the cut is
 * still matched whole rather than half-kept.
 */
const REDACTION_HEADROOM = 4096;

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

/**
 * Replace known secret values verbatim. Pattern matching guesses at what a
 * credential looks like; when the exact value is known - the runner inherits
 * the operator's environment - there is no reason to guess.
 */
export function redactValues(input: string, values: readonly string[]): string {
  let out = input;
  /* Longest first, so a value that contains another is replaced whole. */
  for (const v of [...new Set(values)].filter((v) => v.length >= 6).sort((a, b) => b.length - a.length)) {
    out = out.split(v).join(REDACTION);
  }
  return out;
}

/** The values of every variable whose name says it holds a credential. */
export function secretEnvValues(env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === "string" && value.length >= 6 && looksSecretName(name)) out.push(value);
  }
  return out;
}

export interface SanitizeOptions {
  root?: string;
  maxLength?: number;
  /** Exact values to remove wherever they appear, before any pattern runs. */
  secrets?: readonly string[];
}

/**
 * The single funnel every piece of captured process output must pass through
 * before it can be written to the surface document.
 */
export function sanitizeOutput(input: string, options: SanitizeOptions = {}): string {
  const max = options.maxLength ?? MAX_SUMMARY_LENGTH;
  const normalized = input.replace(/\r\n/g, "\n").trim();
  const window = normalized.length > max + REDACTION_HEADROOM
    ? normalized.slice(0, max + REDACTION_HEADROOM)
    : normalized;
  const dropped = normalized.length - window.length;

  const scrubbed = options.secrets?.length ? redactValues(window, options.secrets) : window;
  const redacted = redactText(redactPaths(scrubbed, options.root));

  if (redacted.length <= max) {
    return dropped > 0 ? `${redacted}\n... [truncated ${dropped} chars]` : redacted;
  }
  return `${redacted.slice(0, max)}\n... [truncated ${redacted.length - max + dropped} chars]`;
}

/** Exposed so the test suite can assert coverage of each pattern by name. */
export function patternNames(): string[] {
  return PATTERNS.map((p) => p.name);
}
