# @project-surface/adapter-rust

Rust adapter for [project-surface](https://github.com/Richie11747/project-surface). **Static extraction only.**

| Extracts | From |
|---|---|
| Package, workspace members, binaries | `Cargo.toml` (`[package]`, `[workspace] members`, `[[bin]]`) |
| Public items | column-zero `pub fn` / `struct` / `enum` / `trait` / `type` |
| HTTP routes | axum `.route(...)`, actix-web `web::resource(...)` and `#[get(...)]`-style attributes (actix, rocket) |
| Environment variables | `env::var(...)`, `env!(...)`, `option_env!(...)` |
| Evidence | `tests/*.rs` linked to the files their `use` lines name (`import-graph`); inline `#[cfg(test)]` modules linked to their own file (`path-proximity`) |
| Constraints | `rust-version` |

This adapter is line-based rather than AST-based, and says so: public items are `inferred`, routes and manifest facts are `derived`. When `cargo` is absent it marks the stack as unavailable instead of pretending commands would work.

Import edges are reported with the `use` path as written (`reqwest::Client`), so a `forbid-import` rule targets a crate as `reqwest*`.
