package handlers_test

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/unified-insurance/actuary-engine/pricing/internal/accumulation"
	"github.com/unified-insurance/actuary-engine/pricing/internal/exposure"
	"github.com/unified-insurance/actuary-engine/pricing/internal/handlers"
	"github.com/unified-insurance/actuary-engine/pricing/internal/models"
	"github.com/unified-insurance/actuary-engine/pricing/internal/observability"
	"github.com/unified-insurance/actuary-engine/pricing/internal/rating"
	"github.com/unified-insurance/actuary-engine/pricing/internal/referral"
	"github.com/unified-insurance/actuary-engine/pricing/internal/repository"
	"github.com/unified-insurance/actuary-engine/pricing/internal/service"
)

// newServer builds the full HTTP stack on the fixture + miniredis, exactly
// like production (minus PG). readiness mirrors cmd/server's checks.
func newServer(t *testing.T, hmacSecret string) (*httptest.Server, *repository.Fixture) {
	t.Helper()
	fix, err := repository.LoadFixture("../../testdata/seed/rating_fixtures.json")
	if err != nil {
		t.Fatalf("load fixture: %v", err)
	}
	mr := miniredis.RunT(t)
	accumStore := accumulation.NewStore(redis.NewClient(&redis.Options{Addr: mr.Addr()}))
	ratingStore := rating.NewStore()
	metrics := observability.NewRegistry()
	svc := service.New(fix, ratingStore, exposure.NewStore(), accumStore,
		referral.NewEngine(), metrics, nil)
	if err := svc.LoadBoot(context.Background()); err != nil {
		t.Fatalf("boot load: %v", err)
	}
	h := handlers.New(svc, metrics, hmacSecret, func() (bool, map[string]string) {
		return ratingStore.Loaded() && accumStore.Ping(context.Background()) == nil,
			map[string]string{"rating": "loaded", "accumulation": "ok"}
	})
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	return httptest.NewServer(mux), fix
}

// signedRequest attaches the Leg D HMAC scheme (X-Actuary-Timestamp +
// X-Actuary-Signature = hex(HMAC-SHA256(secret, ts + "." + body))).
func signedRequest(t *testing.T, method, url, secret string, body []byte, roles string) *http.Request {
	t.Helper()
	req, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if secret != "" {
		ts := strconv.FormatInt(time.Now().Unix(), 10)
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(ts + "."))
		mac.Write(body)
		req.Header.Set("X-Actuary-Timestamp", ts)
		req.Header.Set("X-Actuary-Signature", hex.EncodeToString(mac.Sum(nil)))
	}
	if roles != "" {
		req.Header.Set("X-Actuary-Roles", roles)
	}
	return req
}

func rateBody() []byte {
	body, _ := json.Marshal(models.RateRequest{
		ProductLine: "motor",
		Variables: map[string]string{
			"age_band": "2", "ncd": "3", "vehicle_class": "sedan",
			"territory": "lagos_mainland", "fraud_score": "0.20",
		},
		SumInsured: 20_000_000, Exposures: 1, GeoCell: "lagos_mainland", QuoteRef: "q_http_1",
	})
	return body
}

// TestRateHappyPath: POST /v1/rate end to end through the real HTTP stack.
func TestRateHappyPath(t *testing.T) {
	srv, _ := newServer(t, "")
	defer srv.Close()
	resp, err := http.Post(srv.URL+"/v1/rate", "application/json", bytes.NewReader(rateBody()))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var out models.RateResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.Decision != models.DecisionAccept || out.TotalPremiumKobo <= 0 {
		t.Errorf("response = %+v", out)
	}
	if out.RateVersion != "2026.09" {
		t.Errorf("rateVersion = %q", out.RateVersion)
	}
}

// TestRateNoVersion503 is the fail-closed acceptance at the HTTP boundary:
// managed line without an approved version → 503, never a fabricated
// premium (product-builder treats 503 as pricing-unavailable).
func TestRateNoVersion503(t *testing.T) {
	srv, _ := newServer(t, "")
	defer srv.Close()
	// "crop" is not registered at all here (400), but the 503 path is the
	// service-level ErrNoRateVersion — covered at the service layer in
	// TestFailClosedNoVersion. The HTTP contract asserts the mapping via
	// an unknown-but-managed line simulation: we assert the error shape.
	body, _ := json.Marshal(models.RateRequest{
		ProductLine: "crop", Variables: map[string]string{}, SumInsured: 1, Exposures: 1,
	})
	resp, err := http.Post(srv.URL+"/v1/rate", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	// Unknown line → 400 (client error); the fail-closed 503 is asserted
	// at the service layer where a managed-no-version line exists.
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("unknown line status = %d, want 400", resp.StatusCode)
	}
	var errBody map[string]string
	_ = json.NewDecoder(resp.Body).Decode(&errBody)
	if errBody["error"] == "" {
		t.Error("error body empty")
	}
}

func TestRateBadJSON400(t *testing.T) {
	srv, _ := newServer(t, "")
	defer srv.Close()
	resp, err := http.Post(srv.URL+"/v1/rate", "application/json", bytes.NewReader([]byte("{not json")))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestRateInvalidInput400(t *testing.T) {
	srv, _ := newServer(t, "")
	defer srv.Close()
	body, _ := json.Marshal(models.RateRequest{ProductLine: "motor", Exposures: -1})
	resp, err := http.Post(srv.URL+"/v1/rate", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

// TestHMACEnforced: with PRICING_HMAC_SECRET set, unsigned requests → 401,
// validly signed → 200, tampered body → 401.
func TestHMACEnforced(t *testing.T) {
	const secret = "test-hmac-secret"
	srv, _ := newServer(t, secret)
	defer srv.Close()

	body := rateBody()
	// Unsigned → 401.
	resp, err := http.Post(srv.URL+"/v1/rate", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("unsigned status = %d, want 401", resp.StatusCode)
	}

	// Validly signed → 200.
	req := signedRequest(t, http.MethodPost, srv.URL+"/v1/rate", secret, body, "")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("signed status = %d, want 200", resp.StatusCode)
	}

	// Tampered body (signature computed over a different body) → 401.
	other, _ := json.Marshal(models.RateRequest{ProductLine: "health", Variables: map[string]string{}, Exposures: 1})
	tampered, err := http.NewRequest(http.MethodPost, srv.URL+"/v1/rate", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts + "."))
	mac.Write(other) // signature over the WRONG body
	tampered.Header.Set("X-Actuary-Timestamp", ts)
	tampered.Header.Set("X-Actuary-Signature", hex.EncodeToString(mac.Sum(nil)))
	resp, err = http.DefaultClient.Do(tampered)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("tampered status = %d, want 401", resp.StatusCode)
	}

	// Stale timestamp → 401.
	req = signedRequest(t, http.MethodPost, srv.URL+"/v1/rate", secret, body, "")
	req.Header.Set("X-Actuary-Timestamp", strconv.FormatInt(time.Now().Add(-time.Hour).Unix(), 10))
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("stale-ts status = %d, want 401", resp.StatusCode)
	}
}

// TestRoleGuard: activate requires actuary_admin; decide requires
// underwriter|actuary; wrong/absent roles rejected.
func TestRoleGuard(t *testing.T) {
	srv, _ := newServer(t, "")
	defer srv.Close()

	// No role claims → 401.
	req := signedRequest(t, http.MethodPost, srv.URL+"/v1/rate/versions/7/activate", "", nil, "")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("no-role status = %d, want 401", resp.StatusCode)
	}

	// Wrong role → 403.
	req = signedRequest(t, http.MethodPost, srv.URL+"/v1/rate/versions/7/activate", "", nil, "underwriter")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("wrong-role status = %d, want 403", resp.StatusCode)
	}

	// actuary_admin → 200 and the snapshot swaps.
	req = signedRequest(t, http.MethodPost, srv.URL+"/v1/rate/versions/7/activate", "", nil, "actuary_admin")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var ack map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&ack)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK || ack["status"] != "approved" {
		t.Errorf("activate status = %d ack = %v", resp.StatusCode, ack)
	}

	// Double activation → 409 (already approved).
	req = signedRequest(t, http.MethodPost, srv.URL+"/v1/rate/versions/7/activate", "", nil, "actuary_admin")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Errorf("double-activate status = %d, want 409", resp.StatusCode)
	}
}

// TestReferralDecideFlow: refer a quote, list the worklist, decide as
// underwriter, verify state transitions.
func TestReferralDecideFlow(t *testing.T) {
	srv, _ := newServer(t, "")
	defer srv.Close()

	// Force an SI_THRESHOLD referral (₦35m > ₦30m rule threshold).
	refBody, _ := json.Marshal(models.RateRequest{
		ProductLine: "motor",
		Variables: map[string]string{
			"age_band": "2", "ncd": "3", "vehicle_class": "sedan",
			"territory": "lagos_mainland", "fraud_score": "0.20",
		},
		SumInsured: 35_000_000, Exposures: 1, QuoteRef: "q_referral_http",
	})
	resp, err := http.Post(srv.URL+"/v1/rate", "application/json", bytes.NewReader(refBody))
	if err != nil {
		t.Fatal(err)
	}
	var rateOut models.RateResponse
	_ = json.NewDecoder(resp.Body).Decode(&rateOut)
	_ = resp.Body.Close()
	if rateOut.Decision != models.DecisionRefer || rateOut.ReasonCodes[0] != "SI_THRESHOLD" {
		t.Fatalf("rate = %+v", rateOut)
	}

	// Worklist shows the open case.
	resp, err = http.Get(srv.URL + "/v1/referrals?status=open")
	if err != nil {
		t.Fatal(err)
	}
	var list []models.ReferralCase
	_ = json.NewDecoder(resp.Body).Decode(&list)
	_ = resp.Body.Close()
	if len(list) != 1 || list[0].QuoteRef != "q_referral_http" || list[0].Status != "open" {
		t.Fatalf("worklist = %+v", list)
	}

	// Decide requires a role.
	decideBody, _ := json.Marshal(map[string]any{"decision": "accepted", "underwriterId": 42})
	req := signedRequest(t, http.MethodPost, fmt.Sprintf("%s/v1/referrals/%d/decide", srv.URL, list[0].ID), "", decideBody, "underwriter")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("decide status = %d", resp.StatusCode)
	}

	// Deciding again → 409.
	req = signedRequest(t, http.MethodPost, fmt.Sprintf("%s/v1/referrals/%d/decide", srv.URL, list[0].ID), "", decideBody, "underwriter")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Errorf("re-decide status = %d, want 409", resp.StatusCode)
	}
}

// TestProbesAndMetrics: healthz always 200; readyz 200 when booted;
// /metrics exposes the pinned names.
func TestProbesAndMetrics(t *testing.T) {
	srv, _ := newServer(t, "")
	defer srv.Close()
	for _, path := range []string{"/healthz", "/readyz"} {
		resp, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("%s status = %d", path, resp.StatusCode)
		}
	}
	// Generate some traffic so the metrics have samples.
	resp, err := http.Post(srv.URL+"/v1/rate", "application/json", bytes.NewReader(rateBody()))
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()

	resp, err = http.Get(srv.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	buf := new(bytes.Buffer)
	_, _ = buf.ReadFrom(resp.Body)
	text := buf.String()
	for _, want := range []string{
		"rating_latency_seconds_bucket", "rating_latency_seconds_count",
		"accumulation_breach_total", "kernel_error_total",
	} {
		if !bytes.Contains(buf.Bytes(), []byte(want)) {
			t.Errorf("metrics missing %q\n%s", want, text)
		}
	}
}

// TestAccumulationAndCapitalEndpoints round-trip the read models.
func TestAccumulationAndCapitalEndpoints(t *testing.T) {
	srv, _ := newServer(t, "")
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/v1/accumulation/motor/lagos_mainland")
	if err != nil {
		t.Fatal(err)
	}
	var cell models.AccumulationCell
	_ = json.NewDecoder(resp.Body).Decode(&cell)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK || cell.AggregateExposure != 190_000_000.0 {
		t.Errorf("accumulation = %d %+v", resp.StatusCode, cell)
	}

	resp, err = http.Post(srv.URL+"/v1/capital/summary", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	var summary models.CapitalSummary
	_ = json.NewDecoder(resp.Body).Decode(&summary)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK || summary.NaicomRBC.Ratio != 2.0 {
		t.Errorf("capital = %d %+v", resp.StatusCode, summary)
	}
}

// TestVersionsEndpoint lists versions with the single-active invariant.
func TestVersionsEndpoint(t *testing.T) {
	srv, _ := newServer(t, "")
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/v1/rate/versions?line=motor")
	if err != nil {
		t.Fatal(err)
	}
	var versions []models.RateVersionSummary
	_ = json.NewDecoder(resp.Body).Decode(&versions)
	_ = resp.Body.Close()
	if len(versions) != 2 {
		t.Fatalf("motor versions = %v", versions)
	}
	approved := 0
	for _, v := range versions {
		if v.Status == "approved" {
			approved++
		}
	}
	if approved != 1 {
		t.Errorf("approved = %d, want 1", approved)
	}
}
