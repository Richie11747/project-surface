# @project-surface/adapter-go

Go adapter for [project-surface](https://github.com/richardadamik/project-surface). **Static extraction only.**

| Extracts | From |
|---|---|
| Module and packages | `go.mod`, directory layout |
| Exported declarations | `func`, `type`, `var`, `const` at package level |
| HTTP routes | Registration calls across `net/http`, chi, gin, echo and gorilla |
| Environment variables | `os.Getenv(...)` / `os.LookupEnv(...)` usage |
| Evidence | `_test.go` files linked to their package (`path-proximity`) |

This adapter is line-based rather than AST-based, and says so: its claims are tiered accordingly. When the Go toolchain is absent it marks the stack as unavailable instead of pretending commands would work.