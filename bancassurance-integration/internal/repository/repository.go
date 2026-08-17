package repository

import (
	"context"
	"github.com/unified-insurance/bancassurance-integration/internal/models"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type BancassuranceRepository struct {
	db *gorm.DB
}

func NewBancassuranceRepository(db *gorm.DB) *BancassuranceRepository {
	return &BancassuranceRepository{db: db}
}

func (r *BancassuranceRepository) AutoMigrate() error {
	return r.db.AutoMigrate(
		&models.BankPartner{},
		&models.BankCustomerMapping{},
		&models.InsuranceOffer{},
		&models.LoanProtectionPolicy{},
		&models.DebitMandate{},
		&models.PremiumCollection{},
		&models.CommissionSettlement{},
		&models.BankWebhookEvent{},
	)
}

func (r *BancassuranceRepository) CreateBankPartner(ctx context.Context, p *models.BankPartner) error {
	p.ID = uuid.New()
	p.CreatedAt = time.Now()
	p.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Create(p).Error
}

func (r *BancassuranceRepository) GetBankPartner(ctx context.Context, id uuid.UUID) (*models.BankPartner, error) {
	var p models.BankPartner
	return &p, r.db.WithContext(ctx).First(&p, "id = ?", id).Error
}

func (r *BancassuranceRepository) GetBankPartnerByCode(ctx context.Context, code string) (*models.BankPartner, error) {
	var p models.BankPartner
	return &p, r.db.WithContext(ctx).Where("bank_code = ? AND is_active = ?", code, true).First(&p).Error
}

func (r *BancassuranceRepository) ListBankPartners(ctx context.Context) ([]models.BankPartner, error) {
	var partners []models.BankPartner
	return partners, r.db.WithContext(ctx).Where("is_active = ?", true).Order("bank_name").Find(&partners).Error
}

func (r *BancassuranceRepository) UpdateBankPartner(ctx context.Context, p *models.BankPartner) error {
	p.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Save(p).Error
}

func (r *BancassuranceRepository) CreateCustomerMapping(ctx context.Context, m *models.BankCustomerMapping) error {
	m.ID = uuid.New()
	m.CreatedAt = time.Now()
	m.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Create(m).Error
}

func (r *BancassuranceRepository) GetCustomerMapping(ctx context.Context, bankPartnerID uuid.UUID, bankCustomerID string) (*models.BankCustomerMapping, error) {
	var m models.BankCustomerMapping
	return &m, r.db.WithContext(ctx).Where("bank_partner_id = ? AND bank_customer_id = ?", bankPartnerID, bankCustomerID).First(&m).Error
}

func (r *BancassuranceRepository) GetCustomerByBVN(ctx context.Context, bvn string) (*models.BankCustomerMapping, error) {
	var m models.BankCustomerMapping
	return &m, r.db.WithContext(ctx).Where("bvn = ?", bvn).First(&m).Error
}

func (r *BancassuranceRepository) CreateOffer(ctx context.Context, o *models.InsuranceOffer) error {
	o.ID = uuid.New()
	o.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(o).Error
}

func (r *BancassuranceRepository) GetOffer(ctx context.Context, id uuid.UUID) (*models.InsuranceOffer, error) {
	var o models.InsuranceOffer
	return &o, r.db.WithContext(ctx).First(&o, "id = ?", id).Error
}

func (r *BancassuranceRepository) UpdateOfferStatus(ctx context.Context, id uuid.UUID, status string) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&models.InsuranceOffer{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status":       status,
		"responded_at": now,
	}).Error
}

func (r *BancassuranceRepository) ListOffersByCustomer(ctx context.Context, customerMapID uuid.UUID) ([]models.InsuranceOffer, error) {
	var offers []models.InsuranceOffer
	return offers, r.db.WithContext(ctx).Where("customer_map_id = ?", customerMapID).Order("created_at DESC").Find(&offers).Error
}

func (r *BancassuranceRepository) CreateLoanProtectionPolicy(ctx context.Context, p *models.LoanProtectionPolicy) error {
	p.ID = uuid.New()
	p.CreatedAt = time.Now()
	p.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Create(p).Error
}

func (r *BancassuranceRepository) GetLoanProtectionPolicy(ctx context.Context, id uuid.UUID) (*models.LoanProtectionPolicy, error) {
	var p models.LoanProtectionPolicy
	return &p, r.db.WithContext(ctx).First(&p, "id = ?", id).Error
}

func (r *BancassuranceRepository) GetPoliciesByLoanAccount(ctx context.Context, loanAccountNo string) ([]models.LoanProtectionPolicy, error) {
	var policies []models.LoanProtectionPolicy
	return policies, r.db.WithContext(ctx).Where("loan_account_no = ?", loanAccountNo).Find(&policies).Error
}

func (r *BancassuranceRepository) UpdatePolicyStatus(ctx context.Context, id uuid.UUID, status string) error {
	return r.db.WithContext(ctx).Model(&models.LoanProtectionPolicy{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status":     status,
		"updated_at": time.Now(),
	}).Error
}

func (r *BancassuranceRepository) CreateDebitMandate(ctx context.Context, m *models.DebitMandate) error {
	m.ID = uuid.New()
	m.CreatedAt = time.Now()
	m.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Create(m).Error
}

func (r *BancassuranceRepository) GetDebitMandate(ctx context.Context, id uuid.UUID) (*models.DebitMandate, error) {
	var m models.DebitMandate
	return &m, r.db.WithContext(ctx).First(&m, "id = ?", id).Error
}

func (r *BancassuranceRepository) GetActiveMandatesByPolicy(ctx context.Context, policyID uuid.UUID) ([]models.DebitMandate, error) {
	var mandates []models.DebitMandate
	return mandates, r.db.WithContext(ctx).Where("policy_id = ? AND status = ?", policyID, "active").Find(&mandates).Error
}

func (r *BancassuranceRepository) UpdateMandateStatus(ctx context.Context, id uuid.UUID, status string) error {
	return r.db.WithContext(ctx).Model(&models.DebitMandate{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status":     status,
		"updated_at": time.Now(),
	}).Error
}

func (r *BancassuranceRepository) CreatePremiumCollection(ctx context.Context, c *models.PremiumCollection) error {
	c.ID = uuid.New()
	c.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(c).Error
}

func (r *BancassuranceRepository) GetCollectionsByMandate(ctx context.Context, mandateID uuid.UUID) ([]models.PremiumCollection, error) {
	var collections []models.PremiumCollection
	return collections, r.db.WithContext(ctx).Where("mandate_id = ?", mandateID).Order("collection_date DESC").Find(&collections).Error
}

func (r *BancassuranceRepository) CreateCommissionSettlement(ctx context.Context, s *models.CommissionSettlement) error {
	s.ID = uuid.New()
	s.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(s).Error
}

func (r *BancassuranceRepository) GetSettlementsByPartner(ctx context.Context, bankPartnerID uuid.UUID) ([]models.CommissionSettlement, error) {
	var settlements []models.CommissionSettlement
	return settlements, r.db.WithContext(ctx).Where("bank_partner_id = ?", bankPartnerID).Order("created_at DESC").Find(&settlements).Error
}

func (r *BancassuranceRepository) CreateWebhookEvent(ctx context.Context, e *models.BankWebhookEvent) error {
	e.ID = uuid.New()
	e.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(e).Error
}

func (r *BancassuranceRepository) UpdateWebhookEventStatus(ctx context.Context, id uuid.UUID, status, errorMsg string) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&models.BankWebhookEvent{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status":        status,
		"processed_at":  now,
		"error_message": errorMsg,
	}).Error
}

func (r *BancassuranceRepository) GetPremiumSummaryByPartner(ctx context.Context, bankPartnerID uuid.UUID, startDate, endDate time.Time) (float64, int64, error) {
	var result struct {
		TotalPremium float64
		Count        int64
	}
	err := r.db.WithContext(ctx).Model(&models.PremiumCollection{}).
		Select("COALESCE(SUM(amount), 0) as total_premium, COUNT(*) as count").
		Where("bank_partner_id = ? AND status = ? AND collection_date BETWEEN ? AND ?", bankPartnerID, "successful", startDate, endDate).
		Scan(&result).Error
	return result.TotalPremium, result.Count, err
}
