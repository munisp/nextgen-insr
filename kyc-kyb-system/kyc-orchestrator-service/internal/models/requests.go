package models

type StartKYCRequest struct {
	UserID           string       `json:"user_id" binding:"required"`
	VerificationType string       `json:"verification_type" binding:"required"`
	DocumentType     DocumentType `json:"document_type"`
	TargetLevel      KYCLevel     `json:"target_level"`
}

type SubmitDocumentRequest struct {
	SessionID      string       `json:"session_id" binding:"required"`
	DocumentType   DocumentType `json:"document_type" binding:"required"`
	DocumentBase64 string       `json:"document_base64" binding:"required"`
	DocumentNumber string       `json:"document_number"`
}

type SubmitSelfieRequest struct {
	SessionID    string `json:"session_id" binding:"required"`
	ImageBase64  string `json:"image_base64" binding:"required"`
	ChallengeType string `json:"challenge_type"`
}

type VerifyNINRequest struct {
	SessionID string `json:"session_id" binding:"required"`
	NIN       string `json:"nin" binding:"required,len=11"`
	FirstName string `json:"first_name" binding:"required"`
	LastName  string `json:"last_name" binding:"required"`
}

type VerifyBVNRequest struct {
	SessionID string `json:"session_id" binding:"required"`
	BVN       string `json:"bvn" binding:"required,len=11"`
	FirstName string `json:"first_name" binding:"required"`
	LastName  string `json:"last_name" binding:"required"`
	DOB       string `json:"date_of_birth" binding:"required"`
}

type VerifyPhoneRequest struct {
	SessionID string `json:"session_id" binding:"required"`
	Phone     string `json:"phone" binding:"required"`
	OTP       string `json:"otp" binding:"required,len=6"`
}

type StartKYBRequest struct {
	BusinessID  string `json:"business_id" binding:"required"`
	CompanyName string `json:"company_name" binding:"required"`
	RCNumber    string `json:"rc_number" binding:"required"`
	TIN         string `json:"tin"`
}

type SubmitKYBDocumentRequest struct {
	SessionID      string       `json:"session_id" binding:"required"`
	DocumentType   DocumentType `json:"document_type" binding:"required"`
	DocumentBase64 string       `json:"document_base64" binding:"required"`
}

type AddDirectorRequest struct {
	SessionID string `json:"session_id" binding:"required"`
	Name      string `json:"name" binding:"required"`
	NIN       string `json:"nin"`
	BVN       string `json:"bvn"`
	Position  string `json:"position" binding:"required"`
}

type AddUBORequest struct {
	SessionID    string  `json:"session_id" binding:"required"`
	Name         string  `json:"name" binding:"required"`
	OwnershipPct float64 `json:"ownership_pct" binding:"required,gt=0,lte=100"`
	NIN          string  `json:"nin"`
}

type ReviewDecisionRequest struct {
	SessionID  string `json:"session_id" binding:"required"`
	ReviewerID string `json:"reviewer_id" binding:"required"`
	Decision   string `json:"decision" binding:"required,oneof=approve reject escalate"`
	Notes      string `json:"notes"`
	Reason     string `json:"reason"`
}

type AMLScreenRequest struct {
	SessionID string `json:"session_id" binding:"required"`
	FullName  string `json:"full_name" binding:"required"`
	DOB       string `json:"date_of_birth"`
	Country   string `json:"country"`
}
