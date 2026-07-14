package db

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/insureportal/enhanced_kyc_kyb/config"
	"github.com/insureportal/enhanced_kyc_kyb/models"

	"go.uber.org/zap"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// PostgresStore provides persistent storage for all KYC/KYB data.
type PostgresStore struct {
	db      *gorm.DB
	log     *zap.Logger
	cfg     *config.Config
}

// NewPostgresStore initializes a connection pool and auto-migrates schemas.
func NewPostgresStore(cfg *config.Config, log *zap.Logger) (*PostgresStore, error) {
	db, err := gorm.Open(postgres.Open(cfg.DSN()), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to postgres: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("failed to get sql.DB: %w", err)
	}

	sqlDB.SetMaxOpenConns(int(cfg.DBMaxConns))
	sqlDB.SetMaxIdleConns(int(cfg.DBMinConns))
	sqlDB.SetConnMaxLifetime(cfg.DBMaxLifetime)
	sqlDB.SetConnMaxIdleTime(cfg.DBMaxIdleTime)

	store := &PostgresStore{db: db, log: log, cfg: cfg}

	if err := store.autoMigrate(); err != nil {
		return nil, fmt.Errorf("failed to auto-migrate: %w", err)
	}

	log.Info("postgres connected successfully")
	return store, nil
}

func (s *PostgresStore) autoMigrate() error {
	return s.db.AutoMigrate(
		&models.IndividualKYC{},
		&models.BusinessKYC{},
		&models.KYCDocument{},
		&models.NINVerification{},
		&models.BVNVerification{},
		&models.AuditTrail{},
		&models.RefreshReminder{},
	)
}

// --- Individual KYC ---

func (s *PostgresStore) CreateIndividualKYC(kyc *models.IndividualKYC) error {
	return s.db.Create(kyc).Error
}

func (s *PostgresStore) GetIndividualKYC(customerID string) (*models.IndividualKYC, error) {
	var kyc models.IndividualKYC
	err := s.db.Where("customer_id = ?", customerID).First(&kyc).Error
	if err != nil {
		return nil, err
	}
	s.db.Where("individual_kyc_id = ?", kyc.ID).Find(&kyc.Documents)
	s.db.Where("individual_kyc_id = ?", kyc.ID).First(&kyc.NINRecord)
	s.db.Where("individual_kyc_id = ?", kyc.ID).First(&kyc.BVNRecord)
	return &kyc, nil
}

func (s *PostgresStore) UpdateKYCStatus(customerID string, status models.KYCStatus, details ...string) error {
	updates := map[string]interface{}{
		"status":      status,
		"updated_at":  time.Now(),
	}
	if len(details) > 0 {
		updates["risk_level"] = details[0]
	}
	return s.db.Model(&models.IndividualKYC{}).Where("customer_id = ?", customerID).Updates(updates).Error
}

// --- Business KYC ---

func (s *PostgresStore) CreateBusinessKYC(kyc *models.BusinessKYC) error {
	return s.db.Create(kyc).Error
}

func (s *PostgresStore) GetBusinessKYC(customerID string) (*models.BusinessKYC, error) {
	var kyc models.BusinessKYC
	err := s.db.Where("customer_id = ?", customerID).First(&kyc).Error
	if err != nil {
		return nil, err
	}
	s.db.Where("business_kyc_id = ?", kyc.ID).Find(&kyc.Documents)
	return &kyc, nil
}

// --- NIN Verification ---

func (s *PostgresStore) StoreNINVerification(rec *models.NINVerification) error {
	return s.db.Create(rec).Error
}

func (s *PostgresStore) GetNINVerification(nin string) (*models.NINVerification, error) {
	var rec models.NINVerification
	err := s.db.Where("nin = ?", nin).Last(&rec).Error
	return &rec, err
}

// --- BVN Verification ---

func (s *PostgresStore) StoreBVNVerification(rec *models.BVNVerification) error {
	return s.db.Create(rec).Error
}

func (s *PostgresStore) GetBVNVerification(bvn string) (*models.BVNVerification, error) {
	var rec models.BVNVerification
	err := s.db.Where("bvn = ?", bvn).Last(&rec).Error
	return &rec, err
}

// --- Expired KYC Records ---

func (s *PostgresStore) GetExpiredKYCs() ([]models.IndividualKYC, error) {
	var expired []models.IndividualKYC
	err := s.db.Where("expires_at < ? AND status = ?", time.Now().UTC(), models.Verified).
		Order("expires_at ASC").Find(&expired).Error
	return expired, err
}

func (s *PostgresStore) GetKYCStats() (*models.KYCStats, error) {
	stats := &models.KYCStats{}

	s.db.Model(&models.IndividualKYC{}).Count(&stats.TotalKYC)
	s.db.Model(&models.IndividualKYC{}).Where("status = ?", models.Verified).Count(&stats.VerifiedKYC)
	s.db.Model(&models.IndividualKYC{}).Where("status = ?", models.UnderReview).Count(&stats.UnderReviewKYC)
	s.db.Model(&models.IndividualKYC{}).Where("status = ?", models.Rejected).Count(&stats.RejectedKYC)
	s.db.Model(&models.IndividualKYC{}).Where("expires_at < ? AND status = ?", time.Now().UTC(), models.Verified).Count(&stats.ExpiredKYC)
	s.db.Model(&models.IndividualKYC{}).Where("status = ?", models.PendingRefresh).Count(&stats.PendingRefresh)

	s.db.Model(&models.BusinessKYC{}).Count(&stats.TotalBusiness)
	s.db.Model(&models.BusinessKYC{}).Where("status = ?", models.Verified).Count(&stats.VerifiedBusiness)

	var avgScore float64
	s.db.Table("individual_kycs").Select("AVG(CASE WHEN risk_level = 'low' THEN 25 WHEN risk_level = 'medium' THEN 50 WHEN risk_level = 'high' THEN 75 ELSE 100 END)").Scan(&avgScore)
	stats.AvgRiskScore = avgScore

	return stats, nil
}

// --- Document Storage with SHA256 Checksums ---

func (s *PostgresStore) StoreDocument(doc *models.KYCDocument) error {
	doc.SHA256Checksum = sha256Checksum(doc.FilePath)
	return s.db.Create(doc).Error
}

func (s *PostgresStore) GetDocument(documentID string) (*models.KYCDocument, error) {
	var doc models.KYCDocument
	err := s.db.Where("id = ?", documentID).First(&doc).Error
	return &doc, err
}

// sha256Checksum computes the hex-encoded SHA-256 hash of the file path string.
func sha256Checksum(filePath string) string {
	h := sha256.Sum256([]byte(filePath))
	return hex.EncodeToString(h[:])
}

// --- Audit Trail ---

func (s *PostgresStore) WriteAudit(action, entityType, entityID, userID, ipAddress, details string) {
	trail := models.AuditTrail{
		Timestamp:  time.Now().UTC(),
		Action:     action,
		EntityType: entityType,
		EntityID:   entityID,
		UserID:     userID,
		IPAddress:  ipAddress,
		Details:    details,
	}
	if err := s.db.Create(&trail).Error; err != nil {
		s.log.Error("failed to write audit trail", zap.Error(err))
	}
}

func (s *PostgresStore) GetAuditTrail(entityType, entityID string, limit int) ([]models.AuditTrail, error) {
	var trails []models.AuditTrail
	q := s.db.Where("entity_type = ? AND entity_id = ?", entityType, entityID).
		Order("timestamp DESC").Limit(limit)
	err := q.Find(&trails).Error
	return trails, err
}

// --- Refresh Reminders ---

func (s *PostgresStore) CreateRefreshReminder(reminder *models.RefreshReminder) error {
	return s.db.Create(reminder).Error
}

func (s *PostgresStore) GetRemindersDue() ([]models.RefreshReminder, error) {
	var reminders []models.RefreshReminder
	now := time.Now().UTC()
	twentyEightDays := now.AddDate(0, 0, 28)
	err := s.db.Where(
		"expires_at BETWEEN ? AND ? AND sent_at IS NULL",
		now, twentyEightDays,
	).Find(&reminders).Error
	return reminders, err
}

func (s *PostgresStore) MarkReminderSent(reminderID string) error {
	return s.db.Model(&models.RefreshReminder{}).
		Where("id = ?", reminderID).
		Update("sent_at", time.Now().UTC()).Error
}

// --- Bulk Status Update ---

func (s *PostgresStore) ExpireOverdueKYCs() (int64, error) {
	result := s.db.Model(&models.IndividualKYC{}).
		Where("expires_at < ? AND status = ?", time.Now().UTC(), models.Verified).
		Update("status", models.Expired)
	if result.Error != nil {
		return 0, result.Error
	}

	result = s.db.Model(&models.BusinessKYC{}).
		Where("expires_at < ? AND status = ?", time.Now().UTC(), models.Verified).
		Update("status", models.Expired)
	if result.Error != nil {
		return 0, result.Error
	}

	return result.RowsAffected * 2, nil
}

// --- GORM helper ---

// DB returns the underlying *gorm.DB for advanced queries.
func (s *PostgresStore) DB() *gorm.DB {
	return s.db
}
