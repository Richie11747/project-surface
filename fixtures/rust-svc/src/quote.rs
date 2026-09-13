use std::env;

/// A price quote for a quantity of one SKU.
#[derive(Debug, Clone, PartialEq)]
pub struct Quote {
    pub sku: String,
    pub quantity: u32,
    pub total_cents: u64,
    pub currency: String,
}

/// Quote a quantity of a SKU. Volume pricing kicks in at ten units.
pub fn quote_for(sku: &str, quantity: u32) -> Quote {
    let unit = unit_price_cents(sku);
    let discounted = if quantity >= 10 { unit * 9 / 10 } else { unit };
    Quote {
        sku: sku.to_string(),
        quantity,
        total_cents: discounted * u64::from(quantity),
        currency: env::var("PRICING_CURRENCY").unwrap_or_else(|_| "EUR".to_string()),
    }
}

fn unit_price_cents(sku: &str) -> u64 {
    match sku {
        "widget" => 1250,
        "gadget" => 4999,
        _ => 100,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_unit_is_list_price() {
        assert_eq!(quote_for("widget", 1).total_cents, 1250);
    }
}
