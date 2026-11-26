/**
 * The session file on disk: `.project/session.local.json`.
 *
 * Read before every change and written straight back, never held in memory
 * across calls - the CLI and an MCP server often run against the same
 * checkout at the same time, and the one that remembered a copy would
 * contradict the one that did not. A missing or unreadable file is an empty
 * session, not an error: the ledger is an aid, and a tool must keep working
 * when it is absent.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SESSION_FILE } from "../version.js";
import { emptyLedger } from "./ledger.js";
import type { SessionLedger } from "./ledger.js";
import type { Timestamp } from "../schema/types.js";

export function sessionPath(root: string): string {
  return join(root, SESSION_FILE);
}

function isLedger(value: unknown): value is SessionLedger {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v["version"] === 1 &&
    Array.isArray(v["attempts"]) &&
    Array.isArray(v["packs"]) &&
    typeof v["startedAt"] === "string"
  );
}

export function readLedger(root: string, now: Timestamp): SessionLedger {
  let raw: string;
  try {
    raw = readFileSync(sessionPath(root), "utf8");
  } catch {
    return emptyLedger(now);
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isLedger(parsed) ? parsed : emptyLedger(now);
  } catch {
    return emptyLedger(now);
  }
}

export function writeLedger(root: string, ledger: SessionLedger): string {
  const target = sessionPath(root);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  return target;
}

/** Forget the session. Returns whether there was one. */
export function resetLedger(root: string): boolean {
  try {
    rmSync(sessionPath(root));
    return true;
  } catch {
    return false;
  }
}
