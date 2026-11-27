// Package service is the orchestration core of the pricing service: it
// implements the Appendix I de-risking control flow end to end. Every
// refusal path is explicit and logged; no actuarially-managed product can
// be quoted without an approved rate version, within exposure limits, and
// below accumulation ceilings ("de-risked by construction").
package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"math"
	"sort"
	"time"

	"github.com/unified-insurance/actuary-engine/pricing/internal/accumulation"
	"github.com/unified-insurance/actuary-engine/pricing/internal/adequacy"
	"github.com/unified-insurance/actuary-engine/pricing/internal/exposure"
	"github.com/unified-insurance/actuary-engine/pricing/internal/kernels"
	"github.com/unified-insurance/actuary-engine/pricing/internal/models"
	"github.com/unified-insurance/actuary-engine/pricing/internal/observability"
	"github.com/unified-insurance/actuary-engine/pricing/internal/rating"
	"github.com/unified-insurance/actuary-engine/pricing/internal/referral"
	"github.com/unified-insurance/actuary-engine/pricing/internal/reinsurance"
	"github.com/unified-insurance/actuary-engine/pricing/internal/repository"
	"github.com/unified-insurance/actuary-engine/pricing/internal/shadow"
)

// Status codes surfaced to handlers beyond the decision itself.
var (
	// ErrNoRateVersion: managed line without an approved version — the
	// fail-closed 503 (Appendix I step 3).
	ErrNoRateVersion = errors.New("no approved rate version for managed line")
	// ErrUnknownLine: the line is not in the managed registry.
	ErrUnknownLine = errors.New("unknown product line")
	// ErrNotReady: boot/reload has not published a snapshot yet.
	ErrNotReady = errors.New("rating tables not loaded")
	// ErrInvalidInput: request failed validation.
	ErrInvalidInput = errors.New("invalid input")
)

// Service wires the stores and engines. All cross-package state (rating
// snapshot, exposure limits, referral rules) is atomically swappable so
// rate-version activation reloads without hot-path locks.
type Service struct {
	Repo    repository.Store
	Rating  *rating.Store
	Limits  *exposure.Store
	Accum   *accumulation.Store
	Rules   *referral.Engine
	Metrics *observability.Registry
	Shadow  *shadow.Client
}

// New builds the service around its stores.
func New(repo repository.Store, ratingStore *rating.Store, limits *exposure.Store,
	accum *accumulation.Store, rules *referral.Engine, metrics *observability.Registry,
	sh *shadow.Client) *Service {
	return &Service{
		Repo: repo, Rating: ratingStore, Limits: limits, Accum: accum,
		Rules: rules, Metrics: metrics, Shadow: sh,
	}
}

// LoadBoot publishes a fresh boot payload (called at start and after every
// rate-version activation: the atomic-snapshot-swap reload of Appendix D).
func (s *Service) LoadBoot(ctx context.Context) error {
	boot, err := s.Repo.LoadBoot(ctx)
	if err != nil {
		return err
	}
	rows := make([]repository.VersionRow, 0, len(boot.Versions))
	_ = rows
	snap, err := buildSnapshotFromVersions(boot)
	if err != nil {
		return err
	}
	s.Rating.Swap(snap)
	s.Limits.Swap(exposure.NewSet(boot.Limits))
	s.Rules.Swap(boot.Rules)
	if len(boot.AccumSeeds) > 0 && s.Accum != nil {
		if err := s.Accum.Warm(ctx, boot.AccumSeeds); err != nil {
			// Warm failure is NOT fatal: Redis SETNX is idempotent and the
			// keys may already be live; the authoritative gate is the atomic
			// check-apply at accept time. Logged for the runbook.
			log.Printf("WARN: accumulation warm failed (keys may already be live): %v", err)
		}
	}
	return nil
}

func buildSnapshotFromVersions(boot *repository.Boot) (*rating.Snapshot, error) {
	snap := &rating.Snapshot{
		Lines:    map[string]bool{},
		Versions: map[string]*rating.Version{},
	}
	for _, code := range boot.Lines {
		snap.Lines[code] = true
	}
	for _, v := range boot.Versions {
		snap.All = append(snap.All, v)
		if v.Status == "approved" {
			if _, dup := snap.Versions[v.Line]; dup {
				return nil, fmt.Errorf("line %s has multiple approved rate versions", v.Line)
			}
			snap.Versions[v.Line] = v
		}
	}
	if err := snap.Validate(); err != nil {
		return nil, err
	}
	return snap, nil
}

// Rate implements the Appendix I control flow:
//
//  2. input validation                fail → 400 (ErrInvalidInput)
//  3. approved rate version for line? no  → 503 (ErrNoRateVersion)
//  4. exposure limits (per-risk)      breach → decline
//  5. accumulation check (advisory)   breach → refer (ACCUM_GEO/ACCUM_LINE)
//  6. referral rules                  hit → refer|decline (engine error → refer)
//  7. GLM score + relativities + loadings (cgo kernel)
//     numeric error                   → refer (never accept)
//  8. accumulation apply (atomic)     breach → refer; store error → refer
//  9. response decomposition + rateVersion stamp
func (s *Service) Rate(ctx context.Context, req models.RateRequest) (models.RateResponse, error) {
	start := time.Now()
	defer func() { s.Metrics.ObserveRatingLatency(time.Since(start)) }()

	if err := validateRateRequest(req); err != nil {
		return models.RateResponse{}, fmt.Errorf("%w: %s", ErrInvalidInput, err)
	}

	snap := s.Rating.Current()
	if snap == nil {
		return models.RateResponse{}, ErrNotReady
	}
	version, managed, found := snap.ActiveVersion(req.ProductLine)
	if !managed {
		return models.RateResponse{}, fmt.Errorf("%w: %q", ErrUnknownLine, req.ProductLine)
	}
	if !found {
		// Fail-closed: a managed line without an approved version is never
		// rated on a guess (acceptance test fail_closed_no_version).
		return models.RateResponse{}, fmt.Errorf("%w: %q", ErrNoRateVersion, req.ProductLine)
	}

	sumInsuredKobo, err := repository.NairaToKobo(req.SumInsured)
	if err != nil {
		return models.RateResponse{}, fmt.Errorf("%w: sumInsured %v", ErrInvalidInput, err)
	}
	limits := s.limitsFor(req.ProductLine)
	resp := models.RateResponse{
		RateVersion: version.Version,
		Taxes:       []models.TaxLine{},
		ReasonCodes: []string{},
	}

	// Step 4: per-risk exposure ceiling (hard decline).
	if breaches := exposure.CheckPreRates(limits, sumInsuredKobo); len(breaches) > 0 {
		resp.Decision = models.DecisionDecline
		resp.ReasonCodes = breaches
		return resp, nil
	}

	// Step 5: advisory accumulation check (authoritative gate at accept).
	if s.Accum != nil {
		geoBreach, lineBreach, err := s.Accum.Check(ctx, req.ProductLine, req.GeoCell,
			sumInsuredKobo, geoLimitFor(limits, req.GeoCell), lineLimitFor(limits))
		if err != nil {
			return s.refer(ctx, req, resp, models.ReasonAccumUnavailable)
		}
		if geoBreach {
			s.Metrics.IncAccumulationBreach()
			return s.refer(ctx, req, resp, models.ReasonAccumGeo)
		}
		if lineBreach {
			s.Metrics.IncAccumulationBreach()
			return s.refer(ctx, req, resp, models.ReasonAccumLine)
		}
	}

	// Step 6: declarative referral rules (engine error → refer, fail-closed).
	outcome := s.Rules.Evaluate(referral.Facts{
		Line:           req.ProductLine,
		SumInsuredKobo: sumInsuredKobo,
		Exposures:      req.Exposures,
		GeoCell:        req.GeoCell,
		Variables:      req.Variables,
	})
	switch outcome.Action {
	case "refer":
		return s.refer(ctx, req, resp, outcome.ReasonCode)
	case "decline":
		resp.Decision = models.DecisionDecline
		resp.ReasonCodes = []string{outcome.ReasonCode}
		return resp, nil
	}

	// Step 7: GLM resolution + kernel compose (any error → refer).
	res, err := version.Resolve(req.Variables, req.Exposures)
	if err != nil {
		var de *rating.DomainError
		if errors.As(err, &de) {
			return s.refer(ctx, req, resp, models.ReasonModelDomain)
		}
		// Structural failure post-Validate should be unreachable; refuse
		// closed anyway (never accept on a broken model).
		log.Printf("ERROR: resolve failed structurally for %s/%s: %v", req.ProductLine, version.Version, err)
		return s.refer(ctx, req, resp, models.ReasonModelDomain)
	}
	taxRates := make([]float64, len(res.Taxes))
	for i, t := range res.Taxes {
		taxRates[i] = t.Rate
	}
	quote, err := kernels.ComposePremium(
		res.BasePurePremium, res.Rels,
		res.Loadings.ExpenseRatio, res.Loadings.CommissionRate, res.Loadings.ProfitMargin,
		taxRates, res.Loadings.MinPremiumKobo, res.Loadings.MaxKoboOrDefault(),
	)
	if err != nil {
		s.Metrics.IncKernelError()
		return s.refer(ctx, req, resp, models.ReasonKernelError)
	}

	// Step 7b: per-policy premium ceiling (hard decline).
	if limits != nil && limits.MaxPremiumKobo > 0 && quote.TotalKobo > limits.MaxPremiumKobo {
		resp.Decision = models.DecisionDecline
		resp.ReasonCodes = []string{models.ReasonLimitMaxPremium}
		return resp, nil
	}

	// Step 8: authoritative accumulation gate (atomic check-and-apply).
	if s.Accum != nil {
		outcome, err := s.Accum.ApplyIfWithin(ctx, req.ProductLine, req.GeoCell,
			sumInsuredKobo, geoLimitFor(limits, req.GeoCell), lineLimitFor(limits))
		if err != nil {
			return s.refer(ctx, req, resp, models.ReasonAccumUnavailable)
		}
		switch outcome {
		case accumulation.GeoBreach:
			s.Metrics.IncAccumulationBreach()
			return s.refer(ctx, req, resp, models.ReasonAccumGeo)
		case accumulation.LineBreach:
			s.Metrics.IncAccumulationBreach()
			return s.refer(ctx, req, resp, models.ReasonAccumLine)
		}
		resp.AccumulationDelta = sumInsuredKobo
	}

	// Step 9: decomposition (kernel outputs are final; Go never re-rounds —
	// components are split deterministically with the residual assigned so
	// the identities hold exactly).
	resp.Decision = models.DecisionAccept
	resp.PurePremium = quote.PureKobo
	resp.TotalPremiumKobo = quote.TotalKobo
	resp.Loadings = decomposeLoadings(quote.PureKobo, quote.LoadingsKobo, res.Loadings)
	resp.Taxes = decomposeTaxes(quote, resp.PurePremium, resp.Loadings, res)

	// Step 10 (async, off-hot-path): shadow TB transfer event + audit log.
	if s.Shadow != nil {
		s.Shadow.EmitAsync(shadow.Event{
			QuoteRef:         quoteRefOrGenerate(req.QuoteRef),
			ProductLine:      req.ProductLine,
			TotalPremiumKobo: quote.TotalKobo,
			EmittedAt:        time.Now().UTC().Format(time.RFC3339),
		})
	}
	log.Printf("quote accept ref=%s line=%s version=%s totalKobo=%d",
		quoteRefOrGenerate(req.QuoteRef), req.ProductLine, version.Version, quote.TotalKobo)
	return resp, nil
}

// refer records a referral case (underwriter worklist) and returns the
// refer decision. Referral persistence is best-effort: the decision itself
// is already safe (never an accept).
func (s *Service) refer(ctx context.Context, req models.RateRequest, resp models.RateResponse, reason string) (models.RateResponse, error) {
	resp.Decision = models.DecisionRefer
	resp.ReasonCodes = []string{reason}
	s.Metrics.IncReferral(reason)
	ref := quoteRefOrGenerate(req.QuoteRef)
	if _, err := s.Repo.InsertReferral(ctx, ref, req.ProductLine, resp.ReasonCodes); err != nil {
		log.Printf("WARN: referral persistence failed for %s (decision unaffected): %v", ref, err)
	}
	log.Printf("quote refer ref=%s line=%s reason=%s", ref, req.ProductLine, reason)
	return resp, nil
}

func (s *Service) limitsFor(line string) *exposure.Limits {
	set := s.Limits.Current()
	if set == nil {
		return nil
	}
	return set.ForLine(line)
}

func geoLimitFor(l *exposure.Limits, geoCell string) int64 {
	if l == nil || geoCell == "" {
		return 0
	}
	return l.GeoLimit(geoCell)
}

func lineLimitFor(l *exposure.Limits) int64 {
	if l == nil {
		return 0
	}
	return l.MaxAggregateKobo
}

func validateRateRequest(req models.RateRequest) error {
	if req.ProductLine == "" {
		return fmt.Errorf("productLine is required")
	}
	if math.IsNaN(req.SumInsured) || math.IsInf(req.SumInsured, 0) || req.SumInsured < 0 {
		return fmt.Errorf("sumInsured must be finite and >= 0")
	}
	if math.IsNaN(req.Exposures) || math.IsInf(req.Exposures, 0) || req.Exposures <= 0 {
		return fmt.Errorf("exposures must be finite and > 0")
	}
	return nil
}

// quoteRefOrGenerate mints a stable reference when the caller omitted one —
// the referral queue keys on quoteRef (act_referrals unique constraint).
func quoteRefOrGenerate(ref string) string {
	if ref != "" {
		return ref
	}
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "q_fallback"
	}
	return "q_" + hex.EncodeToString(b[:])
}

// decomposeLoadings splits the kernel's combined loadings_kobo into its
// expense/commission/profit components. Expense and commission are rounded
// from the gross base; the residual is assigned to profit so the three
// components sum exactly to the kernel value (Go never re-rounds kernel
// outputs — design §9.1).
func decomposeLoadings(pureKobo, loadingsKobo int64, l rating.Loadings) models.LoadingsBreakdown {
	if loadingsKobo <= 0 {
		return models.LoadingsBreakdown{}
	}
	sum := l.ExpenseRatio + l.CommissionRate + l.ProfitMargin
	if sum <= 0 {
		// Degenerate (all-zero) loadings: nothing to decompose.
		return models.LoadingsBreakdown{}
	}
	grossKobo := float64(pureKobo) + float64(loadingsKobo) // gross before tax
	// gross × ratio directly: ratios are fractions of gross (kernel
	// convention), so component = round(gross × ratio); the residual lands
	// in profit so the three components sum exactly to the kernel value.
	expense := int64(math.Round(grossKobo * l.ExpenseRatio))
	commission := int64(math.Round(grossKobo * l.CommissionRate))
	profit := loadingsKobo - expense - commission
	return models.LoadingsBreakdown{Expense: expense, Commission: commission, Profit: profit}
}

// decomposeTaxes splits the kernel's tax_kobo across the statutory tax
// lines. Each line but the last is rounded from the gross base; the final
// line takes the residual so components sum exactly to the kernel's value.
func decomposeTaxes(quote kernels.PremiumQuote, pureKobo int64, loadings models.LoadingsBreakdown, res rating.Resolved) []models.TaxLine {
	out := make([]models.TaxLine, 0, len(res.Taxes))
	if len(res.Taxes) == 0 {
		return out
	}
	grossKobo := float64(pureKobo) + float64(quote.LoadingsKobo)
	remaining := quote.TaxKobo
	for i, t := range res.Taxes {
		var amount int64
		if i == len(res.Taxes)-1 {
			amount = remaining
		} else {
			amount = int64(math.Round(grossKobo * t.Rate))
			remaining -= amount
		}
		out = append(out, models.TaxLine{Code: t.Code, AmountKobo: amount})
	}
	return out
}

// ─── non-rating endpoints ──────────────────────────────────────────────────

// RateVersions lists versions for GET /v1/rate/versions.
func (s *Service) RateVersions(line string) ([]models.RateVersionSummary, error) {
	snap := s.Rating.Current()
	if snap == nil {
		return nil, ErrNotReady
	}
	out := []models.RateVersionSummary{}
	for _, v := range snap.All {
		if line != "" && v.Line != line {
			continue
		}
		entry := models.RateVersionSummary{
			ID: v.ID, ProductLine: v.Line, Version: v.Version, Status: v.Status,
		}
		if v.EffectiveFrom != nil {
			s := v.EffectiveFrom.UTC().Format(time.RFC3339)
			entry.EffectiveFrom = &s
		}
		out = append(out, entry)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

// ActivateRateVersion runs the transactional activation then hot-reloads
// the boot payload (atomic snapshot swap, Appendix D).
func (s *Service) ActivateRateVersion(ctx context.Context, id int64) error {
	if err := s.Repo.ActivateRateVersion(ctx, id); err != nil {
		return err
	}
	return s.LoadBoot(ctx)
}

// Accumulation reads the current geo-cell aggregate for the portal heatmap.
func (s *Service) Accumulation(ctx context.Context, line, geoCell string) (models.AccumulationCell, error) {
	if s.Accum == nil {
		return models.AccumulationCell{}, errors.New("accumulation store not configured")
	}
	cur, err := s.Accum.Current(ctx, line, geoCell)
	if err != nil {
		return models.AccumulationCell{}, err
	}
	limits := s.limitsFor(line)
	geoLimit := geoLimitFor(limits, geoCell)
	cell := models.AccumulationCell{
		Line:              line,
		GeoCell:           geoCell,
		AggregateExposure: repository.KoboToNaira(cur),
		Breach:            geoLimit > 0 && cur > geoLimit,
	}
	if geoLimit > 0 {
		l := repository.KoboToNaira(geoLimit)
		cell.Limit = &l
	}
	return cell, nil
}

// ExposureCheck implements POST /v1/exposure/check (early-warning pre-check
// without full rating).
func (s *Service) ExposureCheck(ctx context.Context, req models.ExposureCheckRequest) (models.ExposureCheckResponse, error) {
	if req.ProductLine == "" || math.IsNaN(req.SumInsured) || req.SumInsured < 0 {
		return models.ExposureCheckResponse{}, fmt.Errorf("%w: productLine and non-negative sumInsured required", ErrInvalidInput)
	}
	snap := s.Rating.Current()
	if snap == nil {
		return models.ExposureCheckResponse{}, ErrNotReady
	}
	if !snap.Lines[req.ProductLine] {
		return models.ExposureCheckResponse{}, fmt.Errorf("%w: %q", ErrUnknownLine, req.ProductLine)
	}
	siKobo, err := repository.NairaToKobo(req.SumInsured)
	if err != nil {
		return models.ExposureCheckResponse{}, fmt.Errorf("%w: sumInsured %v", ErrInvalidInput, err)
	}
	var premKobo int64
	if req.Premium > 0 {
		premKobo, err = repository.NairaToKobo(req.Premium)
		if err != nil {
			return models.ExposureCheckResponse{}, fmt.Errorf("%w: premium %v", ErrInvalidInput, err)
		}
	}
	limits := s.limitsFor(req.ProductLine)
	breaches := exposure.Check(limits, siKobo, premKobo)
	// Geo accumulation advisory check (read-only).
	if s.Accum != nil && req.GeoCell != "" {
		geoBreach, _, err := s.Accum.Check(ctx, req.ProductLine, req.GeoCell, siKobo, geoLimitFor(limits, req.GeoCell), 0)
		if err != nil {
			return models.ExposureCheckResponse{}, err
		}
		if geoBreach {
			breaches = append(breaches, models.ReasonAccumGeo)
		}
	}
	return models.ExposureCheckResponse{
		WithinLimits: len(breaches) == 0,
		Breaches:     breaches,
	}, nil
}

// CapitalSummary implements POST /v1/capital/summary (cached read of
// approved act_capital_runs; compute happens in the Python batch).
func (s *Service) CapitalSummary(ctx context.Context) (*models.CapitalSummary, error) {
	summary, found, err := s.Repo.LatestCapitalSummary(ctx)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, ErrNotFound
	}
	return summary, nil
}

// ErrNotFound mirrors repository.ErrNotFound for the handler layer.
var ErrNotFound = repository.ErrNotFound

// ReinsuranceEvaluate implements POST /v1/reinsurance/evaluate through the
// real MC kernel.
func (s *Service) ReinsuranceEvaluate(_ context.Context, req reinsurance.Request) (models.ReinsuranceEvaluation, error) {
	return reinsurance.Evaluate(req)
}

// AdequacyRequest is POST /v1/adequacy/evaluate (documented Leg B
// extension): the Python adequacy job's callback target — it computes the
// monthly live LR and calls here; breaches persist to act_adequacy_alerts.
type AdequacyRequest struct {
	ProductLine       string  `json:"productLine"`
	Period            string  `json:"period"` // YYYY-MM
	PricedLossRatio   float64 `json:"pricedLossRatio"`
	ActualLossRatio   float64 `json:"actualLossRatio"`
	EarnedPremiumKobo int64   `json:"earnedPremiumKobo"`
}

// AdequacyResponse reports the classification.
type AdequacyResponse struct {
	Severity  string  `json:"severity"`  // "" | amber | red
	Delta     float64 `json:"delta"`     // actual − priced (points)
	BandAmber float64 `json:"bandAmber"` // applied after credibility widening
	BandRed   float64 `json:"bandRed"`
	Persisted bool    `json:"persisted"` // true when a breach row was written
}

// AdequacyEvaluate classifies a priced-vs-actual LR pair (amber ±5, red
// ±10 pts, credibility-widened) and persists breaches.
func (s *Service) AdequacyEvaluate(ctx context.Context, req AdequacyRequest) (AdequacyResponse, error) {
	if req.ProductLine == "" || len(req.Period) != 7 {
		return AdequacyResponse{}, fmt.Errorf("%w: productLine and YYYY-MM period required", ErrInvalidInput)
	}
	verdict, err := adequacy.Evaluate(req.PricedLossRatio, req.ActualLossRatio, req.EarnedPremiumKobo)
	if err != nil {
		return AdequacyResponse{}, fmt.Errorf("%w: %s", ErrInvalidInput, err)
	}
	resp := AdequacyResponse{
		Severity: verdict.Severity, Delta: verdict.Delta,
		BandAmber: verdict.BandAmber, BandRed: verdict.BandRed,
	}
	if verdict.Severity != adequacy.SeverityNone {
		if err := s.Repo.InsertAdequacyAlert(ctx, req.ProductLine, req.Period,
			req.PricedLossRatio, req.ActualLossRatio, verdict.Severity); err != nil {
			return AdequacyResponse{}, err
		}
		resp.Persisted = true
	}
	return resp, nil
}
