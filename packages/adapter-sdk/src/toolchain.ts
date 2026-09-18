/**
 * Toolchain presence detection.
 *
 * An adapter needs to know whether a language toolchain exists on this machine,
 * because that decides whether its claims can ever be verified or must be
 * reported as structural-only. It must be able to answer that *without*
 * executing anything - running `go version` to find out whether Go is installed
 * would hand every adapter the process-spawning capability the contract exists
 * to withhold.
 *
 * So this is a filesystem lookup across PATH, using the same extension rules
 * the operating system uses. It is honest about what it proves: the binary is
 * present and looks executable. It does not prove the binary works.
 */

import { existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

function candidateNames(binary: string): string[] {
  if (process.platform !== "win32") return [binary];
  const extensions = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean);
  return [binary, ...extensions.map((ext) => `${binary}${ext.toLowerCase()}`)];
}

/** Whether an executable of this name is resolvable through PATH. */
export function isOnPath(binary: string): boolean {
  const path = process.env.PATH;
  if (!path) return false;

  const names = candidateNames(binary);
  for (const dir of path.split(delimiter)) {
    if (dir.length === 0) continue;
    for (const name of names) {
      const full = join(dir, name);
      try {
        if (existsSync(full) && statSync(full).isFile()) return true;
      } catch {
        /* An unreadable PATH entry is not an answer; keep looking. */
      }
    }
  }
  return false;
}
