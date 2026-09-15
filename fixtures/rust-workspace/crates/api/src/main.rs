use pricing_core::quote_for;

fn main() {
    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let q = quote_for("widget", 3);
    println!("listening on {port}; sample quote {}", q.total_cents);
}
