// Package pricing computes quotes. Specified by docs/pricing.md.
package pricing

import (
	"errors"
	"net/http"
	"os"
)

// ErrUnknownSKU is returned when a SKU has no listed price.
var ErrUnknownSKU = errors.New("unknown sku")

// VolumeThreshold is the quantity at which the volume discount applies.
const VolumeThreshold = 100

var prices = map[string]int{
	"sku-basic": 1000,
	"sku-pro":   2500,
}

// Quote is a computed price for a quantity of one SKU.
type Quote struct {
	SKU        string `json:"sku"`
	Quantity   int    `json:"quantity"`
	UnitPrice  int    `json:"unitPrice"`
	Total      int    `json:"total"`
	Discounted bool   `json:"discounted"`
}

// Calculate returns a Quote, applying the volume discount where it is due.
func Calculate(sku string, quantity int) (Quote, error) {
	unit, ok := prices[sku]
	if !ok {
		return Quote{}, ErrUnknownSKU
	}
	if quantity <= 0 {
		return Quote{}, errors.New("quantity must be positive")
	}

	total := unit * quantity
	discounted := quantity >= VolumeThreshold
	if discounted {
		total = total * 90 / 100
	}

	return Quote{SKU: sku, Quantity: quantity, UnitPrice: unit, Total: total, Discounted: discounted}, nil
}

// Register wires the pricing endpoints onto a mux.
func Register(mux *http.ServeMux) {
	mux.HandleFunc("/pricing/quote", func(w http.ResponseWriter, r *http.Request) {
		if os.Getenv("PRICING_API_TOKEN") == "" {
			http.Error(w, "not configured", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
}
