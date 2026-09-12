/**
 * Document validation.
 *
 * The pipeline validates every document it produces *before* writing it. A
 * schema violation is treated as a bug in an adapter, not as a warning to the
 * user: emitting a malformed surface would poison every downstream consumer,
 * and the whole premise of the project is that the artifact can be trusted.
 */

import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import { SURFACE_SCHEMA } from "./schema.generated.js";
import type { Surface } from "./types.js";

let compiled: ValidateFunction | undefined;

/** Compiled once per process; ajv compilation is the expensive part. */
function validator(): ValidateFunction {
  compiled ??= new Ajv2020({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
  }).compile(SURFACE_SCHEMA);
  return compiled;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function formatError(e: ErrorObject): string {
  const where = e.instancePath.length > 0 ? e.instancePath : "(root)";
  const extra =
    e.keyword === "additionalProperties" && typeof e.params.additionalProperty === "string"
      ? `: ${e.params.additionalProperty}`
      : "";
  return `${where} ${e.message ?? "is invalid"}${extra}`;
}

export function validateSurface(doc: unknown): ValidationResult {
  const validate = validator();
  const valid = validate(doc) as boolean;
  if (valid) return { valid: true, errors: [] };
  return { valid: false, errors: (validate.errors ?? []).map(formatError) };
}

export class SurfaceValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    const preview = errors.slice(0, 10).join("\n  ");
    const more = errors.length > 10 ? `\n  ... and ${errors.length - 10} more` : "";
    super(`Surface document failed schema validation:\n  ${preview}${more}`);
    this.name = "SurfaceValidationError";
    this.errors = errors;
  }
}

export function assertValidSurface(doc: unknown): asserts doc is Surface {
  const result = validateSurface(doc);
  if (!result.valid) throw new SurfaceValidationError(result.errors);
}
