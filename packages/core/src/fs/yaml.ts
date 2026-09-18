/**
 * YAML for adapters.
 *
 * Core already carries the `yaml` package for the declaration file. Adapters
 * that meet YAML - a Taskfile, a workflow - go through this one function
 * rather than adding the dependency again, and get the same defaults: the
 * 1.2 core schema, no custom tags, and a bounded alias count.
 */

import { parse } from "yaml";

/** The document, or null when the text is not YAML. Never throws. */
export function parseYamlSafe(text: string): unknown {
  try {
    return parse(text);
  } catch {
    return null;
  }
}
