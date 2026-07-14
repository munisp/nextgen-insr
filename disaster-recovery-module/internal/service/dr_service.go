package service

import (
	"context"
	"fmt"
	"time"

	"github.com/insureportal/disaster_recovery_module/config"
	"github.com/insureportal/disaster_recovery_module/db"
	"github.com/insureportal/disaster_recovery_module/models"
	"go.uber.org/zap"
)

// DRService orchestrates disaster recovery operations
type DRService struct {
	pg   *db.PostgreSQL
	rdb  *db.RedisCache
	cfg  *config.Config
	log  *zap.Logger
}

// NewDRService creates a new DR service instance
func NewDRService(pg *db.PostgreSQL, rdb *db.RedisCache, cfg *config.Config) *DRService {
	return &DRService{
		pg:  pg,
		rdb: rdb,
		cfg: cfg,
		log: zap.L(),
	}
}

// RegisterService registers a service for DR protection
func (s *DRService) RegisterService(ctx context.Context, reg *models.ServiceRegistration) error {
	if reg.ServiceName == "" {
		return fmt.Errorf("service_name is required")
	}
	if reg.ServiceGroup == "" {
		reg.ServiceGroup = "default"
	}
	if reg.IsAutoFailover {
		reg.IsProtected = true
	}
	return s.pg.RegisterService(ctx, reg)
}

// UpdateServiceHeartbeat records a heartbeat for a registered service
func (s *DRService) UpdateServiceHeartbeat(ctx context.Context, serviceName, instanceID string, status string, responseMs int) error {
	if err := s.pg.UpdateHeartbeat(ctx, serviceName, instanceID, status, responseMs); err != nil {
		return err
	}

	isHealthy := status == "healthy"
	if err := s.rdb.RecordHeartbeat(ctx, serviceName, instanceID, isHealthy, responseMs); err != nil {
		s.log.Warn("Failed to record heartbeat in cache", zap.String("service", serviceName), zap.Error(err))
	}
	return nil
}

// CheckServiceHealthiness scans all registered services and updates their status
func (s *DRService) CheckServiceHealthiness(ctx context.Context) error {
	services, err := s.pg.GetProtectedServices(ctx)
	if err != nil {
		return err
	}

	for _, svc := range services {
		stale := time.Since(svc.UpdatedAt) > 2*s.cfg.ReadTimeout
		status := "unknown"
		if stale {
			status = "down"
		} else {
			status = "healthy"
		}

		if err := s.pg.UpdateHeartbeat(ctx, svc.ServiceName, "", status, 0); err != nil {
			s.log.Error("Failed to update heartbeat", zap.String("service", svc.ServiceName), zap.Error(err))
		}
	}
	return nil
}

// TriggerFailover initiates a failover from primary to secondary DC
func (s *DRService) TriggerFailover(ctx context.Context, eventType, triggerBy, triggerReason string, servicesAffected int) (*models.FailoverEvent, error) {
	// Acquire failover lock via Redis
	acquired, err := s.rdb.AcquireFailoverLock(ctx, triggerBy)
	if err != nil {
		return nil, fmt.Errorf("failed to acquire failover lock: %w", err)
	}
	if !acquired {
		return nil, fmt.Errorf("failover already in progress")
	}

	// Create failover event
	fe := &models.FailoverEvent{
		Type:              eventType,
		FromDC:            s.cfg.PrimaryDC,
		ToDC:              s.cfg.SecondaryDC,
		TriggeredBy:       triggerBy,
		TriggerReason:     triggerReason,
		ServicesAffected:  servicesAffected,
		NAICOMNotified:    false,
	}

	if err := s.pg.CreateFailoverEvent(ctx, fe); err != nil {
		s.rdb.ReleaseFailoverLock(ctx, triggerBy)
		return nil, fmt.Errorf("failed to create failover event: %w", err)
	}

	// Publish failover event for real-time notifications
	if err := s.rdb.PublishFailoverEvent(ctx, *fe); err != nil {
		s.log.Warn("Failed to publish failover event", zap.Error(err))
	}

	s.log.Info("Failover initiated",
		zap.String("event", fe.EventNumber),
		zap.String("from", s.cfg.PrimaryDC),
		zap.String("to", s.cfg.SecondaryDC),
	)

	return fe, nil
}

// CompleteFailover marks a failover event as completed and releases the lock
func (s *DRService) CompleteFailover(ctx context.Context, eventNumber string, rto, rpo *int) error {
	completedAt := time.Now()
	if err := s.pg.CompleteFailover(ctx, eventNumber, rto, rpo, completedAt); err != nil {
		return err
	}

	// Record RTO/RPO metrics
	tracker := &models.RTOTracker{
		MetricName:  "failover_rto",
		TargetValue: float64(s.cfg.RTOTarget.Seconds()),
		ActualValue: func() *float64 {
			if rto != nil {
				v := float64(*rto)
				return &v
			}
			return nil
		}(),
		Unit:        "seconds",
		Compliant:   rto == nil || *rto <= int(s.cfg.RTOTarget.Seconds()),
		PeriodStart: completedAt.Add(-24 * time.Hour),
		PeriodEnd:   completedAt,
	}
	if err := s.pg.RecordRTOTracker(ctx, tracker); err != nil {
		s.log.Warn("Failed to record RTO metric", zap.Error(err))
	}

	return s.rdb.ReleaseFailoverLock(ctx, "system")
}

// CreateDRDrill schedules a new DR drill
func (s *DRService) CreateDRDrill(ctx context.Context, drill *models.DRDrill) error {
	if drill.Type == "" {
		return fmt.Errorf("drill type is required")
	}
	if drill.ScheduledAt.IsZero() {
		drill.ScheduledAt = time.Now().Add(7 * 24 * time.Hour) // Default: 7 days from now
	}
	if drill.FromDC == "" {
		drill.FromDC = s.cfg.PrimaryDC
	}
	if drill.ToDC == "" {
		drill.ToDC = s.cfg.SecondaryDC
	}

	if err := s.pg.CreateDRDrill(ctx, drill); err != nil {
		return fmt.Errorf("failed to create DR drill: %w", err)
	}

	// Cache the next drill schedule
	s.nextDrillDate := drill.ScheduledAt.Format("2006-01-02")
	s.rdb.SetDrillSchedule(ctx, s.nextDrillDate)

	s.log.Info("DR drill scheduled",
		zap.String("drill", drill.DrillNumber),
		zap.String("scheduled", drill.ScheduledAt.Format("2006-01-02")),
	)
	return nil
}

// CompleteDRDrill marks a drill as completed
func (s *DRService) CompleteDRDrill(ctx context.Context, drillNumber, status, actualRTO, actualRPO, findings string) error {
	if err := s.pg.CompleteDRDrill(ctx, drillNumber, status, actualRTO, actualRPO, findings); err != nil {
		return err
	}
	return nil
}

// RecordBackupStatus records a backup operation
func (s *DRService) RecordBackupStatus(ctx context.Context, backup *models.BackupStatus) error {
	if backup.BackupType == "" {
		backup.BackupType = "db_snapshot"
	}
	if backup.SourceDC == "" {
		backup.SourceDC = s.cfg.PrimaryDC
	}
	if backup.Destination == "" {
		backup.Destination = s.cfg.SecondaryDC
	}

	if err := s.pg.CreateBackupStatus(ctx, backup); err != nil {
		return fmt.Errorf("failed to record backup: %w", err)
	}

	if err := s.rdb.CacheLatestBackup(ctx, backup); err != nil {
		s.log.Warn("Failed to cache backup status", zap.Error(err))
	}

	s.log.Info("Backup recorded",
		zap.String("type", backup.BackupType),
		zap.Float64("sizeGB", backup.BackupSizeGB),
	)
	return nil
}

// SendNAICOMNotification sends a regulatory notification to NAICOM
func (s *DRService) SendNAICOMNotification(ctx context.Context, notif *models.NAICOMNotification) error {
	if notif.EventType == "" || notif.Severity == "" {
		return fmt.Errorf("event_type and severity are required")
	}

	// Check if NAICOM notification threshold is exceeded
	if notif.DurationMin != nil && *notif.DurationMin >= int(s.cfg.NAICOMNotifyThreshold.Minutes()) {
		notif.Severity = "critical"
	}

	if err := s.pg.CreateNAICOMNotification(ctx, notif); err != nil {
		return fmt.Errorf("failed to record NAICOM notification: %w", err)
	}

	s.log.Info("NAICOM notification recorded",
		zap.String("number", notif.NotificationNumber),
		zap.String("event", notif.EventType),
	)
	return nil
}

// GetDashboard returns the DR dashboard data
func (s *DRService) GetDashboard(ctx context.Context) (*models.DRDashboard, error) {
	// Try cached dashboard first
	cached, err := s.rdb.GetCachedDashboard(ctx)
	if err == nil && cached != nil {
		return cached, nil
	}

	dashboard, err := s.pg.GetDashboard(ctx)
	if err != nil {
		return nil, err
	}

	// Set defaults
	dashboard.PrimaryDC = s.cfg.PrimaryDC
	dashboard.SecondaryDC = s.cfg.SecondaryDC
	dashboard.RTOTarget = s.cfg.RTOTarget.Round(time.Minute).String()
	dashboard.RPOTarget = s.cfg.RPOTarget.Round(time.Minute).String()

	// Get total and protected counts
	// (Simplified - in production, query from DB)
	services, _ := s.pg.GetProtectedServices(ctx)
	dashboard.TotalServices = len(services)
	dashboard.ProtectedCount = len(services)

	// Check RTO/RPO compliance
	rtoTrackers, err := s.pg.GetRTOTracker(ctx, "failover_rto")
	if err == nil && len(rtoTrackers) > 0 {
		dashboard.RTOCompliant = rtoTrackers[0].Compliant
	}

	// Get latest replication lag
	lag, _ := s.rdb.GetReplicationLag(ctx)
	dashboard.ReplicationLag = lag

	// Get next drill date
	nextDrill, _ := s.rdb.GetDrillSchedule(ctx)
	if nextDrill != "" {
		dashboard.NextDrillDate = nextDrill
	}

	// Cache the dashboard
	s.rdb.CacheDashboard(ctx, dashboard)

	return dashboard, nil
}

// GetFailoverEvents returns failover events with filtering
func (s *DRService) GetFailoverEvents(ctx context.Context, status string, limit, offset int) ([]models.FailoverEvent, error) {
	return s.pg.GetFailoverEvents(ctx, status, limit, offset)
}

// GetDRDrills returns DR drills with filtering
func (s *DRService) GetDRDrills(ctx context.Context, status string, limit int) ([]models.DRDrill, error) {
	return s.pg.GetDRDrills(ctx, status, limit)
}

// GetBackupStatuses returns backup statuses with filtering
func (s *DRService) GetBackupStatuses(ctx context.Context, status string, limit int) ([]models.BackupStatus, error) {
	return s.pg.GetBackupStatuses(ctx, status, limit)
}

// GetRTOCompliance returns RTO/RPO compliance data
func (s *DRService) GetRTOCompliance(ctx context.Context) ([]models.RTOTracker, error) {
	rtoTrackers, err := s.pg.GetRTOTracker(ctx, "failover_rto")
	if err != nil {
		return nil, err
	}
	rpoTrackers, err := s.pg.GetRTOTracker(ctx, "failover_rpo")
	if err != nil {
		return nil, err
	}

	// Combine both metrics
	result := make([]models.RTOTracker, 0, len(rtoTrackers)+len(rpoTrackers))
	result = append(result, rtoTrackers...)
	result = append(result, rpoTrackers...)
	return result, nil
}

// GetNAICOMNotifications returns regulatory notifications
func (s *DRService) GetNAICOMNotifications(ctx context.Context, limit int) ([]models.NAICOMNotification, error) {
	return s.pg.GetNAICOMNotifications(ctx, limit)
}

// nextDrillDate caches the next drill date
type DRServiceWithSchedule struct {
	*DRService
	nextDrillDate string
}

// GetNextDrillDate returns the next scheduled drill date
func (s *DRServiceWithSchedule) GetNextDrillDate() string {
	return s.nextDrillDate
}
