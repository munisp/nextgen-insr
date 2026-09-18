package main

import (
	"strings"
	"testing"
)

// PAY-8: correction refs must distinguish DIFFERENT discrepancies even when
// agent, rounded amount, and day are identical, and must be stable for the
// SAME discrepancy (dedup), and deterministic transfer ids must be stable.
func TestCorrectionRefDistinguishesDistinctDiscrepancies(t *testing.T) {
	day := "2026-08-16"
	a := CorrectionRef("AGT001", 42.105, day)
	b := CorrectionRef("AGT001", 42.104, day) // same rounded kobo (4210), different discrepancy
	if a == b {
		t.Fatalf("distinct discrepancies conflated into one correction ref: %s", a)
	}
	if !strings.HasPrefix(a, "RECON-CORR-AGT001-4210-") {
		t.Fatalf("unexpected ref shape: %s", a)
	}
}

func TestCorrectionRefStableForSameDiscrepancy(t *testing.T) {
	day := "2026-08-16"
	if CorrectionRef("AGT001", -13.37, day) != CorrectionRef("AGT001", -13.37, day) {
		t.Fatal("same discrepancy must produce the same ref (dedup depends on it)")
	}
	// Sign matters: a +x and a -x discrepancy must not share a key.
	if CorrectionRef("AGT001", 13.37, day) == CorrectionRef("AGT001", -13.37, day) {
		t.Fatal("opposite-signed discrepancies must not share a correction ref")
	}
	// Different day, same amount -> different key.
	if CorrectionRef("AGT001", 13.37, day) == CorrectionRef("AGT001", 13.37, "2026-08-17") {
		t.Fatal("different days must not share a correction ref")
	}
}

func TestCorrectionTransferIDDeterministic(t *testing.T) {
	ref := CorrectionRef("AGT001", 42.105, "2026-08-16")
	id1 := correctionTransferID(ref)
	id2 := correctionTransferID(ref)
	if id1 != id2 || !strings.HasPrefix(id1, "tb-") {
		t.Fatalf("transfer id not deterministic/well-formed: %q vs %q", id1, id2)
	}
	if correctionTransferID("other-ref") == id1 {
		t.Fatal("distinct refs must map to distinct transfer ids")
	}
}

// PAY-8: kobo conversion must ROUND, not truncate (sub-kobo drift).
func TestKoboRounding(t *testing.T) {
	// 0.005 NGN = 0.5 kobo must round to 1, not truncate to 0.
	got := int64(roundKobo(0.005))
	if got != 1 {
		t.Fatalf("expected rounding to 1 kobo, got %d", got)
	}
}
