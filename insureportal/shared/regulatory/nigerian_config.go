package regulatory

import (
	"encoding/json"
	"os"
	"sync"
)

// NigerianRegulatoryConfig holds all configurable regulatory parameters.
// These values can be updated without redeployment by mounting a config file.
type NigerianRegulatoryConfig struct {
	NAICOM NAICOMConfig `json:"naicom"`
	NMID   NMIDConfig   `json:"nmid"`
	NDPR   NDPRConfig   `json:"ndpr"`
	Tax    TaxConfig    `json:"tax"`
	Motor  MotorConfig  `json:"motor"`
	Life   LifeConfig   `json:"life"`
}

// NAICOMConfig holds NAICOM regulatory thresholds
type NAICOMConfig struct {
	MinCapitalRequirement       float64 `json:"min_capital_requirement"`
	SolvencyMarginPercent       float64 `json:"solvency_margin_percent"`
	MaxSingleRiskPercent        float64 `json:"max_single_risk_percent"`
	TechnicalReservePercent     float64 `json:"technical_reserve_percent"`
	CompulsoryMotorCoverMinimum float64 `json:"compulsory_motor_cover_minimum"`
	ReinsuranceCessionLimit     float64 `json:"reinsurance_cession_limit"`
}

// NMIDConfig holds NMID motor insurance parameters
type NMIDConfig struct {
	ThirdPartyMinPremium  float64            `json:"third_party_min_premium"`
	ComprehensiveBaseRate float64            `json:"comprehensive_base_rate"`
	VehicleClassRates     map[string]float64 `json:"vehicle_class_rates"`
	AgeDepreciationRates  map[string]float64 `json:"age_depreciation_rates"`
	ExcessAmounts         map[string]float64 `json:"excess_amounts"`
}

// NDPRConfig holds Nigerian Data Protection Regulation parameters
type NDPRConfig struct {
	DataRetentionDays       int    `json:"data_retention_days"`
	ConsentExpiryDays       int    `json:"consent_expiry_days"`
	BreachNotificationHours int    `json:"breach_notification_hours"`
	DPORequired             bool   `json:"dpo_required"`
	RegulatorName           string `json:"regulator_name"`
	RegulatorEmail          string `json:"regulator_email"`
}

// TaxConfig holds Nigerian tax rates
type TaxConfig struct {
	VATPercent                 float64 `json:"vat_percent"`
	WithholdingTaxPercent      float64 `json:"withholding_tax_percent"`
	StampDutyPercent           float64 `json:"stamp_duty_percent"`
	InformationTechLevyPercent float64 `json:"information_tech_levy_percent"`
}

// MotorConfig holds motor insurance calculation parameters
type MotorConfig struct {
	MinThirdPartyPremium float64            `json:"min_third_party_premium"`
	FleetDiscountTiers   map[string]float64 `json:"fleet_discount_tiers"`
	NoClaimsDiscountMax  float64            `json:"no_claims_discount_max"`
	LoadingFactors       map[string]float64 `json:"loading_factors"`
}

// LifeConfig holds life insurance parameters
type LifeConfig struct {
	MortalityTableName  string             `json:"mortality_table_name"`
	MinEntryAge         int                `json:"min_entry_age"`
	MaxEntryAge         int                `json:"max_entry_age"`
	MaxCoverageMultiple float64            `json:"max_coverage_multiple"`
	GroupLifeMinMembers int                `json:"group_life_min_members"`
	OccupationClasses   map[string]float64 `json:"occupation_classes"`
}

var (
	defaultConfig     *NigerianRegulatoryConfig
	defaultConfigOnce sync.Once
)

// LoadConfig loads regulatory config from a JSON file or returns defaults
func LoadConfig(path string) (*NigerianRegulatoryConfig, error) {
	if path == "" {
		path = os.Getenv("REGULATORY_CONFIG_PATH")
	}
	if path == "" {
		path = "/etc/insurance-platform/regulatory-config.json"
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return DefaultConfig(), nil
	}

	var cfg NigerianRegulatoryConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// DefaultConfig returns the default Nigerian regulatory configuration
func DefaultConfig() *NigerianRegulatoryConfig {
	defaultConfigOnce.Do(func() {
		defaultConfig = &NigerianRegulatoryConfig{
			NAICOM: NAICOMConfig{
				MinCapitalRequirement:       3000000000, // NGN 3 billion
				SolvencyMarginPercent:       15.0,
				MaxSingleRiskPercent:        10.0,
				TechnicalReservePercent:     40.0,
				CompulsoryMotorCoverMinimum: 1000000, // NGN 1 million
				ReinsuranceCessionLimit:     70.0,
			},
			NMID: NMIDConfig{
				ThirdPartyMinPremium:  5000,
				ComprehensiveBaseRate: 0.05,
				VehicleClassRates: map[string]float64{
					"private_car":     1.0,
					"commercial":      1.25,
					"motorcycle":      0.75,
					"truck":           1.5,
					"bus":             1.35,
					"special_vehicle": 2.0,
				},
				AgeDepreciationRates: map[string]float64{
					"0-1":  1.0,
					"1-2":  0.90,
					"2-3":  0.80,
					"3-5":  0.70,
					"5-10": 0.55,
					"10+":  0.40,
				},
				ExcessAmounts: map[string]float64{
					"private_car": 50000,
					"commercial":  75000,
					"truck":       100000,
				},
			},
			NDPR: NDPRConfig{
				DataRetentionDays:       2555, // ~7 years
				ConsentExpiryDays:       365,
				BreachNotificationHours: 72,
				DPORequired:             true,
				RegulatorName:           "NITDA",
				RegulatorEmail:          "dpo@nitda.gov.ng",
			},
			Tax: TaxConfig{
				VATPercent:                 7.5,
				WithholdingTaxPercent:      10.0,
				StampDutyPercent:           0.075,
				InformationTechLevyPercent: 1.0,
			},
			Motor: MotorConfig{
				MinThirdPartyPremium: 5000,
				FleetDiscountTiers: map[string]float64{
					"5-10":  0.05,
					"11-25": 0.10,
					"26-50": 0.15,
					"50+":   0.20,
				},
				NoClaimsDiscountMax: 0.60,
				LoadingFactors: map[string]float64{
					"young_driver":     0.25,
					"new_driver":       0.20,
					"high_risk_area":   0.15,
					"claims_history":   0.30,
					"vehicle_modified": 0.10,
				},
			},
			Life: LifeConfig{
				MortalityTableName:  "Nigeria_A67-70_Modified",
				MinEntryAge:         18,
				MaxEntryAge:         65,
				MaxCoverageMultiple: 25.0,
				GroupLifeMinMembers: 10,
				OccupationClasses: map[string]float64{
					"class_1_office":    1.0,
					"class_2_light":     1.25,
					"class_3_manual":    1.50,
					"class_4_hazardous": 2.00,
					"class_5_special":   3.00,
				},
			},
		}
	})
	return defaultConfig
}
