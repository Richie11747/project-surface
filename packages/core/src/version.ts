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

/** Machine-local state that must never be committed. */
export const CACHE_DIR = ".project/cache";
