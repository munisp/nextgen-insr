package repository

import (
	"context"
	"github.com/unified-insurance/reinsurance-management/internal/models"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ReinsuranceRepository struct {
	db *gorm.DB
}

func NewReinsuranceRepository(db *gorm.DB) *ReinsuranceRepository {
	return &ReinsuranceRepository{db: db}
}

func (r *ReinsuranceRepository) AutoMigrate() error {
	return r.db.AutoMigrate(
		&models.Treaty{}, &models.ReinsurerParticipation{}, &models.FacultativePlacement{},
		&models.CessionRecord{}, &models.ClaimRecovery{}, &models.BordereauEntry{},
		&models.ReinsuranceAccount{}, &models.ReinsuranceAnalytics{},
	)
}

func (r *ReinsuranceRepository) CreateTreaty(ctx context.Context, t *models.Treaty) error {
	t.ID = uuid.New()
	t.CreatedAt = time.Now()
	t.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Create(t).Error
}

func (r *ReinsuranceRepository) GetTreaty(ctx context.Context, id uuid.UUID) (*models.Treaty, error) {
	var t models.Treaty
	return &t, r.db.WithContext(ctx).First(&t, "id = ?", id).Error
}

func (r *ReinsuranceRepository) ListTreaties(ctx context.Context, lob string) ([]models.Treaty, error) {
	var treaties []models.Treaty
	q := r.db.WithContext(ctx)
	if lob != "" {
		q = q.Where("line_of_business = ?", lob)
	}
	return treaties, q.Where("status = ?", "active").Order("effective_date DESC").Find(&treaties).Error
}

func (r *ReinsuranceRepository) UpdateTreaty(ctx context.Context, t *models.Treaty) error {
	t.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Save(t).Error
}

func (r *ReinsuranceRepository) CreateParticipation(ctx context.Context, p *models.ReinsurerParticipation) error {
	p.ID = uuid.New()
	p.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(p).Error
}

func (r *ReinsuranceRepository) GetParticipations(ctx context.Context, treatyID uuid.UUID) ([]models.ReinsurerParticipation, error) {
	var parts []models.ReinsurerParticipation
	return parts, r.db.WithContext(ctx).Where("treaty_id = ?", treatyID).Find(&parts).Error
}

func (r *ReinsuranceRepository) CreateFacPlacement(ctx context.Context, f *models.FacultativePlacement) error {
	f.ID = uuid.New()
	f.CreatedAt = time.Now()
	f.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Create(f).Error
}

func (r *ReinsuranceRepository) GetFacPlacement(ctx context.Context, id uuid.UUID) (*models.FacultativePlacement, error) {
	var f models.FacultativePlacement
	return &f, r.db.WithContext(ctx).First(&f, "id = ?", id).Error
}

func (r *ReinsuranceRepository) ListFacPlacements(ctx context.Context, status string) ([]models.FacultativePlacement, error) {
	var placements []models.FacultativePlacement
	q := r.db.WithContext(ctx)
	if status != "" {
		q = q.Where("status = ?", status)
	}
	return placements, q.Order("created_at DESC").Find(&placements).Error
}

func (r *ReinsuranceRepository) UpdateFacPlacementStatus(ctx context.Context, id uuid.UUID, status, placedWith string) error {
	return r.db.WithContext(ctx).Model(&models.FacultativePlacement{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status": status, "placed_with": placedWith, "updated_at": time.Now(),
	}).Error
}

func (r *ReinsuranceRepository) CreateCession(ctx context.Context, c *models.CessionRecord) error {
	c.ID = uuid.New()
	c.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(c).Error
}

func (r *ReinsuranceRepository) GetCessionsByTreaty(ctx context.Context, treatyID uuid.UUID) ([]models.CessionRecord, error) {
	var cessions []models.CessionRecord
	return cessions, r.db.WithContext(ctx).Where("treaty_id = ?", treatyID).Find(&cessions).Error
}

func (r *ReinsuranceRepository) CreateClaimRecovery(ctx context.Context, cr *models.ClaimRecovery) error {
	cr.ID = uuid.New()
	cr.CreatedAt = time.Now()
	cr.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Create(cr).Error
}

func (r *ReinsuranceRepository) GetClaimRecovery(ctx context.Context, id uuid.UUID) (*models.ClaimRecovery, error) {
	var cr models.ClaimRecovery
	return &cr, r.db.WithContext(ctx).First(&cr, "id = ?", id).Error
}

func (r *ReinsuranceRepository) UpdateClaimRecoveryStatus(ctx context.Context, id uuid.UUID, status string) error {
	return r.db.WithContext(ctx).Model(&models.ClaimRecovery{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status": status, "updated_at": time.Now(),
	}).Error
}

func (r *ReinsuranceRepository) GetRecoveriesByTreaty(ctx context.Context, treatyID uuid.UUID) ([]models.ClaimRecovery, error) {
	var recoveries []models.ClaimRecovery
	return recoveries, r.db.WithContext(ctx).Where("treaty_id = ?", treatyID).Find(&recoveries).Error
}

func (r *ReinsuranceRepository) CreateBordereauxEntry(ctx context.Context, b *models.BordereauEntry) error {
	b.ID = uuid.New()
	b.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(b).Error
}

func (r *ReinsuranceRepository) GetBordereauxByTreaty(ctx context.Context, treatyID uuid.UUID, period string) ([]models.BordereauEntry, error) {
	var entries []models.BordereauEntry
	q := r.db.WithContext(ctx).Where("treaty_id = ?", treatyID)
	if period != "" {
		q = q.Where("period = ?", period)
	}
	return entries, q.Order("created_at").Find(&entries).Error
}

func (r *ReinsuranceRepository) CreateAccount(ctx context.Context, a *models.ReinsuranceAccount) error {
	a.ID = uuid.New()
	a.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(a).Error
}

func (r *ReinsuranceRepository) GetAccountsByTreaty(ctx context.Context, treatyID uuid.UUID) ([]models.ReinsuranceAccount, error) {
	var accounts []models.ReinsuranceAccount
	return accounts, r.db.WithContext(ctx).Where("treaty_id = ?", treatyID).Order("period DESC").Find(&accounts).Error
}

func (r *ReinsuranceRepository) CreateAnalytics(ctx context.Context, a *models.ReinsuranceAnalytics) error {
	a.ID = uuid.New()
	a.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(a).Error
}

func (r *ReinsuranceRepository) GetAnalytics(ctx context.Context, period string) (*models.ReinsuranceAnalytics, error) {
	var a models.ReinsuranceAnalytics
	return &a, r.db.WithContext(ctx).Where("period = ?", period).First(&a).Error
}

func (r *ReinsuranceRepository) GetTotalCededPremium(ctx context.Context, treatyID uuid.UUID, start, end time.Time) (float64, error) {
	var total float64
	err := r.db.WithContext(ctx).Model(&models.CessionRecord{}).
		Where("treaty_id = ? AND effective_date BETWEEN ? AND ?", treatyID, start, end).
		Select("COALESCE(SUM(ceded_premium), 0)").Scan(&total).Error
	return total, err
}

func (r *ReinsuranceRepository) GetTotalRecoveries(ctx context.Context, treatyID uuid.UUID) (float64, error) {
	var total float64
	err := r.db.WithContext(ctx).Model(&models.ClaimRecovery{}).
		Where("treaty_id = ? AND status = ?", treatyID, "paid").
		Select("COALESCE(SUM(recovery_amount), 0)").Scan(&total).Error
	return total, err
}
