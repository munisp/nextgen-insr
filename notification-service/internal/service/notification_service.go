package service

import (
	"context"
	"fmt"
	"time"

	"github.com/insureportal/notification_service/config"
	"github.com/insureportal/notification_service/db"
	"github.com/insureportal/notification_service/models"
	"go.uber.org/zap"
)

type NotificationService struct {
	pg  *db.PostgreSQL
	rdb *db.RedisCache
	cfg *config.Config
	log *zap.Logger
}

func NewNotificationService(pg *db.PostgreSQL, rdb *db.RedisCache, cfg *config.Config) *NotificationService {
	return &NotificationService{pg: pg, rdb: rdb, cfg: cfg, log: zap.L()}
}

// --- Core Send Operation ---

func (s *NotificationService) SendNotification(ctx context.Context, n *models.Notification) error {
	if n.Channel == "" {
		return fmt.Errorf("channel is required")
	}
	if n.To == "" {
		return fmt.Errorf("recipient (to) is required")
	}

	// Check quiet hours for non-critical notifications
	if n.Priority != models.Prio1Critical {
		if s.rdb.IsInQuietHours(s.cfg.QuietHoursStart, s.cfg.QuietHoursEnd) {
			s.log.Info("Notification suppressed due to quiet hours",
				zap.String("channel", string(n.Channel)), zap.String("to", n.To))
			// Still queue it but mark as suppressed
			n.Status = "queued"
			return s.pg.CreateNotification(ctx, n)
		}
	}

	// Check rate limits per customer per channel
	if n.CustomerID != "" && n.Channel != models.ChannelInApp {
		limit := 5 // default SMS limit
		if n.Channel == models.ChannelSMS {
			limit = s.cfg.SMSMaxPerDay
		} else if n.Channel == models.ChannelPush {
			limit = s.cfg.PushMaxPerHour
		}
		allowed, err := s.rdb.CheckRateLimit(ctx, n.CustomerID, string(n.Channel), limit)
		if err != nil {
			return fmt.Errorf("rate limit check failed: %w", err)
		}
		if !allowed {
			return fmt.Errorf("rate limit exceeded for customer %s on channel %s", n.CustomerID, n.Channel)
		}
	}

	// Validate template if provided
	if n.TemplateName != "" {
		template, err := s.pg.GetTemplate(ctx, n.TemplateName)
		if err != nil {
			return fmt.Errorf("template not found: %w", err)
		}
		if !template.IsActive {
			return fmt.Errorf("template is inactive: %s", n.TemplateName)
		}
		n.Message = s.renderTemplate(template, n.TemplateData)
	}

	// Determine delivery channels based on priority
	channels := s.resolveChannels(n)

	// For simplicity, send via the primary channel first
	if err := s.pg.CreateNotification(ctx, n); err != nil {
		return fmt.Errorf("failed to create notification: %w", err)
	}

	// Publish event for async processing
	_ = s.rdb.PublishDeliveryEvent(ctx, *n, "queued")

	s.log.Info("Notification queued for delivery",
		zap.String("id", n.NotificationID),
		zap.String("channel", string(n.Channel)),
		zap.String("to", n.To),
		zap.Int("priority", int(n.Priority)),
	)
	return nil
}

func (s *NotificationService) resolveChannels(n *models.Notification) []models.NotificationChannel {
	switch n.Priority {
	case models.Prio1Critical:
		return []models.NotificationChannel{models.ChannelSMS, models.ChannelEmail, models.ChannelPush, models.ChannelWhatsApp}
	case models.Prio2High:
		return []models.NotificationChannel{models.ChannelEmail, models.ChannelPush}
	default:
		return []models.NotificationChannel{n.Channel}
	}
}

func (s *NotificationService) renderTemplate(template *models.NotificationTemplate, data string) string {
	// Simplified template rendering - in production would use Go templates
	if template.ChannelSMS != "" {
		return template.ChannelSMS
	}
	if template.ChannelEmail != "" {
		return template.ChannelEmail
	}
	return "Message from template: " + template.Name
}

// --- Template Management ---

func (s *NotificationService) CreateTemplate(ctx context.Context, t *models.NotificationTemplate) error {
	if t.TemplateCode == "" {
		return fmt.Errorf("template_code is required")
	}
	if t.Name == "" {
		return fmt.Errorf("name is required")
	}
	if t.Channels == "" {
		return fmt.Errorf("at least one channel is required")
	}
	return s.pg.CreateTemplate(ctx, t)
}

func (s *NotificationService) GetTemplate(ctx context.Context, code string) (*models.NotificationTemplate, error) {
	return s.pg.GetTemplate(ctx, code)
}

func (s *NotificationService) ListTemplates(ctx context.Context, isActive bool) ([]models.NotificationTemplate, error) {
	return s.pg.ListTemplates(ctx, isActive)
}

// --- Delivery Tracking ---

func (s *NotificationService) GetNotification(ctx context.Context, id string) (*models.Notification, error) {
	return s.pg.GetNotification(ctx, id)
}

func (s *NotificationService) GetDeliveryAttempts(ctx context.Context, notificationID string) ([]models.DeliveryAttempt, error) {
	return s.pg.GetDeliveryAttempts(ctx, notificationID)
}

func (s *NotificationService) CreateDeliveryAttempt(ctx context.Context, da *models.DeliveryAttempt) error {
	// Update notification status based on attempt result
	status := "retrying"
	if da.Status == "delivered" {
		status = "delivered"
	} else if da.Status == "failed" && da.AttemptNumber >= 3 {
		status = "failed"
	}

	if err := s.pg.UpdateNotificationStatus(ctx, da.NotificationID.String(), status,
		func() *time.Time {
			if da.DeliveredAt != nil { return da.DeliveredAt }
			return nil
		}(),
		func() *time.Time {
			if da.Status == "failed" { t := time.Now(); return &t }
			return nil
		}(),
		da.Error); err != nil {
		s.log.Warn("Failed to update notification status", zap.Error(err))
	}

	return s.pg.CreateDeliveryAttempt(ctx, da)
}

func (s *NotificationService) RetryNotification(ctx context.Context, notificationID string) error {
	n, err := s.pg.GetNotification(ctx, notificationID)
	if err != nil {
		return fmt.Errorf("notification not found: %w", err)
	}

	if n.Attempts >= n.MaxAttempts {
		return fmt.Errorf("max retry attempts reached (%d)", n.MaxAttempts)
	}

	if err := s.pg.IncrementAttempts(ctx, notificationID); err != nil {
		return err
	}

	// Get retry delay
	delay := s.rdb.GetRetryDelay(n.Attempts, s.cfg.RetryInitialDelay, s.cfg.RetryBackoffFactor)
	s.log.Info("Scheduling retry",
		zap.String("notification", n.NotificationID),
		zap.Int("attempt", n.Attempts),
		zap.Duration("delay", delay))

	// In production, would use a message queue with delayed delivery
	return nil
}

// --- Stats & Reporting ---

func (s *NotificationService) GetDeliveryStats(ctx context.Context) ([]models.DeliveryStats, error) {
	statusCounts, err := s.pg.CountNotificationsByStatus(ctx)
	if err != nil {
		return nil, err
	}

	channels := []string{"sms", "email", "push", "whatsapp", "ussd", "in_app"}
	stats := make([]models.DeliveryStats, 0, len(channels))

	for _, ch := range channels {
		// In production, query per-channel counts from DB
		s := models.DeliveryStats{Channel: ch}
		s.Sent = int(statusCounts["sent"]) + int(statusCounts["delivered"])
		s.Delivered = int(statusCounts["delivered"])
		s.Failed = int(statusCounts["failed"])
		s.Retrying = int(statusCounts["retrying"])
		if s.Sent > 0 {
			s.SuccessRate = float64(s.Delivered) / float64(s.Sent) * 100
		}
		stats = append(stats, s)
	}
	return stats, nil
}

func (s *NotificationService) GetDeliveryStatsDaily(ctx context.Context, date string) ([]models.DeliveryStatsDaily, error) {
	return s.pg.GetDailyStats(ctx, date)
}

func (s *NotificationService) GetDashboard(ctx context.Context) (*models.NotificationDashboard, error) {
	if cached, err := s.rdb.GetCachedDashboard(ctx); err == nil && cached != nil {
		return cached, nil
	}

	statusCounts, err := s.pg.CountNotificationsByStatus(ctx)
	if err != nil {
		return nil, err
	}

	dash := &models.NotificationDashboard{
		TotalSent:     statusCounts["sent"],
		TotalDelivered: statusCounts["delivered"],
		TotalFailed:   statusCounts["failed"],
		TotalQueued:   statusCounts["queued"],
		TotalRetrying: statusCounts["retrying"],
	}

	total := dash.TotalSent + dash.TotalFailed
	if total > 0 {
		dash.OverallRate = float64(dash.TotalDelivered) / float64(total) * 100
	}

	channels, _ := s.GetDeliveryStats(ctx)
	dash.ByChannel = channels

	s.rdb.CacheDashboard(ctx, dash)
	return dash, nil
}

// --- Customer Preferences ---

func (s *NotificationService) GetCustomerPreference(ctx context.Context, customerID string) (*models.CustomerPreference, error) {
	return s.pg.GetCustomerPreference(ctx, customerID)
}

func (s *NotificationService) UpdateCustomerPreference(ctx context.Context, pref *models.CustomerPreference) error {
	if pref.CustomerID == "" {
		return fmt.Errorf("customer_id is required")
	}
	return s.pg.UpsertCustomerPreference(ctx, pref)
}

func (s *NotificationService) GetNotificationsByCustomer(ctx context.Context, customerID, status string, limit int) ([]models.Notification, error) {
	return s.pg.GetNotificationsByCustomer(ctx, customerID, status, limit)
}
