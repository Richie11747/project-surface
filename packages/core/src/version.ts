/**
 * Generator identity and well-known paths.
 *
 * `GENERATOR_VERSION` is asserted against packages/core/package.json by the
 * test suite, so a release that bumps one without the other fails.
 */

export const GENERATOR_NAME = "project-surface";
export const GENERATOR_VERSION = "0.2.0";
export const SPEC_VERSION = "project-surface/v1";

/** Everything project-surface writes lives here, so it is easy to inspect or delete. */
export const SURFACE_DIR = ".project";
export const SURFACE_FILE = ".project/surface.json";

/** Human declarations. Always wins over inference. */
export const DECLARATIONS_FILE = ".project/surface.declare.yaml";

/**
 * Machine-local session state: what was run, what was served, and what that
 * says about the current run. Never committed - `.project/*.local.json` is the
 * documented gitignore pattern - and never part of the surface document.
 */
export const SESSION_FILE = ".project/session.local.json";

