# rust-workspace

A two-crate Cargo workspace used as a project-surface fixture. The root manifest is virtual,
`crates/api` declares a named `[[bin]]`, and `crates/core` is a library whose integration
test is a `#[tokio::test]`. It exists to pin two things: a workspace member gets its own
`cargo run -p <crate>` command, and a runtime-provided test attribute counts as a test.
