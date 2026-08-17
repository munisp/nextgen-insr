package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/munisp/NGApp/gdpr-compliance/internal/models"
	"gorm.io/gorm"
)

type GDPRRepository struct{ db *gorm.DB }

func NewGDPRRepository(db *gorm.DB) *GDPRRepository { return &GDPRRepository{db: db} }

func (r *GDPRRepository) AutoMigrate() error {
	return r.db.AutoMigrate(&models.DataSubject{}, &models.ConsentRecord{}, &models.DataAccessRequest{}, &models.DataProcessingRecord{}, &models.DataBreach{})
}

func (r *GDPRRepository) CreateSubject(ctx context.Context, ds *models.DataSubject) error {
	ds.ID = uuid.New()
	ds.CreatedAt = time.Now()
	ds.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Create(ds).Error
}

func (r *GDPRRepository) GetSubject(ctx context.Context, ref string) (*models.DataSubject, error) {
	var ds models.DataSubject
	return &ds, r.db.WithContext(ctx).First(&ds, "subject_ref = ?", ref).Error
}

func (r *GDPRRepository) UpdateSubject(ctx context.Context, ds *models.DataSubject) error {
	ds.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Save(ds).Error
}

func (r *GDPRRepository) CreateConsent(ctx context.Context, cr *models.ConsentRecord) error {
	cr.ID = uuid.New()
	cr.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(cr).Error
}

func (r *GDPRRepository) GetConsents(ctx context.Context, subjectRef string) ([]models.ConsentRecord, error) {
	var consents []models.ConsentRecord
	return consents, r.db.WithContext(ctx).Where("subject_ref = ?", subjectRef).Order("created_at DESC").Find(&consents).Error
}

func (r *GDPRRepository) CreateAccessRequest(ctx context.Context, dar *models.DataAccessRequest) error {
	dar.ID = uuid.New()
	dar.CreatedAt = time.Now()
	dar.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Create(dar).Error
}

func (r *GDPRRepository) GetAccessRequest(ctx context.Context, ref string) (*models.DataAccessRequest, error) {
	var dar models.DataAccessRequest
	return &dar, r.db.WithContext(ctx).First(&dar, "request_ref = ?", ref).Error
}

func (r *GDPRRepository) ListAccessRequests(ctx context.Context, status string) ([]models.DataAccessRequest, error) {
	var requests []models.DataAccessRequest
	q := r.db.WithContext(ctx)
	if status != "" {
		q = q.Where("status = ?", status)
	}
	return requests, q.Order("created_at DESC").Limit(50).Find(&requests).Error
}

func (r *GDPRRepository) UpdateAccessRequest(ctx context.Context, dar *models.DataAccessRequest) error {
	dar.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Save(dar).Error
}

func (r *GDPRRepository) CreateProcessingRecord(ctx context.Context, dpr *models.DataProcessingRecord) error {
	dpr.ID = uuid.New()
	dpr.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(dpr).Error
}

func (r *GDPRRepository) ListProcessingRecords(ctx context.Context) ([]models.DataProcessingRecord, error) {
	var records []models.DataProcessingRecord
	return records, r.db.WithContext(ctx).Find(&records).Error
}

func (r *GDPRRepository) CreateBreach(ctx context.Context, db *models.DataBreach) error {
	db.ID = uuid.New()
	db.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(db).Error
}

func (r *GDPRRepository) GetBreach(ctx context.Context, ref string) (*models.DataBreach, error) {
	var breach models.DataBreach
	return &breach, r.db.WithContext(ctx).First(&breach, "breach_ref = ?", ref).Error
}

func (r *GDPRRepository) ListBreaches(ctx context.Context) ([]models.DataBreach, error) {
	var breaches []models.DataBreach
	return breaches, r.db.WithContext(ctx).Order("created_at DESC").Find(&breaches).Error
}

func (r *GDPRRepository) UpdateBreach(ctx context.Context, db *models.DataBreach) error {
	return r.db.WithContext(ctx).Save(db).Error
}

func (r *GDPRRepository) GetOverdueRequests(ctx context.Context) ([]models.DataAccessRequest, error) {
	var requests []models.DataAccessRequest
	return requests, r.db.WithContext(ctx).Where("status NOT IN ? AND due_date < ?", []string{"completed", "rejected"}, time.Now()).Find(&requests).Error
}
