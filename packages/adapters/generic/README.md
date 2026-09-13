# @project-surface/adapter-generic

The fallback adapter for [project-surface](https://github.com/Richie11747/project-surface): the floor under every language adapter.

| Extracts | From |
|---|---|
| Commands | `Makefile` targets, `justfile` recipes, `Taskfile.yml` tasks |
| Environment variables | `.env.example` / `.env.sample` / `.env.template` names (values are never read) |

It runs whenever a build file exists, beside whatever language adapter also ran, and it runs *anyway* when no language adapter recognised the project - so a scan never comes back empty and silent. It claims **no capabilities**: guessing behaviour from a Makefile would be exactly the confident-sounding inference this project exists to avoid. The honest result for an unrecognised project is `NO_CAPABILITIES` and a pointer to `.project/surface.declare.yaml`.
