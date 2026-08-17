package repository

import (
	"context"
	"github.com/unified-insurance/group-life-admin/internal/models"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type GroupLifeRepository struct {
	db *gorm.DB
}

func NewGroupLifeRepository(db *gorm.DB) *GroupLifeRepository {
	return &GroupLifeRepository{db: db}
}

func (r *GroupLifeRepository) AutoMigrate() error {
	return r.db.AutoMigrate(
		&models.GroupScheme{}, &models.SchemeMember{}, &models.MemberBeneficiary{},
		&models.GroupClaim{}, &models.PremiumSchedule{}, &models.SchemeEndorsement{},
		&models.ExperienceRating{},
	)
}

func (r *GroupLifeRepository) CreateScheme(ctx context.Context, s *models.GroupScheme) error {
	s.ID = uuid.New()
	s.CreatedAt = time.Now()
	s.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Create(s).Error
}

func (r *GroupLifeRepository) GetScheme(ctx context.Context, id uuid.UUID) (*models.GroupScheme, error) {
	var s models.GroupScheme
	return &s, r.db.WithContext(ctx).First(&s, "id = ?", id).Error
}

func (r *GroupLifeRepository) ListSchemes(ctx context.Context, status string) ([]models.GroupScheme, error) {
	var schemes []models.GroupScheme
	q := r.db.WithContext(ctx)
	if status != "" {
		q = q.Where("status = ?", status)
	}
	return schemes, q.Order("created_at DESC").Find(&schemes).Error
}

func (r *GroupLifeRepository) UpdateScheme(ctx context.Context, s *models.GroupScheme) error {
	s.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Save(s).Error
}

func (r *GroupLifeRepository) CreateMember(ctx context.Context, m *models.SchemeMember) error {
	m.ID = uuid.New()
	m.CreatedAt = time.Now()
	m.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Create(m).Error
}

func (r *GroupLifeRepository) GetMember(ctx context.Context, id uuid.UUID) (*models.SchemeMember, error) {
	var m models.SchemeMember
	return &m, r.db.WithContext(ctx).First(&m, "id = ?", id).Error
}

func (r *GroupLifeRepository) GetMembersByScheme(ctx context.Context, schemeID uuid.UUID) ([]models.SchemeMember, error) {
	var members []models.SchemeMember
	return members, r.db.WithContext(ctx).Where("scheme_id = ? AND status = ?", schemeID, "active").Find(&members).Error
}

func (r *GroupLifeRepository) UpdateMember(ctx context.Context, m *models.SchemeMember) error {
	m.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Save(m).Error
}

func (r *GroupLifeRepository) CountActiveMembers(ctx context.Context, schemeID uuid.UUID) (int64, error) {
	var count int64
	return count, r.db.WithContext(ctx).Model(&models.SchemeMember{}).Where("scheme_id = ? AND status = ?", schemeID, "active").Count(&count).Error
}

func (r *GroupLifeRepository) GetTotalSumAssured(ctx context.Context, schemeID uuid.UUID) (float64, error) {
	var total float64
	return total, r.db.WithContext(ctx).Model(&models.SchemeMember{}).Where("scheme_id = ? AND status = ?", schemeID, "active").Select("COALESCE(SUM(sum_assured), 0)").Scan(&total).Error
}

func (r *GroupLifeRepository) CreateBeneficiary(ctx context.Context, b *models.MemberBeneficiary) error {
	b.ID = uuid.New()
	b.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(b).Error
}

func (r *GroupLifeRepository) GetBeneficiaries(ctx context.Context, memberID uuid.UUID) ([]models.MemberBeneficiary, error) {
	var beneficiaries []models.MemberBeneficiary
	return beneficiaries, r.db.WithContext(ctx).Where("member_id = ?", memberID).Find(&beneficiaries).Error
}

func (r *GroupLifeRepository) CreateClaim(ctx context.Context, c *models.GroupClaim) error {
	c.ID = uuid.New()
	c.CreatedAt = time.Now()
	c.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Create(c).Error
}

func (r *GroupLifeRepository) GetClaim(ctx context.Context, id uuid.UUID) (*models.GroupClaim, error) {
	var c models.GroupClaim
	return &c, r.db.WithContext(ctx).First(&c, "id = ?", id).Error
}

func (r *GroupLifeRepository) GetClaimsByScheme(ctx context.Context, schemeID uuid.UUID) ([]models.GroupClaim, error) {
	var claims []models.GroupClaim
	return claims, r.db.WithContext(ctx).Where("scheme_id = ?", schemeID).Order("created_at DESC").Find(&claims).Error
}

func (r *GroupLifeRepository) UpdateClaim(ctx context.Context, c *models.GroupClaim) error {
	c.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Save(c).Error
}

func (r *GroupLifeRepository) GetTotalClaimsByScheme(ctx context.Context, schemeID uuid.UUID, period string) (float64, error) {
	var total float64
	return total, r.db.WithContext(ctx).Model(&models.GroupClaim{}).Where("scheme_id = ? AND status = ?", schemeID, "paid").Select("COALESCE(SUM(approved_amount), 0)").Scan(&total).Error
}

func (r *GroupLifeRepository) CreatePremiumSchedule(ctx context.Context, ps *models.PremiumSchedule) error {
	ps.ID = uuid.New()
	ps.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(ps).Error
}

func (r *GroupLifeRepository) GetPremiumSchedules(ctx context.Context, schemeID uuid.UUID) ([]models.PremiumSchedule, error) {
	var schedules []models.PremiumSchedule
	return schedules, r.db.WithContext(ctx).Where("scheme_id = ?", schemeID).Order("due_date DESC").Find(&schedules).Error
}

func (r *GroupLifeRepository) UpdatePremiumSchedule(ctx context.Context, ps *models.PremiumSchedule) error {
	return r.db.WithContext(ctx).Save(ps).Error
}

func (r *GroupLifeRepository) CreateEndorsement(ctx context.Context, e *models.SchemeEndorsement) error {
	e.ID = uuid.New()
	e.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(e).Error
}

func (r *GroupLifeRepository) GetEndorsements(ctx context.Context, schemeID uuid.UUID) ([]models.SchemeEndorsement, error) {
	var endorsements []models.SchemeEndorsement
	return endorsements, r.db.WithContext(ctx).Where("scheme_id = ?", schemeID).Order("created_at DESC").Find(&endorsements).Error
}

func (r *GroupLifeRepository) CreateExperienceRating(ctx context.Context, er *models.ExperienceRating) error {
	er.ID = uuid.New()
	er.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(er).Error
}

func (r *GroupLifeRepository) GetExperienceRatings(ctx context.Context, schemeID uuid.UUID) ([]models.ExperienceRating, error) {
	var ratings []models.ExperienceRating
	return ratings, r.db.WithContext(ctx).Where("scheme_id = ?", schemeID).Order("period DESC").Find(&ratings).Error
}

func (r *GroupLifeRepository) GetTotalEarnedPremium(ctx context.Context, schemeID uuid.UUID) (float64, error) {
	var total float64
	return total, r.db.WithContext(ctx).Model(&models.PremiumSchedule{}).Where("scheme_id = ? AND status = ?", schemeID, "paid").Select("COALESCE(SUM(paid_amount), 0)").Scan(&total).Error
}
