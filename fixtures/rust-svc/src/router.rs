use axum::{
    routing::{get, post},
    Router,
};

/// The HTTP surface of the service.
pub fn app() -> Router {
    Router::new()
        .route("/quote", post(create_quote))
        .route("/quote/:id", get(get_quote))
        .route("/health", get(health))
}

async fn create_quote() -> &'static str {
    "created"
}

async fn get_quote() -> &'static str {
    "quote"
}

async fn health() -> &'static str {
    "ok"
}

// These cfg-disabled handlers exercise parser support for fully-qualified
// route attributes without adding Rocket or Actix dependencies to the fixture.
#[cfg(any())]
#[rocket::get("/rocket/quote")]
async fn rocket_quote() -> &'static str {
    "rocket"
}

#[cfg(any())]
#[actix_web::get("/actix/quote")]
async fn actix_quote() -> &'static str {
    "actix"
}
