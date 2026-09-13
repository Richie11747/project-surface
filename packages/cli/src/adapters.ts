/**
 * The built-in adapter registry.
 *
 * Order is deterministic and does not imply precedence - the merge rules in
 * core decide which claim wins, based on provenance tier rather than on which
 * adapter happened to run first.
 */

import { genericAdapter } from "@project-surface/adapter-generic";
import { goAdapter } from "@project-surface/adapter-go";
import { pythonAdapter } from "@project-surface/adapter-python";
import { rustAdapter } from "@project-surface/adapter-rust";
import { typescriptAdapter } from "@project-surface/adapter-typescript";
import type { Adapter } from "@project-surface/core";

export const builtinAdapters: Adapter[] = [typescriptAdapter, pythonAdapter, goAdapter, rustAdapter, genericAdapter];

export function adapterById(id: string): Adapter | undefined {
  return builtinAdapters.find((a) => a.id === id);
}
