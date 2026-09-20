/**
 * A small glob matcher for project-relative POSIX paths.
 *
 * Declarations and constraint checks need to name sets of files. Pulling in a
 * glob library for that would be the first non-trivial runtime dependency in
 * core, so this implements the subset people actually write - `**`, `*`, `?`
 * and bare directory prefixes - and nothing else. No brace expansion, no
 * character classes, no negation.
 *
 *   src/**          everything under src/
 *   src             same: a pattern with no wildcard names a file or a tree
 *   *.md            markdown files at the root only
 *   **\/*.test.ts   test files anywhere
 */

const SPECIAL = /[.+^${}()|[\]\\]/g;

export function isGlob(pattern: string): boolean {
  return /[*?]/.test(pattern);
}

/** Compile one pattern. Matching is anchored at both ends and case-sensitive. */
/**
 * Each `**` compiles to an unbounded group, and consecutive groups multiply the
 * ways a non-matching path can be tried. Patterns come from declarations, so a
 * repository can stack doublestars: adjacent ones are folded to one, and a
 * pattern that still carries more than this many matches nothing.
 */
const MAX_DOUBLESTARS = 8;

export function globToRegExp(pattern: string): RegExp {
  const clean = pattern
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "")
    .replace(/(?:\*\*\/)+(?=\*\*)/g, "");
  if ((clean.match(/\*\*/g) ?? []).length > MAX_DOUBLESTARS) return /(?!)/;
  if (!isGlob(clean)) {
    /* A plain path names itself or, when it is a directory, everything below it. */
    return new RegExp(`^${clean.replace(SPECIAL, "\\$&")}(?:/.*)?$`);
  }

  let out = "^";
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (ch === "*") {
      if (clean[i + 1] === "*") {
        // A doublestar followed by a slash may match zero directories, so the slash is folded in.
        const slashAfter = clean[i + 2] === "/";
        out += slashAfter ? "(?:.*/)?" : ".*";
        i += slashAfter ? 2 : 1;
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(SPECIAL, "\\$&");
    }
  }
  return new RegExp(`${out}$`);
}

export function matchesGlob(path: string, pattern: string): boolean {
  return globToRegExp(pattern).test(path);
}

/** Compile a pattern list once and test many paths against it. */
export function globFilter(patterns: readonly string[]): (path: string) => boolean {
  const compiled = patterns.map(globToRegExp);
  return (path) => compiled.some((re) => re.test(path));
}

/** Expand one pattern against a file list. Plain paths expand to themselves when present. */
export function expandGlob(pattern: string, files: readonly string[]): string[] {
  const re = globToRegExp(pattern);
  return files.filter((f) => re.test(f));
}
