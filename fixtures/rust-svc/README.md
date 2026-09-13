# pricing-svc

A deliberately small Rust service used as a project-surface fixture. It exists to show the
structural adapter at its ceiling: public items and axum routes from a line scan, an
integration test linked to `src/quote.rs` through its `use` line rather than its filename,
and an inline `#[cfg(test)]` module reported as the weakest link it honestly is.
