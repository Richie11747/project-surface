/**
 * Which commands prove which claims.
 *
 * `surface verify` and the MCP verify tool both go from "these capabilities"
 * to "these commands", and they must agree. A capability is exercised by the
 * commands its evidence entries were recorded from; when no evidence names a
 * command, by the test command of its package, and that fallback is reported
 * rather than silently taken. This is the one place that rule lives.
 *
 * The point of selecting by staleness is to close a loop no retrieval tool
 * can close: a claim that was proven and then stopped being proven can be
 * re-proven with one command, and only the commands that matter are run.
 */

import { indexById } from "../model/ids.js";
import type { Capability, Command, Surface } from "../schema/types.js";

export interface SelectedCapability {
  id: string;
  /** Command ids chosen for this capability, sorted. */
  commandIds: string[];
  /** True when no evidence named a command and the package test command was used instead. */
  fallback: boolean;
}

export interface CommandSelection {
  /** Deduplicated and sorted by id, so a run is reproducible. */
  commands: Command[];
  capabilities: SelectedCapability[];
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id.localeCompare(b.id);
}

/** The test command for a capability's package, or every test command when neither names a package. */
export function packageTestCommands(surface: Surface, capability: Pick<Capability, "packageId">): Command[] {
  return surface.commands.filter(
    (c) => c.kind === "test" && (!capability.packageId || !c.packageId || c.packageId === capability.packageId)
  );
}

export function commandsProving(surface: Surface, capabilities: readonly Capability[]): CommandSelection {
  const evidenceById = indexById(surface.evidence);
  const commandById = indexById(surface.commands);
  const selected = new Map<string, Command>();
  const contributions: SelectedCapability[] = [];

  for (const capability of capabilities) {
    const linked = [
      ...new Set(
        capability.evidence
          .map((ref) => evidenceById.get(ref.id)?.commandId)
          .filter((id): id is string => typeof id === "string")
      ),
    ]
      .map((id) => commandById.get(id))
      .filter((c): c is Command => c !== undefined);

    const fallback = linked.length === 0;
    const chosen = fallback ? packageTestCommands(surface, capability) : linked;
    for (const c of chosen) selected.set(c.id, c);
    contributions.push({ id: capability.id, commandIds: chosen.map((c) => c.id).sort(), fallback });
  }

  return {
    commands: [...selected.values()].sort(byId),
    capabilities: contributions.sort(byId),
  };
}

export function staleCapabilities(surface: Surface): Capability[] {
  return surface.capabilities.filter((c) => c.freshness?.status === "stale");
}

/** Everything needed to re-prove every stale claim, and nothing else. */
export function commandsForStale(surface: Surface): CommandSelection {
  return commandsProving(surface, staleCapabilities(surface));
}
