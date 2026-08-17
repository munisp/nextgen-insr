// Package actuarial implements insurance-specific actuarial calculations including
// mortality tables, loss development triangles, and burning cost analysis.
//
// References:
// - Nigerian Life Table (NBS 2019 abridged)
// - NAICOM Statutory Returns format for loss development
// - London Market Burning Cost methodology
package actuarial

import "math"

// ─── Nigerian Mortality Table (abridged from NBS 2019) ──────────────────────
// qx = probability of death within one year for a person aged x
// Based on Nigerian population data; used for life insurance pricing

// MortalityTable contains age-specific mortality rates
type MortalityTable struct {
	Name   string          `json:"name"`
	Gender string          `json:"gender"`
	Year   int             `json:"year"`
	Rates  map[int]float64 `json:"rates"` // age -> qx
}

// NigerianMaleTable — abridged mortality rates for Nigerian males
var NigerianMaleTable = MortalityTable{
	Name: "Nigeria_Male_2019", Gender: "male", Year: 2019,
	Rates: map[int]float64{
		0: 0.0670, 1: 0.0320, 5: 0.0085, 10: 0.0040, 15: 0.0055,
		20: 0.0078, 25: 0.0095, 30: 0.0112, 35: 0.0138, 40: 0.0175,
		45: 0.0225, 50: 0.0310, 55: 0.0430, 60: 0.0610, 65: 0.0880,
		70: 0.1250, 75: 0.1780, 80: 0.2500, 85: 0.3500, 90: 0.5000,
	},
}

// NigerianFemaleTable — abridged mortality rates for Nigerian females
var NigerianFemaleTable = MortalityTable{
	Name: "Nigeria_Female_2019", Gender: "female", Year: 2019,
	Rates: map[int]float64{
		0: 0.0580, 1: 0.0280, 5: 0.0070, 10: 0.0035, 15: 0.0048,
		20: 0.0065, 25: 0.0080, 30: 0.0098, 35: 0.0120, 40: 0.0150,
		45: 0.0195, 50: 0.0270, 55: 0.0380, 60: 0.0540, 65: 0.0780,
		70: 0.1120, 75: 0.1600, 80: 0.2300, 85: 0.3200, 90: 0.4700,
	},
}

// GetMortalityRate returns qx for a given age using linear interpolation
func (t *MortalityTable) GetMortalityRate(age int) float64 {
	if rate, ok := t.Rates[age]; ok {
		return rate
	}
	// Linear interpolation between known ages
	lowerAge, upperAge := 0, 90
	for a := range t.Rates {
		if a <= age && a > lowerAge {
			lowerAge = a
		}
		if a >= age && a < upperAge {
			upperAge = a
		}
	}
	if lowerAge == upperAge {
		return t.Rates[lowerAge]
	}
	lowerRate := t.Rates[lowerAge]
	upperRate := t.Rates[upperAge]
	fraction := float64(age-lowerAge) / float64(upperAge-lowerAge)
	return lowerRate + fraction*(upperRate-lowerRate)
}

// CalculateLifePremium calculates the net annual premium for term life insurance
// using the equivalence principle: PV(premiums) = PV(benefit)
func CalculateLifePremium(age int, term int, sumAssured float64, gender string, discountRate float64) LifePremiumResult {
	table := &NigerianMaleTable
	if gender == "female" {
		table = &NigerianFemaleTable
	}

	// Present value of benefit (death benefit * probability of death in each year)
	pvBenefit := 0.0
	// Present value of annuity (premium payment in each year while alive)
	pvAnnuity := 0.0

	survivalProb := 1.0 // lx/l_start

	for t := 0; t < term; t++ {
		currentAge := age + t
		qx := table.GetMortalityRate(currentAge)

		// Discount factor
		v := math.Pow(1+discountRate, -float64(t+1))

		// PV of death benefit in year t+1
		pvBenefit += sumAssured * survivalProb * qx * v

		// PV of premium payment at start of year t (alive at start)
		pvAnnuity += survivalProb * math.Pow(1+discountRate, -float64(t))

		// Update survival probability
		survivalProb *= (1 - qx)
	}

	netPremium := 0.0
	if pvAnnuity > 0 {
		netPremium = pvBenefit / pvAnnuity
	}

	// Gross premium = net premium + loadings
	expenseLoading := netPremium * 0.30 // 30% expense loading (Nigerian market)
	profitMargin := netPremium * 0.05   // 5% profit margin
	grossPremium := netPremium + expenseLoading + profitMargin

	return LifePremiumResult{
		Age:            age,
		Term:           term,
		SumAssured:     sumAssured,
		NetPremium:     math.Round(netPremium*100) / 100,
		ExpenseLoading: math.Round(expenseLoading*100) / 100,
		ProfitMargin:   math.Round(profitMargin*100) / 100,
		GrossPremium:   math.Round(grossPremium*100) / 100,
		PVBenefit:      math.Round(pvBenefit*100) / 100,
		PVAnnuity:      math.Round(pvAnnuity*100) / 100,
		DiscountRate:   discountRate,
		MortalityTable: table.Name,
		SurvivalToTerm: math.Round(survivalProb*10000) / 10000,
	}
}

type LifePremiumResult struct {
	Age            int     `json:"age"`
	Term           int     `json:"term_years"`
	SumAssured     float64 `json:"sum_assured"`
	NetPremium     float64 `json:"net_annual_premium"`
	ExpenseLoading float64 `json:"expense_loading"`
	ProfitMargin   float64 `json:"profit_margin"`
	GrossPremium   float64 `json:"gross_annual_premium"`
	PVBenefit      float64 `json:"pv_benefit"`
	PVAnnuity      float64 `json:"pv_annuity_factor"`
	DiscountRate   float64 `json:"discount_rate"`
	MortalityTable string  `json:"mortality_table"`
	SurvivalToTerm float64 `json:"survival_probability_to_term"`
}

// ─── Loss Development Triangle ──────────────────────────────────────────────
// Used for IBNR (Incurred But Not Reported) estimation
// Chain-Ladder method per NAICOM actuarial standards

// LossTriangle represents a loss development triangle
type LossTriangle struct {
	AccidentYears []int       `json:"accident_years"`
	DevPeriods    int         `json:"development_periods"`
	Cumulative    [][]float64 `json:"cumulative_losses"` // [year][period]
}

// ChainLadderResult contains the output of chain-ladder analysis
type ChainLadderResult struct {
	DevelopmentFactors []float64 `json:"development_factors"`
	UltimateLosses     []float64 `json:"ultimate_losses"`
	IBNRReserves       []float64 `json:"ibnr_reserves"`
	TotalIBNR          float64   `json:"total_ibnr"`
	TotalUltimate      float64   `json:"total_ultimate"`
	TotalPaid          float64   `json:"total_paid_to_date"`
}

// SampleNigerianMotorTriangle — realistic loss development for Nigerian motor insurance
// Values in millions of Naira
var SampleNigerianMotorTriangle = LossTriangle{
	AccidentYears: []int{2020, 2021, 2022, 2023, 2024},
	DevPeriods:    5,
	Cumulative: [][]float64{
		{450, 680, 780, 810, 820}, // 2020: fully developed
		{520, 790, 910, 945, 0},   // 2021: 4 periods
		{610, 920, 1060, 0, 0},    // 2022: 3 periods
		{580, 870, 0, 0, 0},       // 2023: 2 periods
		{650, 0, 0, 0, 0},         // 2024: 1 period
	},
}

// ChainLadder performs chain-ladder IBNR estimation
func ChainLadder(triangle LossTriangle) ChainLadderResult {
	n := len(triangle.Cumulative)
	periods := triangle.DevPeriods

	// Calculate development factors (link ratios)
	factors := make([]float64, periods-1)
	for j := 0; j < periods-1; j++ {
		sumNumerator := 0.0
		sumDenominator := 0.0
		for i := 0; i < n; i++ {
			if j < len(triangle.Cumulative[i]) && j+1 < len(triangle.Cumulative[i]) &&
				triangle.Cumulative[i][j] > 0 && triangle.Cumulative[i][j+1] > 0 {
				sumNumerator += triangle.Cumulative[i][j+1]
				sumDenominator += triangle.Cumulative[i][j]
			}
		}
		if sumDenominator > 0 {
			factors[j] = sumNumerator / sumDenominator
		} else {
			factors[j] = 1.0
		}
	}

	// Project ultimate losses
	ultimates := make([]float64, n)
	ibnr := make([]float64, n)
	totalPaid := 0.0

	for i := 0; i < n; i++ {
		// Find last known value for this year
		lastKnown := 0.0
		lastPeriod := 0
		for j := 0; j < periods; j++ {
			if j < len(triangle.Cumulative[i]) && triangle.Cumulative[i][j] > 0 {
				lastKnown = triangle.Cumulative[i][j]
				lastPeriod = j
			}
		}
		totalPaid += lastKnown

		// Apply remaining development factors
		ultimate := lastKnown
		for j := lastPeriod; j < periods-1; j++ {
			ultimate *= factors[j]
		}
		ultimates[i] = math.Round(ultimate*100) / 100
		ibnr[i] = math.Round((ultimate-lastKnown)*100) / 100
	}

	totalIBNR := 0.0
	totalUltimate := 0.0
	for i := range ultimates {
		totalIBNR += ibnr[i]
		totalUltimate += ultimates[i]
	}

	return ChainLadderResult{
		DevelopmentFactors: factors,
		UltimateLosses:     ultimates,
		IBNRReserves:       ibnr,
		TotalIBNR:          math.Round(totalIBNR*100) / 100,
		TotalUltimate:      math.Round(totalUltimate*100) / 100,
		TotalPaid:          math.Round(totalPaid*100) / 100,
	}
}

// ─── Burning Cost Analysis ──────────────────────────────────────────────────
// Used for excess-of-loss reinsurance pricing

// BurningCostInput represents historical loss data for burning cost calculation
type BurningCostInput struct {
	Year           int     `json:"year"`
	GrossLosses    float64 `json:"gross_losses"`
	LargeClaimsXOL float64 `json:"large_claims_above_retention"` // Claims above retention
	EarnedPremium  float64 `json:"earned_premium"`
	InflationIndex float64 `json:"inflation_index"` // CPI index for trending
}

type BurningCostResult struct {
	BurningCostRate  float64   `json:"burning_cost_rate"`
	LoadedRate       float64   `json:"loaded_rate"`
	PurePremium      float64   `json:"pure_premium"`
	TechnicalPremium float64   `json:"technical_premium"`
	TrendedLosses    []float64 `json:"trended_losses"`
	AverageLossRatio float64   `json:"average_loss_ratio"`
	YearsAnalyzed    int       `json:"years_analyzed"`
	Retention        float64   `json:"retention"`
	Limit            float64   `json:"limit"`
}

// CalculateBurningCost computes the burning cost rate for XOL reinsurance
func CalculateBurningCost(data []BurningCostInput, retention, limit, prospectiveEPI float64) BurningCostResult {
	if len(data) == 0 {
		return BurningCostResult{}
	}

	// Trend losses to current year using inflation index
	latestIndex := data[len(data)-1].InflationIndex
	trendedLosses := make([]float64, len(data))
	totalTrendedLoss := 0.0
	totalTrendedPremium := 0.0

	for i, d := range data {
		trendFactor := latestIndex / d.InflationIndex
		// Apply trend to large claims above retention, cap at limit
		trendedClaim := d.LargeClaimsXOL * trendFactor
		if trendedClaim > limit {
			trendedClaim = limit
		}
		trendedLosses[i] = math.Round(trendedClaim*100) / 100
		totalTrendedLoss += trendedClaim
		totalTrendedPremium += d.EarnedPremium * trendFactor
	}

	// Burning cost rate = total trended XOL losses / total trended premium
	burningCostRate := 0.0
	if totalTrendedPremium > 0 {
		burningCostRate = totalTrendedLoss / totalTrendedPremium
	}

	// Loadings for reinsurance pricing
	loadingFactor := 1.30 // 30% loading (brokerage + profit + IBNR margin)
	loadedRate := burningCostRate * loadingFactor

	// Pure premium (rate * prospective EPI)
	purePremium := burningCostRate * prospectiveEPI
	technicalPremium := loadedRate * prospectiveEPI

	// Average loss ratio
	avgLossRatio := 0.0
	for _, d := range data {
		if d.EarnedPremium > 0 {
			avgLossRatio += d.GrossLosses / d.EarnedPremium
		}
	}
	avgLossRatio /= float64(len(data))

	return BurningCostResult{
		BurningCostRate:  math.Round(burningCostRate*10000) / 10000,
		LoadedRate:       math.Round(loadedRate*10000) / 10000,
		PurePremium:      math.Round(purePremium*100) / 100,
		TechnicalPremium: math.Round(technicalPremium*100) / 100,
		TrendedLosses:    trendedLosses,
		AverageLossRatio: math.Round(avgLossRatio*10000) / 10000,
		YearsAnalyzed:    len(data),
		Retention:        retention,
		Limit:            limit,
	}
}

// ─── Combined Ratio Calculation ──────────────────────────────────────────────

type CombinedRatioResult struct {
	LossRatio          float64 `json:"loss_ratio"`
	ExpenseRatio       float64 `json:"expense_ratio"`
	CombinedRatio      float64 `json:"combined_ratio"`
	Profitable         bool    `json:"profitable"`
	UnderwritingResult float64 `json:"underwriting_result"`
}

// CalculateCombinedRatio computes the key profitability metric
func CalculateCombinedRatio(incurredClaims, earnedPremium, expenses float64) CombinedRatioResult {
	lossRatio := 0.0
	if earnedPremium > 0 {
		lossRatio = incurredClaims / earnedPremium
	}
	expenseRatio := 0.0
	if earnedPremium > 0 {
		expenseRatio = expenses / earnedPremium
	}
	combined := lossRatio + expenseRatio
	uwResult := earnedPremium - incurredClaims - expenses

	return CombinedRatioResult{
		LossRatio:          math.Round(lossRatio*10000) / 10000,
		ExpenseRatio:       math.Round(expenseRatio*10000) / 10000,
		CombinedRatio:      math.Round(combined*10000) / 10000,
		Profitable:         combined < 1.0,
		UnderwritingResult: math.Round(uwResult*100) / 100,
	}
}
