package repository

import (
	"context"
	"time"

	"github.com/unified-insurance/pfa-integration/internal/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type PFARepository struct {
	db *gorm.DB
}

func NewPFARepository(db *gorm.DB) *PFARepository {
	return &PFARepository{db: db}
}

func (r *PFARepository) AutoMigrate() error {
	return r.db.AutoMigrate(
		&models.PFAPartner{}, &models.RSAHolder{}, &models.AnnuityProduct{},
		&models.AnnuityQuote{}, &models.AnnuityPolicy{}, &models.PensionPayment{},
		&models.GroupLifeForPension{}, &models.PenComReport{}, &models.FundTransfer{},
	)
}

func (r *PFARepository) CreatePFAPartner(ctx context.Context, p *models.PFAPartner) error {
	p.ID = uuid.New()
	p.CreatedAt = time.Now()
	p.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Create(p).Error
}

func (r *PFARepository) GetPFAPartner(ctx context.Context, id uuid.UUID) (*models.PFAPartner, error) {
	var p models.PFAPartner
	return &p, r.db.WithContext(ctx).First(&p, "id = ?", id).Error
}

func (r *PFARepository) ListPFAPartners(ctx context.Context) ([]models.PFAPartner, error) {
	var partners []models.PFAPartner
	return partners, r.db.WithContext(ctx).Where("is_active = ?", true).Find(&partners).Error
}

func (r *PFARepository) CreateRSAHolder(ctx context.Context, h *models.RSAHolder) error {
	h.ID = uuid.New()
	h.CreatedAt = time.Now()
	h.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Create(h).Error
}

func (r *PFARepository) GetRSAHolder(ctx context.Context, rsaPIN string) (*models.RSAHolder, error) {
	var h models.RSAHolder
	return &h, r.db.WithContext(ctx).Where("rsa_pin = ?", rsaPIN).First(&h).Error
}

func (r *PFARepository) GetRSAHolderByID(ctx context.Context, id uuid.UUID) (*models.RSAHolder, error) {
	var h models.RSAHolder
	return &h, r.db.WithContext(ctx).First(&h, "id = ?", id).Error
}

func (r *PFARepository) CreateAnnuityProduct(ctx context.Context, p *models.AnnuityProduct) error {
	p.ID = uuid.New()
	p.CreatedAt = time.Now()
	p.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Create(p).Error
}

func (r *PFARepository) GetAnnuityProduct(ctx context.Context, id uuid.UUID) (*models.AnnuityProduct, error) {
	var p models.AnnuityProduct
	return &p, r.db.WithContext(ctx).First(&p, "id = ?", id).Error
}

func (r *PFARepository) ListAnnuityProducts(ctx context.Context) ([]models.AnnuityProduct, error) {
	var products []models.AnnuityProduct
	return products, r.db.WithContext(ctx).Where("is_active = ?", true).Find(&products).Error
}

func (r *PFARepository) CreateAnnuityQuote(ctx context.Context, q *models.AnnuityQuote) error {
	q.ID = uuid.New()
	q.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(q).Error
}

func (r *PFARepository) GetAnnuityQuote(ctx context.Context, id uuid.UUID) (*models.AnnuityQuote, error) {
	var q models.AnnuityQuote
	return &q, r.db.WithContext(ctx).First(&q, "id = ?", id).Error
}

func (r *PFARepository) UpdateQuoteStatus(ctx context.Context, id uuid.UUID, status string) error {
	return r.db.WithContext(ctx).Model(&models.AnnuityQuote{}).Where("id = ?", id).Update("status", status).Error
}

func (r *PFARepository) CreateAnnuityPolicy(ctx context.Context, p *models.AnnuityPolicy) error {
	p.ID = uuid.New()
	p.CreatedAt = time.Now()
	p.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Create(p).Error
}

func (r *PFARepository) GetAnnuityPolicy(ctx context.Context, id uuid.UUID) (*models.AnnuityPolicy, error) {
	var p models.AnnuityPolicy
	return &p, r.db.WithContext(ctx).First(&p, "id = ?", id).Error
}

func (r *PFARepository) GetPoliciesByHolder(ctx context.Context, holderID uuid.UUID) ([]models.AnnuityPolicy, error) {
	var policies []models.AnnuityPolicy
	return policies, r.db.WithContext(ctx).Where("rsa_holder_id = ?", holderID).Find(&policies).Error
}

func (r *PFARepository) CreatePensionPayment(ctx context.Context, p *models.PensionPayment) error {
	p.ID = uuid.New()
	p.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(p).Error
}

func (r *PFARepository) GetPaymentsByPolicy(ctx context.Context, policyID uuid.UUID) ([]models.PensionPayment, error) {
	var payments []models.PensionPayment
	return payments, r.db.WithContext(ctx).Where("policy_id = ?", policyID).Order("payment_date DESC").Find(&payments).Error
}

func (r *PFARepository) CreateGroupLife(ctx context.Context, g *models.GroupLifeForPension) error {
	g.ID = uuid.New()
	g.CreatedAt = time.Now()
	g.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Create(g).Error
}

func (r *PFARepository) GetGroupLifeByEmployer(ctx context.Context, employerRCNo string) (*models.GroupLifeForPension, error) {
	var g models.GroupLifeForPension
	return &g, r.db.WithContext(ctx).Where("employer_rc_no = ? AND status = ?", employerRCNo, "active").First(&g).Error
}

func (r *PFARepository) CreatePenComReport(ctx context.Context, rpt *models.PenComReport) error {
	rpt.ID = uuid.New()
	rpt.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(rpt).Error
}

func (r *PFARepository) ListPenComReports(ctx context.Context, reportType string) ([]models.PenComReport, error) {
	var reports []models.PenComReport
	q := r.db.WithContext(ctx)
	if reportType != "" {
		q = q.Where("report_type = ?", reportType)
	}
	return reports, q.Order("created_at DESC").Find(&reports).Error
}

func (r *PFARepository) CreateFundTransfer(ctx context.Context, ft *models.FundTransfer) error {
	ft.ID = uuid.New()
	ft.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(ft).Error
}

func (r *PFARepository) GetFundTransfer(ctx context.Context, id uuid.UUID) (*models.FundTransfer, error) {
	var ft models.FundTransfer
	return &ft, r.db.WithContext(ctx).First(&ft, "id = ?", id).Error
}

func (r *PFARepository) UpdateFundTransferStatus(ctx context.Context, id uuid.UUID, status string) error {
	return r.db.WithContext(ctx).Model(&models.FundTransfer{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status": status, "transfer_date": time.Now(),
	}).Error
}
