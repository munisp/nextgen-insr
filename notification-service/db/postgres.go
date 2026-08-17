package db

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/insureportal/notification_service/config"
	"github.com/insureportal/notification_service/models"
	"go.uber.org/zap"
)

type PostgreSQL struct {
	db *sql.DB
}

func NewPostgreSQL(cfg *config.Config) (*PostgreSQL, error) {
	db, err := sql.Open("postgres", cfg.DSN())
	if err != nil {
		return nil, fmt.Errorf("postgres connect: %w", err)
	}
	db.SetMaxOpenConns(cfg.DBMaxConns)
	db.SetMaxIdleConns(cfg.DBMinConns)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("postgres ping: %w", err)
	}
	zap.L().Info("PostgreSQL connected", zap.String("host", cfg.DBHost), zap.Int("port", cfg.DBPort))
	pg := &PostgreSQL{db: db}
	if err := pg.Migrate(context.Background()); err != nil {
		return nil, fmt.Errorf("migration: %w", err)
	}
	return pg, nil
}

func (p *PostgreSQL) Close() error { return p.db.Close() }

func (p *PostgreSQL) Migrate(ctx context.Context) error {
	tables := []string{
		`CREATE TABLE IF NOT EXISTS notifications (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			notification_id VARCHAR(50) UNIQUE NOT NULL,
			channel VARCHAR(20) NOT NULL,
			to VARCHAR(255) NOT NULL,
			from VARCHAR(255),
			template_name VARCHAR(100),
			template_data TEXT,
			message TEXT,
			subject VARCHAR(500),
			priority INTEGER DEFAULT 3,
			status VARCHAR(30) DEFAULT 'queued',
			attempts INTEGER DEFAULT 0,
			max_attempts INTEGER DEFAULT 3,
			delivered_at TIMESTAMP WITH TIME ZONE,
			failed_at TIMESTAMP WITH TIME ZONE,
			last_error TEXT,
			callback_url TEXT,
			external_id VARCHAR(255),
			related_entity_type VARCHAR(50),
			related_entity_id VARCHAR(255),
			customer_id VARCHAR(255),
			queued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			sent_at TIMESTAMP WITH TIME ZONE,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_notifications_channel ON notifications(channel)`,
		`CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status)`,
		`CREATE INDEX IF NOT EXISTS idx_notifications_customer ON notifications(customer_id)`,
		`CREATE INDEX IF NOT EXISTS idx_notifications_related ON notifications(related_entity_type, related_entity_id)`,

		`CREATE TABLE IF NOT EXISTS notification_templates (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			template_code VARCHAR(50) UNIQUE NOT NULL,
			name VARCHAR(255) NOT NULL,
			description TEXT,
			channels VARCHAR(100),
			channel_sms TEXT,
			channel_email TEXT,
			channel_push TEXT,
			channel_whatsapp TEXT,
			channel_ussd TEXT,
			variables TEXT,
			is_active BOOLEAN DEFAULT TRUE,
			is_naicom_approved BOOLEAN DEFAULT FALSE,
			created_by VARCHAR(255),
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_templates_code ON notification_templates(template_code)`,
		`CREATE INDEX IF NOT EXISTS idx_templates_active ON notification_templates(is_active)`,

		`CREATE TABLE IF NOT EXISTS delivery_attempts (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			notification_id UUID NOT NULL REFERENCES notifications(id),
			channel VARCHAR(20) NOT NULL,
			attempt_number INTEGER NOT NULL,
			status VARCHAR(20) DEFAULT 'sent',
			external_id VARCHAR(255),
			error TEXT,
			sent_at TIMESTAMP WITH TIME ZONE,
			delivered_at TIMESTAMP WITH TIME ZONE,
			response_time_ms INTEGER,
			created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_attempts_notification ON delivery_attempts(notification_id)`,
		`CREATE INDEX IF NOT EXISTS idx_attempts_status ON delivery_attempts(status)`,

		`CREATE TABLE IF NOT EXISTS delivery_stats_daily (
			id BIGSERIAL PRIMARY KEY,
			date DATE NOT NULL,
			channel VARCHAR(20) NOT NULL,
			sent INTEGER DEFAULT 0,
			delivered INTEGER DEFAULT 0,
			failed INTEGER DEFAULT 0,
			pending INTEGER DEFAULT 0,
			UNIQUE(date, channel)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_stats_date ON delivery_stats_daily(date)`,

		`CREATE TABLE IF NOT EXISTS customer_preferences (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			customer_id VARCHAR(255) UNIQUE NOT NULL,
			channel_sms BOOLEAN DEFAULT TRUE,
			channel_email BOOLEAN DEFAULT TRUE,
			channel_push BOOLEAN DEFAULT TRUE,
			channel_whatsapp BOOLEAN DEFAULT FALSE,
			channel_ussd BOOLEAN DEFAULT FALSE,
			preferred_channel VARCHAR(20) DEFAULT 'sms',
			quiet_hours VARCHAR(30) DEFAULT '22:00-07:00',
			is_opted_out BOOLEAN DEFAULT FALSE,
			updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_prefs_customer ON customer_preferences(customer_id)`,
	}

	for _, q := range tables {
		if _, err := p.db.ExecContext(ctx, q); err != nil {
			return fmt.Errorf("migrate '%s...': %w", q[:50], err)
		}
	}
	zap.L().Info("Notification service migrations completed")
	return nil
}

// --- Notification CRUD ---
func (p *PostgreSQL) CreateNotification(ctx context.Context, n *models.Notification) error {
	n.ID = uuid.New().String()
	n.NotificationID = "NTF-" + time.Now().Format("20060102150405") + "-" + uuid.New().String()[:6]
	n.QueuedAt = time.Now()
	n.CreatedAt = time.Now()
	n.Status = "queued"
	n.MaxAttempts = 3
	query := `INSERT INTO notifications (id,notification_id,channel,to,from,template_name,
		template_data,message,subject,priority,status,attempts,max_attempts,callback_url,
		external_id,related_entity_type,related_entity_id,customer_id,queued_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`
	_, err := p.db.ExecContext(ctx, query, n.ID, n.NotificationID, string(n.Channel), n.To,
		n.From, n.TemplateName, n.TemplateData, n.Message, n.Subject, n.Priority,
		n.Status, n.Attempts, n.MaxAttempts, n.CallbackURL, n.ExternalID,
		n.RelatedEntityType, n.RelatedEntityID, n.CustomerID, n.QueuedAt)
	return err
}

func (p *PostgreSQL) GetNotification(ctx context.Context, id string) (*models.Notification, error) {
	var n models.Notification
	q := `SELECT id,notification_id,channel,to,from,template_name,template_data,message,
		subject,priority,status,attempts,max_attempts,delivered_at,failed_at,last_error,
		callback_url,external_id,related_entity_type,related_entity_id,customer_id,
		queued_at,sent_at,created_at FROM notifications WHERE id=$1`
	err := p.db.QueryRowContext(ctx, q, id).Scan(
		&n.ID, &n.NotificationID, &n.Channel, &n.To, &n.From, &n.TemplateName, &n.TemplateData,
		&n.Message, &n.Subject, &n.Priority, &n.Status, &n.Attempts, &n.MaxAttempts,
		&n.DeliveredAt, &n.FailedAt, &n.LastError, &n.CallbackURL, &n.ExternalID,
		&n.RelatedEntityType, &n.RelatedEntityID, &n.CustomerID, &n.QueuedAt, &n.SentAt, &n.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &n, nil
}

func (p *PostgreSQL) UpdateNotificationStatus(ctx context.Context, id string, status string, deliveredAt, failedAt *time.Time, lastError string) error {
	_, err := p.db.ExecContext(ctx,
		`UPDATE notifications SET status=$1, delivered_at=$2, failed_at=$3, last_error=$4,
		 sent_at=CASE WHEN $1='sent' AND sent_at IS NULL THEN NOW() ELSE sent_at END,
		 delivered_at=CASE WHEN $1='delivered' AND delivered_at IS NULL THEN NOW() ELSE delivered_at END
		 WHERE id=$5`, status, deliveredAt, failedAt, lastError, id)
	return err
}

func (p *PostgreSQL) IncrementAttempts(ctx context.Context, id string) error {
	_, err := p.db.ExecContext(ctx,
		`UPDATE notifications SET attempts = attempts + 1, status = 'retrying' WHERE id=$1`, id)
	return err
}

func (p *PostgreSQL) GetQueuedNotifications(ctx context.Context, channel string, limit int) ([]models.Notification, error) {
	query := `SELECT id,notification_id,channel,to,from,template_name,template_data,message,
		subject,priority,status,attempts,max_attempts,delivered_at,failed_at,last_error,
		callback_url,external_id,related_entity_type,related_entity_id,customer_id,
		queued_at,sent_at,created_at FROM notifications WHERE status='queued'`
	args := []interface{}{}
	pos := 1
	if channel != "" {
		query += fmt.Sprintf(" AND channel=$%d", pos)
		args = append(args, channel)
		pos++
	}
	query += " ORDER BY priority ASC, queued_at ASC"
	if limit > 0 {
		query += fmt.Sprintf(" LIMIT $%d", pos)
		args = append(args, limit)
	}

	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanNotifications(rows)
}

func (p *PostgreSQL) GetNotificationsByCustomer(ctx context.Context, customerID, status string, limit int) ([]models.Notification, error) {
	query := `SELECT id,notification_id,channel,to,from,template_name,template_data,message,
		subject,priority,status,attempts,max_attempts,delivered_at,failed_at,last_error,
		callback_url,external_id,related_entity_type,related_entity_id,customer_id,
		queued_at,sent_at,created_at FROM notifications WHERE customer_id=$1`
	args := []interface{}{customerID}
	pos := 2
	if status != "" {
		query += fmt.Sprintf(" AND status=$%d", pos)
		args = append(args, status)
		pos++
	}
	query += " ORDER BY created_at DESC"
	if limit > 0 {
		query += fmt.Sprintf(" LIMIT $%d", pos)
		args = append(args, limit)
	}

	rows, err := p.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanNotifications(rows)
}

func (p *PostgreSQL) CountNotificationsByStatus(ctx context.Context) (map[string]int64, error) {
	rows, err := p.db.QueryContext(ctx, `SELECT status, COUNT(*) FROM notifications GROUP BY status`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]int64)
	for rows.Next() {
		var status string
		var count int64
		if err := rows.Scan(&status, &count); err != nil {
			return nil, err
		}
		result[status] = count
	}
	return result, nil
}

// --- Templates ---
func (p *PostgreSQL) CreateTemplate(ctx context.Context, t *models.NotificationTemplate) error {
	t.ID = uuid.New().String()
	t.CreatedAt = time.Now()
	t.UpdatedAt = time.Now()
	query := `INSERT INTO notification_templates (id,template_code,name,description,channels,
		channel_sms,channel_email,channel_push,channel_whatsapp,channel_ussd,variables,
		is_active,is_naicom_approved,created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`
	_, err := p.db.ExecContext(ctx, query, t.ID, t.TemplateCode, t.Name, t.Description,
		t.Channels, t.ChannelSMS, t.ChannelEmail, t.ChannelPush, t.ChannelWhatsApp,
		t.ChannelUSSD, t.Variables, t.IsActive, t.IsNAICOMApproved, t.CreatedBy)
	return err
}

func (p *PostgreSQL) GetTemplate(ctx context.Context, code string) (*models.NotificationTemplate, error) {
	var t models.NotificationTemplate
	q := `SELECT id,template_code,name,description,channels,channel_sms,channel_email,
		channel_push,channel_whatsapp,channel_ussd,variables,is_active,is_naicom_approved,
		created_by,created_at,updated_at FROM notification_templates WHERE template_code=$1`
	err := p.db.QueryRowContext(ctx, q, code).Scan(
		&t.ID, &t.TemplateCode, &t.Name, &t.Description, &t.Channels, &t.ChannelSMS,
		&t.ChannelEmail, &t.ChannelPush, &t.ChannelWhatsApp, &t.ChannelUSSD, &t.Variables,
		&t.IsActive, &t.IsNAICOMApproved, &t.CreatedBy, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (p *PostgreSQL) ListTemplates(ctx context.Context, isActive bool) ([]models.NotificationTemplate, error) {
	query := `SELECT id,template_code,name,description,channels,channel_sms,channel_email,
		channel_push,channel_whatsapp,channel_ussd,variables,is_active,is_naicom_approved,
		created_by,created_at,updated_at FROM notification_templates`
	if !isActive {
		query += " WHERE is_active=true"
	}
	query += " ORDER BY name"
	rows, err := p.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTemplates(rows)
}

// --- Delivery Attempts ---
func (p *PostgreSQL) CreateDeliveryAttempt(ctx context.Context, da *models.DeliveryAttempt) error {
	da.ID = uuid.New().String()
	da.CreatedAt = time.Now()
	query := `INSERT INTO delivery_attempts (id,notification_id,channel,attempt_number,
		status,external_id,error,sent_at,delivered_at,response_time_ms)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`
	_, err := p.db.ExecContext(ctx, query, da.ID, da.NotificationID, da.Channel, da.AttemptNumber,
		da.Status, da.ExternalID, da.Error, da.SentAt, da.DeliveredAt, da.ResponseTimeMs)
	return err
}

func (p *PostgreSQL) GetDeliveryAttempts(ctx context.Context, notificationID string) ([]models.DeliveryAttempt, error) {
	rows, err := p.db.QueryContext(ctx,
		`SELECT id,notification_id,channel,attempt_number,status,external_id,error,
			sent_at,delivered_at,response_time_ms,created_at FROM delivery_attempts
		 WHERE notification_id=$1 ORDER BY attempt_number ASC`, notificationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var attempts []models.DeliveryAttempt
	for rows.Next() {
		var da models.DeliveryAttempt
		err := rows.Scan(&da.ID, &da.NotificationID, &da.Channel, &da.AttemptNumber,
			&da.Status, &da.ExternalID, &da.Error, &da.SentAt, &da.DeliveredAt,
			&da.ResponseTimeMs, &da.CreatedAt)
		if err != nil {
			return nil, err
		}
		attempts = append(attempts, da)
	}
	return attempts, nil
}

// --- Delivery Stats ---
func (p *PostgreSQL) RecordDailyStats(ctx context.Context, stats *models.DeliveryStatsDaily) error {
	query := `INSERT INTO delivery_stats_daily (date,channel,sent,delivered,failed,pending)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (date, channel) DO UPDATE SET
			sent=EXCLUDED.sent, delivered=EXCLUDED.delivered,
			failed=EXCLUDED.failed, pending=EXCLUDED.pending`
	_, err := p.db.ExecContext(ctx, query, stats.Date, stats.Channel, stats.Sent,
		stats.Delivered, stats.Failed, stats.Pending)
	return err
}

func (p *PostgreSQL) GetDailyStats(ctx context.Context, date string) ([]models.DeliveryStatsDaily, error) {
	rows, err := p.db.QueryContext(ctx,
		`SELECT date,channel,sent,delivered,failed,pending FROM delivery_stats_daily WHERE date=$1`, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var stats []models.DeliveryStatsDaily
	for rows.Next() {
		var s models.DeliveryStatsDaily
		err := rows.Scan(&s.Date, &s.Channel, &s.Sent, &s.Delivered, &s.Failed, &s.Pending)
		if err != nil {
			return nil, err
		}
		stats = append(stats, s)
	}
	return stats, nil
}

// --- Customer Preferences ---
func (p *PostgreSQL) UpsertCustomerPreference(ctx context.Context, pref *models.CustomerPreference) error {
	pref.UpdatedAt = time.Now()
	query := `INSERT INTO customer_preferences (customer_id,channel_sms,channel_email,channel_push,
		channel_whatsapp,channel_ussd,preferred_channel,quiet_hours,is_opted_out,updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (customer_id) DO UPDATE SET
			channel_sms=EXCLUDED.channel_sms,channel_email=EXCLUDED.channel_email,
			channel_push=EXCLUDED.channel_push,channel_whatsapp=EXCLUDED.channel_whatsapp,
			channel_ussd=EXCLUDED.channel_ussd,preferred_channel=EXCLUDED.preferred_channel,
			quiet_hours=EXCLUDED.quiet_hours,is_opted_out=EXCLUDED.is_opted_out,
			updated_at=NOW()`
	_, err := p.db.ExecContext(ctx, query, pref.CustomerID, pref.ChannelSMS, pref.ChannelEmail,
		pref.ChannelPush, pref.ChannelWhatsApp, pref.ChannelUSSD, pref.PreferredChannel,
		pref.QuietHours, pref.IsOptedOut, pref.UpdatedAt)
	return err
}

func (p *PostgreSQL) GetCustomerPreference(ctx context.Context, customerID string) (*models.CustomerPreference, error) {
	var pref models.CustomerPreference
	q := `SELECT id,customer_id,channel_sms,channel_email,channel_push,channel_whatsapp,
		channel_ussd,preferred_channel,quiet_hours,is_opted_out,updated_at
		FROM customer_preferences WHERE customer_id=$1`
	err := p.db.QueryRowContext(ctx, q, customerID).Scan(
		&pref.ID, &pref.CustomerID, &pref.ChannelSMS, &pref.ChannelEmail, &pref.ChannelPush,
		&pref.ChannelWhatsApp, &pref.ChannelUSSD, &pref.PreferredChannel, &pref.QuietHours,
		&pref.IsOptedOut, &pref.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &pref, nil
}

// --- Helpers ---
func scanNotifications(rows *sql.Rows) ([]models.Notification, error) {
	var ns []models.Notification
	for rows.Next() {
		var n models.Notification
		err := rows.Scan(&n.ID, &n.NotificationID, &n.Channel, &n.To, &n.From, &n.TemplateName,
			&n.TemplateData, &n.Message, &n.Subject, &n.Priority, &n.Status, &n.Attempts,
			&n.MaxAttempts, &n.DeliveredAt, &n.FailedAt, &n.LastError, &n.CallbackURL,
			&n.ExternalID, &n.RelatedEntityType, &n.RelatedEntityID, &n.CustomerID,
			&n.QueuedAt, &n.SentAt, &n.CreatedAt)
		if err != nil {
			return nil, err
		}
		ns = append(ns, n)
	}
	return ns, nil
}

func scanTemplates(rows *sql.Rows) ([]models.NotificationTemplate, error) {
	var ts []models.NotificationTemplate
	for rows.Next() {
		var t models.NotificationTemplate
		err := rows.Scan(&t.ID, &t.TemplateCode, &t.Name, &t.Description, &t.Channels,
			&t.ChannelSMS, &t.ChannelEmail, &t.ChannelPush, &t.ChannelWhatsApp,
			&t.ChannelUSSD, &t.Variables, &t.IsActive, &t.IsNAICOMApproved, &t.CreatedBy,
			&t.CreatedAt, &t.UpdatedAt)
		if err != nil {
			return nil, err
		}
		ts = append(ts, t)
	}
	return ts, nil
}
