// Package models holds the pricing-service domain types shared across
// handlers, service and repository. The wire shapes mirror the frozen
// Appendix D OpenAPI contract (and Leg D's typed adapter) field-for-field.
package models

// Decision is the rating outcome (Appendix D: accept | refer | decline).
type Decision string

const (
	DecisionAccept  Decision = "accept"
	DecisionRefer   Decision = "refer"
	DecisionDecline Decision = "decline"
)

// Machine reason codes emitted on refer/decline decisions. Referral-rule
// hits contribute the rule's own reasonCode (Leg D schema comment lists
// ACCUM_GEO, SI_THRESHOLD, FRAUD_SCORE, MODEL_OUT_OF_DOMAIN as examples).
const (
	ReasonAccumGeo          = "ACCUM_GEO"             // geo-cell accumulation ceiling breached
	ReasonAccumLine         = "ACCUM_LINE"            // per-line aggregate exposure ceiling breached
	ReasonAccumUnavailable  = "ACCUM_UNAVAILABLE"     // accumulation store down — fail-closed refer
	ReasonLimitSumInsured   = "LIMIT_SUM_INSURED"     // per-risk sum-insured ceiling breached
	ReasonLimitMaxPremium   = "LIMIT_MAX_PREMIUM"     // per-policy premium ceiling breached
	ReasonRateVersionAbsent = "RATE_VERSION_ABSENT"   // no approved version for a managed line (503)
	ReasonModelDomain       = "MODEL_OUT_OF_DOMAIN"   // variable level outside the rating model
	ReasonKernelError       = "KERNEL_ERROR"          // numeric failure in the compute kernel
	ReasonReferralEngine    = "REFERRAL_ENGINE_ERROR" // rules engine failed — fail-closed refer
)

// RateRequest is the POST /v1/rate body (Appendix D).
type RateRequest struct {
	ProductLine string            `json:"productLine"`
	Variables   map[string]string `json:"variables"`
	// SumInsured in NGN major units; the Go boundary converts to kobo minor
	// units (Leg D adapter convention).
	SumInsured float64 `json:"sumInsured"`
	Exposures  float64 `json:"exposures"`
	GeoCell    string  `json:"geoCell,omitempty"`
	QuoteRef   string  `json:"quoteRef,omitempty"`
}

// LoadingsBreakdown is the gross-premium decomposition the portals render
// (mirrors PremiumFormulaEngine's taxDetails shape, design §4.a).
type LoadingsBreakdown struct {
	Expense    int64 `json:"expense"`    // kobo
	Commission int64 `json:"commission"` // kobo
	Profit     int64 `json:"profit"`     // kobo
}

// TaxLine is one statutory tax/levy component of the total.
type TaxLine struct {
	Code       string `json:"code"`
	AmountKobo int64  `json:"amountKobo"`
}

// RateResponse is the POST /v1/rate response (Appendix D, Leg D adapter's
// RateResponse type). Monetary fields are integer kobo.
type RateResponse struct {
	PurePremium       int64             `json:"purePremium"`
	Loadings          LoadingsBreakdown `json:"loadings"`
	Taxes             []TaxLine         `json:"taxes"`
	TotalPremiumKobo  int64             `json:"totalPremiumKobo"`
	RateVersion       string            `json:"rateVersion"`
	Decision          Decision          `json:"decision"`
	ReasonCodes       []string          `json:"reasonCodes"`
	AccumulationDelta int64             `json:"accumulationDelta"`
}

// RateVersionSummary is one row of GET /v1/rate/versions.
type RateVersionSummary struct {
	ID              int64   `json:"id"`
	ProductLine     string  `json:"productLine"`
	Version         string  `json:"version"`
	Status          string  `json:"status"`
	EffectiveFrom   *string `json:"effectiveFrom,omitempty"`
	NaicomFilingRef *string `json:"naicomFilingRef,omitempty"`
}

// AccumulationCell is GET /v1/accumulation/{line}/{geoCell} (Leg D's
// AccumulationCell). AggregateExposure in NGN major units (portal renders
// majors); limit null when the line carries no geo ceiling.
type AccumulationCell struct {
	Line              string   `json:"line"`
	GeoCell           string   `json:"geoCell"`
	AggregateExposure float64  `json:"aggregateExposure"`
	Limit             *float64 `json:"limit"`
	Breach            bool     `json:"breach"`
}

// ExposureCheckRequest is POST /v1/exposure/check.
type ExposureCheckRequest struct {
	ProductLine string  `json:"productLine"`
	SumInsured  float64 `json:"sumInsured"`
	Premium     float64 `json:"premium,omitempty"`
	GeoCell     string  `json:"geoCell,omitempty"`
}

// ExposureCheckResponse reports limit breaches without full rating.
type ExposureCheckResponse struct {
	WithinLimits bool     `json:"withinLimits"`
	Breaches     []string `json:"breaches"`
}

// ReferralCase is one row of the underwriter worklist.
type ReferralCase struct {
	ID          int64    `json:"id"`
	QuoteRef    string   `json:"quoteRef"`
	ProductLine string   `json:"productLine"`
	ReasonCodes []string `json:"reasonCodes"`
	Status      string   `json:"status"`
	CreatedAt   string   `json:"createdAt"`
}

// CapitalSummary is POST /v1/capital/summary — the latest approved
// act_capital_runs rows (compute happens in the Python batch; this service
// is the cached read model).
type CapitalSummary struct {
	NaicomRBC struct {
		Required  float64 `json:"required"`
		Available float64 `json:"available"`
		Ratio     float64 `json:"ratio"`
	} `json:"naicomRbc"`
	EC struct {
		Var995  float64 `json:"var995"`
		Tvar99  float64 `json:"tvar99"`
		PerLine []struct {
			Line   string  `json:"line"`
			Tvar99 float64 `json:"tvar99"`
		} `json:"perLine"`
	} `json:"ec"`
	AsOf   string `json:"asOf"`
	Status string `json:"status"`
}

// ReinsuranceEvaluation is POST /v1/reinsurance/evaluate (Leg D type):
// retained-risk impact of a proposed treaty structure, computed through the
// real Monte Carlo kernel.
type ReinsuranceEvaluation struct {
	RetainedVar995 float64 `json:"retainedVar995"`
	RetainedTvar99 float64 `json:"retainedTvar99"`
	CededCostKobo  int64   `json:"cededCostKobo"`
	DeltaVar995    float64 `json:"deltaVar995"`
	DeltaTvar99    float64 `json:"deltaTvar99"`
}
