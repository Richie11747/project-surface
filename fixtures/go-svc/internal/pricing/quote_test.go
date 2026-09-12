package pricing

import "testing"

func TestCalculateAppliesUnitPrice(t *testing.T) {
	q, err := Calculate("sku-basic", 3)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if q.Total != 3000 {
		t.Fatalf("total = %d, want 3000", q.Total)
	}
	if q.Discounted {
		t.Fatal("small order should not be discounted")
	}
}

func TestCalculateAppliesVolumeDiscount(t *testing.T) {
	q, err := Calculate("sku-basic", VolumeThreshold)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !q.Discounted {
		t.Fatal("order at the threshold should be discounted")
	}
	if q.Total != 90000 {
		t.Fatalf("total = %d, want 90000", q.Total)
	}
}

func TestCalculateRejectsUnknownSKU(t *testing.T) {
	if _, err := Calculate("sku-missing", 1); err != ErrUnknownSKU {
		t.Fatalf("err = %v, want ErrUnknownSKU", err)
	}
}
