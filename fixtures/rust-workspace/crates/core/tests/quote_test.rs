use pricing_core::quote_for;

#[tokio::test]
async fn ten_units_get_volume_pricing() {
    let q = quote_for("widget", 10);
    assert_eq!(q.total_cents, 11250);
}
