// Command server runs the pricing service.
package main

import (
	"log"
	"net/http"
	"os"

	"github.com/example/pricing-svc/internal/pricing"
)

func main() {
	addr := os.Getenv("PRICING_LISTEN_ADDR")
	if addr == "" {
		addr = ":8080"
	}

	mux := http.NewServeMux()
	pricing.Register(mux)

	log.Printf("pricing-svc listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}
