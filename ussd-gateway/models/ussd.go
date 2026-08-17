package models

import "time"

// USSDRequest represents an incoming USSD payload from the mobile network operator.
type USSDRequest struct {
	SessionID   string `json:"session_id"`
	ServiceCode string `json:"service_code"`
	PhoneNumber string `json:"phone_number"`
	Message     string `json:"message"`
	Step        int    `json:"step"`
}

// USSDResponse represents the USSD reply to be sent back to the mobile network operator.
type USSDResponse struct {
	Action       string `json:"action"`
	Text         string `json:"text"`
	CloseSession bool   `json:"close_session"`
}

// SessionData stores the current state of an active USSD session.
type SessionData struct {
	SessionID   string                 `json:"session_id"`
	PhoneNumber string                 `json:"phone_number"`
	State       string                 `json:"state"`
	Data        map[string]interface{} `json:"data"`
	ExpiresAt   time.Time              `json:"expires_at"`
}

// AgentAccount represents an insurance agent registered in the system.
type AgentAccount struct {
	ID            string    `json:"id"`
	PhoneNumber   string    `json:"phone_number"`
	Name          string    `json:"name"`
	State         string    `json:"state"`
	LGA           string    `json:"lga"`
	BankAccount   string    `json:"bank_account"`
	BankName      string    `json:"bank_name"`
	Status        string    `json:"status"`
	FloatBalance  float64   `json:"float_balance"`
	TotalPolicies int64     `json:"total_policies"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// ProductOption represents an insurance product available through USSD.
type ProductOption struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Category         string   `json:"category"`
	MinPremium       float64  `json:"min_premium"`
	MaxPremium       float64  `json:"max_premium"`
	Description      string   `json:"description"`
	Requirements     []string `json:"requirements"`
	EnrollmentFields []string `json:"enrollment_fields"`
}

// USSDMenuState tracks the current step of the interactive menu flow.
type USSDMenuState struct {
	Step           string            `json:"step"`
	Selection      string            `json:"selection"`
	CollectorField string            `json:"collector_field"`
	CollectedData  map[string]string `json:"collected_data"`
}

// TransactionRecord represents a USSD-initiated transaction in the database.
type TransactionRecord struct {
	ID          string    `json:"id"`
	SessionID   string    `json:"session_id"`
	PhoneNumber string    `json:"phone_number"`
	Type        string    `json:"type"`
	ProductID   string    `json:"product_id"`
	Amount      float64   `json:"amount"`
	Status      string    `json:"status"`
	Reference   string    `json:"reference"`
	CreatedAt   time.Time `json:"created_at"`
}

// TransactionType constants.
const (
	TransactionTypeEnrollment   = "enrollment"
	TransactionTypeFloatClaim   = "float_claim"
	TransactionTypeRegistration = "registration"
)

// AgentStatus constants.
const (
	AgentStatusPending   = "pending"
	AgentStatusActive    = "active"
	AgentStatusSuspended = "suspended"
	AgentStatusDisabled  = "disabled"
)

// Product constants for USSD menu.
var Products = []ProductOption{
	{
		ID:               "life",
		Name:             "Life Insurance",
		Category:         "life",
		MinPremium:       5000,
		MaxPremium:       500000,
		Description:      "Term and whole life coverage for you and your family",
		Requirements:     []string{"Valid ID", "Medical certificate (for coverage >100,000)", "Passport photograph"},
		EnrollmentFields: []string{"full_name", "date_of_birth", "gender", "id_type", "id_number", "coverage_amount"},
	},
	{
		ID:               "health",
		Name:             "Health Insurance",
		Category:         "health",
		MinPremium:       10000,
		MaxPremium:       300000,
		Description:      "Comprehensive health coverage including outpatient and inpatient",
		Requirements:     []string{"Valid ID", "Medical history disclosure", "Dependent details (if applicable)"},
		EnrollmentFields: []string{"full_name", "date_of_birth", "id_type", "id_number", "plan_type", "dependents"},
	},
	{
		ID:               "motor",
		Name:             "Motor Insurance",
		Category:         "motor",
		MinPremium:       15000,
		MaxPremium:       1000000,
		Description:      "Comprehensive motor insurance for vehicles of all classes",
		Requirements:     []string{"Vehicle registration certificate", "Driver license", "Vehicle photo"},
		EnrollmentFields: []string{"full_name", "vehicle_type", "vehicle_make", "vehicle_year", "vehicle_number"},
	},
	{
		ID:               "micro",
		Name:             "Micro-insurance",
		Category:         "micro",
		MinPremium:       500,
		MaxPremium:       10000,
		Description:      "Affordable micro-insurance products for low-income earners",
		Requirements:     []string{"Valid phone number", "BVN or NIN"},
		EnrollmentFields: []string{"full_name", "bvn_or_nin", "product_type"},
	},
	{
		ID:               "bancassurance",
		Name:             "Bancassurance",
		Category:         "bancassurance",
		MinPremium:       20000,
		MaxPremium:       2000000,
		Description:      "Insurance products bundled with banking services",
		Requirements:     []string{"Valid ID", "Bank account statement", "Proof of income"},
		EnrollmentFields: []string{"full_name", "bank_name", "account_number", "id_type", "id_number", "coverage_amount"},
	},
}

// Lookup a product by ID.
func GetProductByID(id string) *ProductOption {
	for i := range Products {
		if Products[i].ID == id {
			return &Products[i]
		}
	}
	return nil
}
