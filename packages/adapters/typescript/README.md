# @project-surface/adapter-typescript

TypeScript and JavaScript adapter for [project-surface](https://github.com/richardadamik/project-surface).

Uses the TypeScript compiler API, so claims come from a real parse tree rather than regular expressions.

| Extracts | From |
|---|---|
| Packages, scripts, workspaces | `package.json`, npm/pnpm/yarn workspaces |
| Exported symbols | Source files under the package |
| HTTP routes | Express, Fastify, Hono, Next.js App Router |
| Environment variables | `process.env.X` property and element access |
| Evidence | Tests linked to implementations through the **import graph** (`import-graph`), with filename proximity as a labelled fallback (`path-proximity`) |

Toolchain detection is static - the adapter never runs `npm`, `tsc` or a test runner. Only core may execute a command, and only one that already appears in the surface document.