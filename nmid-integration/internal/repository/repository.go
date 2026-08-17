package repository

import (
	"context"
	"github.com/unified-insurance/nmid-integration/internal/models"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type NMIDRepository struct {
	db *gorm.DB
}

func NewNMIDRepository(db *gorm.DB) *NMIDRepository {
	return &NMIDRepository{db: db}
}

func (r *NMIDRepository) AutoMigrate() error {
	return r.db.AutoMigrate(
		&models.VehicleRecord{}, &models.PolicyRegistration{}, &models.ClaimHistoryRecord{},
		&models.CertificateVerification{}, &models.BatchRegistration{}, &models.RenewalTracking{},
		&models.NMIDSyncLog{},
	)
}

func (r *NMIDRepository) CreateVehicle(ctx context.Context, v *models.VehicleRecord) error {
	v.ID = uuid.New()
	v.CreatedAt = time.Now()
	v.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Create(v).Error
}

func (r *NMIDRepository) GetVehicle(ctx context.Context, regNo string) (*models.VehicleRecord, error) {
	var v models.VehicleRecord
	return &v, r.db.WithContext(ctx).Where("registration_no = ?", regNo).First(&v).Error
}

func (r *NMIDRepository) GetVehicleByChassis(ctx context.Context, chassisNo string) (*models.VehicleRecord, error) {
	var v models.VehicleRecord
	return &v, r.db.WithContext(ctx).Where("chassis_no = ?", chassisNo).First(&v).Error
}

func (r *NMIDRepository) UpdateVehicle(ctx context.Context, v *models.VehicleRecord) error {
	v.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Save(v).Error
}

func (r *NMIDRepository) CreatePolicyRegistration(ctx context.Context, p *models.PolicyRegistration) error {
	p.ID = uuid.New()
	p.CreatedAt = time.Now()
	p.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Create(p).Error
}

func (r *NMIDRepository) GetPolicyRegistration(ctx context.Context, id uuid.UUID) (*models.PolicyRegistration, error) {
	var p models.PolicyRegistration
	return &p, r.db.WithContext(ctx).First(&p, "id = ?", id).Error
}

func (r *NMIDRepository) GetPolicyByNMIDRef(ctx context.Context, ref string) (*models.PolicyRegistration, error) {
	var p models.PolicyRegistration
	return &p, r.db.WithContext(ctx).Where("nmid_policy_ref = ?", ref).First(&p).Error
}

func (r *NMIDRepository) GetPoliciesByVehicle(ctx context.Context, regNo string) ([]models.PolicyRegistration, error) {
	var policies []models.PolicyRegistration
	return policies, r.db.WithContext(ctx).Where("registration_no = ? AND status = ?", regNo, "active").Order("inception_date DESC").Find(&policies).Error
}

func (r *NMIDRepository) UpdatePolicyRegistration(ctx context.Context, p *models.PolicyRegistration) error {
	p.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Save(p).Error
}

func (r *NMIDRepository) GetExpiringPolicies(ctx context.Context, beforeDate time.Time) ([]models.PolicyRegistration, error) {
	var policies []models.PolicyRegistration
	return policies, r.db.WithContext(ctx).Where("expiry_date <= ? AND status = ?", beforeDate, "active").Find(&policies).Error
}

func (r *NMIDRepository) CreateClaimHistory(ctx context.Context, c *models.ClaimHistoryRecord) error {
	c.ID = uuid.New()
	c.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(c).Error
}

func (r *NMIDRepository) GetClaimHistory(ctx context.Context, regNo string) ([]models.ClaimHistoryRecord, error) {
	var claims []models.ClaimHistoryRecord
	return claims, r.db.WithContext(ctx).Where("registration_no = ?", regNo).Order("accident_date DESC").Find(&claims).Error
}

func (r *NMIDRepository) CreateVerification(ctx context.Context, v *models.CertificateVerification) error {
	v.ID = uuid.New()
	v.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(v).Error
}

func (r *NMIDRepository) GetVerificationsByCert(ctx context.Context, certNo string) ([]models.CertificateVerification, error) {
	var verifications []models.CertificateVerification
	return verifications, r.db.WithContext(ctx).Where("certificate_no = ?", certNo).Order("created_at DESC").Find(&verifications).Error
}

func (r *NMIDRepository) CreateBatch(ctx context.Context, b *models.BatchRegistration) error {
	b.ID = uuid.New()
	b.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(b).Error
}

func (r *NMIDRepository) GetBatch(ctx context.Context, batchRef string) (*models.BatchRegistration, error) {
	var b models.BatchRegistration
	return &b, r.db.WithContext(ctx).Where("batch_ref = ?", batchRef).First(&b).Error
}

func (r *NMIDRepository) UpdateBatch(ctx context.Context, b *models.BatchRegistration) error {
	return r.db.WithContext(ctx).Save(b).Error
}

func (r *NMIDRepository) CreateRenewalTracking(ctx context.Context, rt *models.RenewalTracking) error {
	rt.ID = uuid.New()
	rt.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(rt).Error
}

func (r *NMIDRepository) GetPendingRenewals(ctx context.Context) ([]models.RenewalTracking, error) {
	var renewals []models.RenewalTracking
	return renewals, r.db.WithContext(ctx).Where("status IN ?", []string{"pending", "reminded"}).Order("expiry_date ASC").Find(&renewals).Error
}

func (r *NMIDRepository) UpdateRenewalTracking(ctx context.Context, rt *models.RenewalTracking) error {
	return r.db.WithContext(ctx).Save(rt).Error
}

func (r *NMIDRepository) CreateSyncLog(ctx context.Context, l *models.NMIDSyncLog) error {
	l.ID = uuid.New()
	l.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(l).Error
}

func (r *NMIDRepository) GetPoliciesByCertificate(ctx context.Context, certNo string) (*models.PolicyRegistration, error) {
	var p models.PolicyRegistration
	return &p, r.db.WithContext(ctx).Where("certificate_no = ?", certNo).First(&p).Error
}
