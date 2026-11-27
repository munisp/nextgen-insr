// golden_test.go is the Leg B golden-quote acceptance test (Appendix H):
// 20 quotes across 6 representative lines rated through the real cgo
// library and compared to Leg A reference outputs.
//
// The reference outputs (testdata/golden_expected.csv) are produced by the
// Leg A driver testdata/refgen.c, which links libactuary_kernels.so
// directly — never through Go — so the comparison is a genuine
// cross-language determinism check (Appendix F).
//
// Regeneration flow (documented in testdata/README.md):
//
//	AK_GOLDEN_DUMP=/tmp/resolved_inputs.csv go test ./internal/service -run TestGoldenQuotes
//	cc -O2 -o /tmp/refgen testdata/refgen.c -L../../kernels/target/release -lactuary_kernels
//	LD_LIBRARY_PATH=../../kernels/target/release /tmp/refgen /tmp/resolved_inputs.csv testdata/golden_expected.csv
package service_test

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strconv"
	"testing"

	"github.com/unified-insurance/actuary-engine/pricing/internal/kernels"
	"github.com/unified-insurance/actuary-engine/pricing/internal/models"
)

// GoldenQuote is one row of testdata/golden_quotes.json.
type GoldenQuote struct {
	ID          string            `json:"id"`
	ProductLine string            `json:"productLine"`
	Variables   map[string]string `json:"variables"`
	SumInsured  float64           `json:"sumInsured"`
	Exposures   float64           `json:"exposures"`
	GeoCell     string            `json:"geoCell"`
}

type goldenFile struct {
	Quotes []GoldenQuote `json:"quotes"`
}

func loadGoldenQuotes(t *testing.T) []GoldenQuote {
	t.Helper()
	raw, err := os.ReadFile(goldenQuotesPath())
	if err != nil {
		t.Fatalf("read golden quotes: %v", err)
	}
	var f goldenFile
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("parse golden quotes: %v", err)
	}
	if len(f.Quotes) != 20 {
		t.Fatalf("golden set must hold 20 quotes, got %d", len(f.Quotes))
	}
	return f.Quotes
}

// TestGoldenQuotes rates the golden set end-to-end through the service and
// asserts exact kobo equality with the Leg A reference outputs.
func TestGoldenQuotes(t *testing.T) {
	quotes := loadGoldenQuotes(t)

	if dump := os.Getenv("AK_GOLDEN_DUMP"); dump != "" {
		dumpResolvedInputs(t, quotes, dump)
		return
	}

	expected := loadGoldenExpected(t)
	svc, _, _ := newTestService(t)

	lines := map[string]int{}
	for _, q := range quotes {
		lines[q.ProductLine]++
		resp, err := svc.Rate(context.Background(), models.RateRequest{
			ProductLine: q.ProductLine,
			Variables:   q.Variables,
			SumInsured:  q.SumInsured,
			Exposures:   q.Exposures,
			GeoCell:     q.GeoCell,
			QuoteRef:    q.ID,
		})
		if err != nil {
			t.Fatalf("quote %s: rate failed: %v", q.ID, err)
		}
		if resp.Decision != models.DecisionAccept {
			t.Fatalf("quote %s: golden quote must accept, got %s (%v)", q.ID, resp.Decision, resp.ReasonCodes)
		}
		exp, ok := expected[q.ID]
		if !ok {
			t.Fatalf("quote %s: no expected row in golden_expected.csv", q.ID)
		}
		if resp.TotalPremiumKobo != exp.total || resp.PurePremium != exp.pure ||
			resp.Loadings.Expense+resp.Loadings.Commission+resp.Loadings.Profit != exp.loadings {
			t.Errorf("quote %s mismatch: got total=%d pure=%d loadings=%d, want total=%d pure=%d loadings=%d",
				q.ID, resp.TotalPremiumKobo, resp.PurePremium,
				resp.Loadings.Expense+resp.Loadings.Commission+resp.Loadings.Profit,
				exp.total, exp.pure, exp.loadings)
		}
		// Decomposition identity: pure + loadings + Σtaxes == total, exact
		// kobo (the kernel owns rounding; Go never re-rounds).
		sum := resp.PurePremium + resp.Loadings.Expense + resp.Loadings.Commission + resp.Loadings.Profit
		for _, tax := range resp.Taxes {
			sum += tax.AmountKobo
		}
		if sum != resp.TotalPremiumKobo {
			t.Errorf("quote %s: decomposition identity broken: %d != %d", q.ID, sum, resp.TotalPremiumKobo)
		}
	}
	for line, n := range lines {
		_ = n
		t.Logf("golden line %s covered", line)
	}
	if len(lines) != 6 {
		t.Fatalf("golden set must cover 6 lines, got %d", len(lines))
	}
}

// dumpResolvedInputs computes the kernel inputs for every golden quote with
// the real resolution pipeline and writes them as CSV for the Leg A
// reference driver (testdata/refgen.c).
func dumpResolvedInputs(t *testing.T, quotes []GoldenQuote, path string) {
	t.Helper()
	svc, _, _ := newTestService(t)
	snap := svc.Rating.Current()
	if snap == nil {
		t.Fatal("rating snapshot not loaded")
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create dump: %v", err)
	}
	defer func() { _ = f.Close() }()
	w := csv.NewWriter(f)
	defer w.Flush()
	if err := w.Write([]string{"id", "base_pure_premium", "rels", "expense", "commission", "profit", "tax_rates", "min_kobo", "max_kobo"}); err != nil {
		t.Fatal(err)
	}
	for _, q := range quotes {
		v, _, found := snap.ActiveVersion(q.ProductLine)
		if !found {
			t.Fatalf("quote %s: no approved version", q.ID)
		}
		res, err := v.Resolve(q.Variables, q.Exposures)
		if err != nil {
			t.Fatalf("quote %s: resolve failed: %v", q.ID, err)
		}
		rels := ""
		for i, r := range res.Rels {
			if i > 0 {
				rels += "|"
			}
			rels += strconv.FormatFloat(r, 'g', -1, 64)
		}
		taxes := ""
		for i, tr := range res.Taxes {
			if i > 0 {
				taxes += "|"
			}
			taxes += strconv.FormatFloat(tr.Rate, 'g', -1, 64)
		}
		row := []string{
			q.ID,
			strconv.FormatFloat(res.BasePurePremium, 'g', -1, 64),
			rels,
			strconv.FormatFloat(res.Loadings.ExpenseRatio, 'g', -1, 64),
			strconv.FormatFloat(res.Loadings.CommissionRate, 'g', -1, 64),
			strconv.FormatFloat(res.Loadings.ProfitMargin, 'g', -1, 64),
			taxes,
			strconv.FormatInt(res.Loadings.MinPremiumKobo, 10),
			strconv.FormatInt(res.Loadings.MaxKoboOrDefault(), 10),
		}
		if err := w.Write(row); err != nil {
			t.Fatal(err)
		}
	}
	t.Logf("dumped %d resolved inputs to %s", len(quotes), path)
}

type goldenExpected struct {
	total, pure, loadings int64
}

// loadGoldenExpected parses testdata/golden_expected.csv (id,total,pure,
// loadings — the Leg A kernel outputs).
func loadGoldenExpected(t *testing.T) map[string]goldenExpected {
	t.Helper()
	f, err := os.Open(goldenExpectedPath())
	if err != nil {
		t.Fatalf("read golden expected (regenerate via AK_GOLDEN_DUMP + refgen.c): %v", err)
	}
	defer func() { _ = f.Close() }()
	rows, err := csv.NewReader(f).ReadAll()
	if err != nil {
		t.Fatalf("parse golden expected: %v", err)
	}
	out := map[string]goldenExpected{}
	for i, row := range rows {
		if i == 0 {
			continue // header
		}
		if len(row) != 4 {
			t.Fatalf("golden expected row %d: want 4 columns", i)
		}
		total, err1 := strconv.ParseInt(row[1], 10, 64)
		pure, err2 := strconv.ParseInt(row[2], 10, 64)
		loadings, err3 := strconv.ParseInt(row[3], 10, 64)
		if err1 != nil || err2 != nil || err3 != nil {
			t.Fatalf("golden expected row %d malformed", i)
		}
		out[row[0]] = goldenExpected{total: total, pure: pure, loadings: loadings}
	}
	if len(out) != 20 {
		t.Fatalf("golden expected must hold 20 rows, got %d", len(out))
	}
	return out
}

// TestGoldenKernelDirect additionally drives ComposePremium directly with
// the resolved inputs and asserts bit-exact equality with the Leg A
// reference outputs — the same check Leg C performs from Python.
func TestGoldenKernelDirect(t *testing.T) {
	if os.Getenv("AK_GOLDEN_DUMP") != "" {
		t.Skip("dump mode")
	}
	quotes := loadGoldenQuotes(t)
	expected := loadGoldenExpected(t)
	svc, _, _ := newTestService(t)
	snap := svc.Rating.Current()
	for _, q := range quotes {
		v, _, found := snap.ActiveVersion(q.ProductLine)
		if !found {
			t.Fatalf("quote %s: no approved version", q.ID)
		}
		res, err := v.Resolve(q.Variables, q.Exposures)
		if err != nil {
			t.Fatalf("quote %s: resolve failed: %v", q.ID, err)
		}
		taxRates := make([]float64, len(res.Taxes))
		for i, tr := range res.Taxes {
			taxRates[i] = tr.Rate
		}
		quote, err := kernels.ComposePremium(res.BasePurePremium, res.Rels,
			res.Loadings.ExpenseRatio, res.Loadings.CommissionRate, res.Loadings.ProfitMargin,
			taxRates, res.Loadings.MinPremiumKobo, res.Loadings.MaxKoboOrDefault())
		if err != nil {
			t.Fatalf("quote %s: kernel failed: %v", q.ID, err)
		}
		exp := expected[q.ID]
		if quote.TotalKobo != exp.total || quote.PureKobo != exp.pure || quote.LoadingsKobo != exp.loadings {
			t.Errorf("quote %s kernel mismatch: got %+v, want total=%d pure=%d loadings=%d",
				q.ID, quote, exp.total, exp.pure, exp.loadings)
		}
		// Sanity: kernel output is finite positive and respects clamps.
		if quote.TotalKobo < res.Loadings.MinPremiumKobo {
			t.Errorf("quote %s below min premium", q.ID)
		}
		if math.IsNaN(res.BasePurePremium) || math.IsInf(res.BasePurePremium, 0) {
			t.Errorf("quote %s resolved non-finite base", q.ID)
		}
	}
}

func goldenQuotesPath() string {
	return "../../testdata/golden_quotes.json"
}

func goldenExpectedPath() string {
	return "../../testdata/golden_expected.csv"
}

// keep fmt imported for helper error paths
var _ = fmt.Sprintf
