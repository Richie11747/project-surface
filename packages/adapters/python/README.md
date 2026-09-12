# @project-surface/adapter-python

Python adapter for [project-surface](https://github.com/Richie11747/project-surface).

| Extracts | From |
|---|---|
| Project metadata, scripts, entry points | `pyproject.toml` |
| Test configuration | pytest sections in `pyproject.toml` |
| Public symbols | Module-level definitions |
| HTTP routes | FastAPI and Flask route decorators |
| Environment variables | `os.environ[...]`, `os.environ.get(...)`, `os.getenv(...)` |
| Evidence | Tests linked to the modules they import (`import-graph`) |

The parser is a purpose-built line and token scanner - no Python interpreter is required or invoked. Nothing in this package executes a command.