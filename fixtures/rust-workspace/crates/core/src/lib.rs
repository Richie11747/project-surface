/// A priced quote for a quantity of one SKU.
pub struct Quote {
    pub sku: String,
    pub total_cents: u64,
}

/// Unit price with a volume discount above ten units.
pub fn quote_for(sku: &str, quantity: u64) -> Quote {
    let unit = 1250;
    let discount = if quantity >= 10 { 10 } else { 0 };
    let total = unit * quantity * (100 - discount) / 100;
    Quote { sku: sku.to_string(), total_cents: total }
}
