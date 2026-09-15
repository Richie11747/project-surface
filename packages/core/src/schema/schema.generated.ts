/**
 * GENERATED FILE - DO NOT EDIT BY HAND.
 *
 * Source:     spec/v1/surface.schema.json
 * Regenerate: node scripts/gen-schema-module.mjs
 *
 * CI runs this script with --check, so an edit here without a matching edit
 * to the spec fails the build.
 */

export const SURFACE_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze(
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://richie11747.github.io/project-surface/spec/v1/surface.schema.json",
  "title": "project-surface/v1",
  "description": "A machine-readable, evidence-backed model of a software project.",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema","generatedAt","generator","project","commands","capabilities","constraints","environment","risks","evidence","health","git"],
  "properties": {
    "schema": { "const": "project-surface/v1" },
    "generatedAt": { "$ref": "#/$defs/timestamp" },
    "generator": {
      "type": "object", "additionalProperties": false,
      "required": ["name","version"],
      "properties": { "name": { "type": "string", "minLength": 1 }, "version": { "type": "string", "minLength": 1 } }
    },
    "project": {
      "type": "object", "additionalProperties": false,
      "required": ["name","root","stacks","packages"],
      "properties": {
        "name": { "type": "string", "minLength": 1 },
        "root": { "const": "." },
        "stacks": { "type": "array", "items": { "$ref": "#/$defs/stack" } },
        "packages": { "type": "array", "items": { "$ref": "#/$defs/package" } }
      }
    },
    "commands": { "type": "array", "items": { "$ref": "#/$defs/command" } },
    "capabilities": { "type": "array", "items": { "$ref": "#/$defs/capability" } },
    "constraints": { "type": "array", "items": { "$ref": "#/$defs/constraint" } },
    "environment": { "type": "array", "items": { "$ref": "#/$defs/environmentVariable" } },
    "risks": { "type": "array", "items": { "$ref": "#/$defs/risk" } },
    "evidence": { "type": "array", "items": { "$ref": "#/$defs/evidenceEntry" } },
    "health": { "type": "array", "items": { "$ref": "#/$defs/healthFinding" } },
    "git": { "$ref": "#/$defs/git" }
  },
  "$defs": {
    "timestamp": {
      "type": "string",
      "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,3})?Z$",
      "description": "ISO-8601 UTC, always Z-suffixed."
    },
    "relPath": {
      "type": "string", "minLength": 1,
      "not": { "anyOf": [
        { "pattern": "^/" },
        { "pattern": "^[A-Za-z]:" },
        { "pattern": "\\\\" },
        { "pattern": "(^|/)[.][.](/|$)" },
        { "pattern": "^~" }
      ] },
      "description": "POSIX-separated path relative to the project root. Absolute paths, Windows drive letters, backslashes, home-relative paths and parent traversal are forbidden."
    },
    "identifier": {
      "type": "string", "minLength": 1, "maxLength": 200,
      "pattern": "^[a-z0-9][a-z0-9._:/-]*$",
      "description": "Stable, deterministic, lowercase identifier. Must not change between runs for an unchanged project."
    },
    "confidence": {
      "type": "number", "minimum": 0, "maximum": 1,
      "description": "Computed from provenance tier, corroborating source count, and freshness. Never authored by hand."
    },
    "sourceRef": {
      "type": "object", "additionalProperties": false,
      "required": ["path"],
      "properties": {
        "path": { "$ref": "#/$defs/relPath" },
        "locator": { "type": "string", "description": "Where inside the file, for example scripts.test, L12-L40, or export:createCheckout." }
      }
    },
    "provenance": {
      "type": "object", "additionalProperties": false,
      "required": ["tier","sources","adapter","observedAt"],
      "properties": {
        "tier": {
          "enum": ["declared","verified","derived","inferred"],
          "description": "declared = a human asserted it. verified = a command was executed and observed. derived = read from structured configuration or a parsed syntax tree. inferred = heuristic guess."
        },
        "sources": {
          "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/sourceRef" },
          "description": "At least one source is mandatory. A claim with no source is not a claim."
        },
        "adapter": { "type": "string", "minLength": 1 },
        "observedAt": { "$ref": "#/$defs/timestamp" }
      }
    },
    "freshness": {
      "type": "object", "additionalProperties": false,
      "required": ["status"],
      "properties": {
        "status": { "enum": ["fresh","stale","unknown"] },
        "verifiedAt": { "$ref": "#/$defs/timestamp" },
        "ownersFingerprint": { "type": "string", "description": "Hash over the owner files, used to invalidate the claim when they change." },
        "staleAfterDays": { "type": "number", "minimum": 0 },
        "reason": { "type": "string" }
      }
    },
    "stack": {
      "type": "object", "additionalProperties": false,
      "required": ["id","adapter","adapterVersion","toolchainAvailable"],
      "properties": {
        "id": { "$ref": "#/$defs/identifier" },
        "adapter": { "type": "string", "minLength": 1 },
        "adapterVersion": { "type": "string", "minLength": 1 },
        "toolchainAvailable": { "type": "boolean", "description": "False when the language toolchain is absent. Evidence for this stack must then be reported as unknown, never as passed." },
        "notes": { "type": "array", "items": { "type": "string" } }
      }
    },
    "package": {
      "type": "object", "additionalProperties": false,
      "required": ["id","path"],
      "properties": {
        "id": { "$ref": "#/$defs/identifier" },
        "path": { "$ref": "#/$defs/relPath" },
        "name": { "type": "string" },
        "manager": { "type": "string" },
        "private": { "type": "boolean" }
      }
    },
    "command": {
      "type": "object", "additionalProperties": false,
      "required": ["id","run","cwd","kind","provenance","confidence"],
      "properties": {
        "id": { "$ref": "#/$defs/identifier" },
        "run": { "type": "string", "minLength": 1 },
        "cwd": { "type": "string", "description": "Working directory relative to the project root; a single dot for the root itself." },
        "kind": { "enum": ["test","build","dev","lint","typecheck","format","start","migrate","other"] },
        "packageId": { "$ref": "#/$defs/identifier" },
        "description": { "type": "string" },
        "verification": { "$ref": "#/$defs/verificationRecord" },
        "provenance": { "$ref": "#/$defs/provenance" },
        "confidence": { "$ref": "#/$defs/confidence" },
        "freshness": { "$ref": "#/$defs/freshness" }
      }
    },
    "verificationRecord": {
      "type": "object", "additionalProperties": false,
      "required": ["status","observedAt"],
      "properties": {
        "status": { "enum": ["passed","failed","unknown","skipped"] },
        "exitCode": { "type": ["integer","null"] },
        "durationMs": { "type": "number", "minimum": 0 },
        "observedAt": { "$ref": "#/$defs/timestamp" },
        "summary": { "type": "string", "description": "Redacted and truncated command output." },
        "reason": { "type": "string", "description": "Why the status is unknown or skipped." }
      }
    },
    "evidenceRef": {
      "type": "object", "additionalProperties": false,
      "required": ["id","link"],
      "properties": {
        "id": { "$ref": "#/$defs/identifier" },
        "link": {
          "enum": ["import-graph","path-proximity","declared","config"],
          "description": "How this evidence was associated with the capability. import-graph is strong; path-proximity is a guess."
        }
      }
    },
    "capability": {
      "type": "object", "additionalProperties": false,
      "required": ["id","title","kind","owners","contracts","evidence","environment","tags","provenance","confidence"],
      "properties": {
        "id": { "$ref": "#/$defs/identifier" },
        "title": { "type": "string", "minLength": 1 },
        "description": { "type": "string" },
        "kind": { "enum": ["route","export","command","job","module"] },
        "packageId": { "$ref": "#/$defs/identifier" },
        "owners": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/sourceRef" } },
        "contracts": { "type": "array", "items": { "$ref": "#/$defs/sourceRef" } },
        "evidence": { "type": "array", "items": { "$ref": "#/$defs/evidenceRef" } },
        "environment": { "type": "array", "items": { "type": "string" }, "description": "Environment variable NAMES only. Values are never recorded." },
        "tags": { "type": "array", "items": { "type": "string" } },
        "route": {
          "type": "object", "additionalProperties": false,
          "required": ["method","path"],
          "properties": { "method": { "type": "string" }, "path": { "type": "string" } }
        },
        "aliases": { "type": "array", "items": { "$ref": "#/$defs/identifier" } },
        "provenance": { "$ref": "#/$defs/provenance" },
        "confidence": { "$ref": "#/$defs/confidence" },
        "freshness": { "$ref": "#/$defs/freshness" }
      }
    },
    "constraint": {
      "type": "object", "additionalProperties": false,
      "required": ["id","rule","severity","status","provenance","confidence"],
      "properties": {
        "id": { "$ref": "#/$defs/identifier" },
        "rule": { "type": "string", "minLength": 1 },
        "rationale": { "type": "string" },
        "severity": { "enum": ["error","warn","info"] },
        "status": { "enum": ["active","stale"] },
        "provenance": { "$ref": "#/$defs/provenance" },
        "confidence": { "$ref": "#/$defs/confidence" },
        "freshness": { "$ref": "#/$defs/freshness" },
        "check": { "$ref": "#/$defs/constraintCheck" },
        "checked": { "$ref": "#/$defs/constraintOutcome" }
      }
    },
    "constraintCheck": {
      "type": "object", "additionalProperties": false,
      "required": ["kind"],
      "description": "A machine-checkable form of the rule. Evaluated on every scan; a failure is a CONSTRAINT_VIOLATED health finding at the constraint's severity.",
      "properties": {
        "kind": { "enum": ["forbid-import","forbid-file","require-test","forbid-env","max-owners"] },
        "from": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/globPattern" } },
        "to": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/globPattern" } },
        "paths": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/globPattern" } },
        "names": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1, "pattern": "^[A-Za-z0-9_*?]+$" }, "description": "forbid-env: environment variable names; * and ? are wildcards over the whole name." },
        "limit": { "type": "integer", "minimum": 1, "description": "max-owners: the most owner files a capability may have." }
      }
    },
    "constraintOutcome": {
      "type": "object", "additionalProperties": false,
      "required": ["status","violations"],
      "description": "What the generator found when it evaluated check.",
      "properties": {
        "status": { "enum": ["passed","violated","unchecked"] },
        "violations": { "type": "integer", "minimum": 0 },
        "reason": { "type": "string" }
      }
    },
    "globPattern": {
      "type": "string", "minLength": 1,
      "not": { "anyOf": [ { "pattern": "^/" }, { "pattern": "^[A-Za-z]:" }, { "pattern": "\\\\" }, { "pattern": "(^|/)[.][.](/|$)" }, { "pattern": "^~" } ] },
      "description": "A project-relative path or glob (** crosses directories, * and ? do not), or for `to` a bare module specifier such as stripe or @stripe/*. Same restrictions as relPath."
    },
    "environmentVariable": {
      "type": "object", "additionalProperties": false,
      "required": ["name","required","secret","usedBy","provenance","confidence"],
      "properties": {
        "name": { "type": "string", "minLength": 1 },
        "required": { "type": "boolean" },
        "secret": { "type": "boolean", "description": "Whether the NAME looks secret-bearing. The value is never stored regardless." },
        "usedBy": { "type": "array", "items": { "$ref": "#/$defs/sourceRef" } },
        "provenance": { "$ref": "#/$defs/provenance" },
        "confidence": { "$ref": "#/$defs/confidence" },
        "freshness": { "$ref": "#/$defs/freshness" }
      }
    },
    "risk": {
      "type": "object", "additionalProperties": false,
      "required": ["id","type","paths","approval","reason","provenance","confidence"],
      "properties": {
        "id": { "$ref": "#/$defs/identifier" },
        "type": { "enum": ["migration","secret","infra","generated","external-service"] },
        "paths": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/relPath" } },
        "approval": { "enum": ["required","advisory"] },
        "reason": { "type": "string", "minLength": 1 },
        "provenance": { "$ref": "#/$defs/provenance" },
        "confidence": { "$ref": "#/$defs/confidence" },
        "freshness": { "$ref": "#/$defs/freshness" }
      }
    },
    "evidenceEntry": {
      "type": "object", "additionalProperties": false,
      "required": ["id","kind","status","provenance","confidence"],
      "properties": {
        "id": { "$ref": "#/$defs/identifier" },
        "kind": { "enum": ["test","build","typecheck","lint","runtime"] },
        "path": { "$ref": "#/$defs/relPath" },
        "commandId": { "$ref": "#/$defs/identifier" },
        "status": { "enum": ["passed","failed","unknown","stale"], "description": "passed requires an actual observed execution. Static discovery of a test file yields unknown." },
        "observedAt": { "$ref": "#/$defs/timestamp" },
        "summary": { "type": "string" },
        "provenance": { "$ref": "#/$defs/provenance" },
        "confidence": { "$ref": "#/$defs/confidence" },
        "freshness": { "$ref": "#/$defs/freshness" }
      }
    },
    "healthFinding": {
      "type": "object", "additionalProperties": false,
      "required": ["code","severity","message"],
      "properties": {
        "code": { "type": "string", "pattern": "^[A-Z][A-Z0-9_]*$" },
        "severity": { "enum": ["error","warn","info"] },
        "message": { "type": "string", "minLength": 1 },
        "subject": {
          "type": "object", "additionalProperties": false,
          "required": ["kind","id"],
          "properties": {
            "kind": { "enum": ["capability","command","constraint","evidence","environment","risk","package","project"] },
            "id": { "type": "string" }
          }
        },
        "paths": { "type": "array", "items": { "$ref": "#/$defs/relPath" } },
        "remediation": { "type": "string" }
      }
    },
    "git": {
      "type": "object", "additionalProperties": false,
      "required": ["available"],
      "properties": {
        "available": { "type": "boolean" },
        "head": { "type": "string" },
        "branch": { "type": "string" },
        "dirty": { "type": "boolean" },
        "recentChanges": {
          "type": "array",
          "items": {
            "type": "object", "additionalProperties": false,
            "required": ["path","commits"],
            "properties": {
              "path": { "$ref": "#/$defs/relPath" },
              "commits": { "type": "integer", "minimum": 1 },
              "lastTouched": { "$ref": "#/$defs/timestamp" }
            }
          }
        }
      }
    }
  }
}
);
