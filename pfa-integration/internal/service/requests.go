package service

import (
	"time"

	"github.com/google/uuid"
)

type RegisterPFARequest struct {
	PFACode        string  `json:"pfa_code"`
	PFAName        string  `json:"pfa_name"`
	PenComLicense  string  `json:"pencom_license"`
	ContactEmail   string  `json:"contact_email"`
	ContactPhone   string  `json:"contact_phone"`
	APIEndpoint    string  `json:"api_endpoint"`
	CommissionRate float64 `json:"commission_rate"`
}

type RegisterRSAHolderRequest struct {
	RSAPIN       string    `json:"rsa_pin"`
	PFAPartnerID uuid.UUID `json:"pfa_partner_id"`
	FirstName    string    `json:"first_name"`
	LastName     string    `json:"last_name"`
	DateOfBirth  time.Time `json:"date_of_birth"`
	Gender       string    `json:"gender"`
	Email        string    `json:"email"`
	Phone        string    `json:"phone"`
	EmployerName string    `json:"employer_name"`
	EmployerRCNo string    `json:"employer_rc_no"`
	RSABalance   float64   `json:"rsa_balance"`
}

type AnnuityQuoteRequest struct {
	RSAHolderID      uuid.UUID `json:"rsa_holder_id"`
	ProductID        uuid.UUID `json:"product_id"`
	ProductType      string    `json:"product_type"`
	PurchaseAmount   float64   `json:"purchase_amount"`
	GuaranteedPeriod int       `json:"guaranteed_period"`
	CommencementDate time.Time `json:"commencement_date"`
}

type GroupLifeRequest struct {
	PFAPartnerID         uuid.UUID `json:"pfa_partner_id"`
	EmployerRCNo         string    `json:"employer_rc_no"`
	EmployerName         string    `json:"employer_name"`
	MemberCount          int       `json:"member_count"`
	TotalAnnualEmolument float64   `json:"total_annual_emolument"`
	CoverMultiple        float64   `json:"cover_multiple"`
	Industry             string    `json:"industry"`
	InceptionDate        time.Time `json:"inception_date"`
}

type FundTransferRequest struct {
	RSAHolderID  uuid.UUID `json:"rsa_holder_id"`
	Amount       float64   `json:"amount"`
	TransferType string    `json:"transfer_type"`
}
