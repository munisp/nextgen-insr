package models

import (
	"time"
)

// NotificationChannel represents available notification channels
type NotificationChannel string

const (
	ChannelSMS      NotificationChannel = "sms"
	ChannelEmail    NotificationChannel = "email"
	ChannelPush     NotificationChannel = "push"
	ChannelWhatsApp NotificationChannel = "whatsapp"
	ChannelUSSD     NotificationChannel = "ussd"
	ChannelInApp    NotificationChannel = "in_app"
)

// Priority levels
type NotificationPriority int

const (
	Prio1Critical NotificationPriority = 1
	Prio2High     NotificationPriority = 2
	Prio3Normal   NotificationPriority = 3
	Prio4Low      NotificationPriority = 4
)

// Notification represents a notification request
type Notification struct {
	ID                string               `json:"id" db:"id"`
	NotificationID    string               `json:"notification_id" db:"notification_id"`
	Channel           NotificationChannel  `json:"channel" db:"channel"`
	To                string               `json:"to" db:"to"` // phone, email, device_token
	From              string               `json:"from" db:"from"`
	TemplateName      string               `json:"template_name" db:"template_name"`
	TemplateData      string               `json:"template_data" db:"template_data"` // JSON payload for template variables
	Message           string               `json:"message" db:"message"`
	Subject           string               `json:"subject" db:"subject"` // for email
	Priority          NotificationPriority `json:"priority" db:"priority"`
	Status            string               `json:"status" db:"status"` // queued, sent, delivered, failed, retrying, expired
	Attempts          int                  `json:"attempts" db:"attempts"`
	MaxAttempts       int                  `json:"max_attempts" db:"max_attempts"`
	DeliveredAt       *time.Time           `json:"delivered_at" db:"delivered_at"`
	FailedAt          *time.Time           `json:"failed_at" db:"failed_at"`
	LastError         string               `json:"last_error" db:"last_error"`
	CallbackURL       string               `json:"callback_url" db:"callback_url"`
	ExternalID        string               `json:"external_id" db:"external_id"`                 // third-party provider ID
	RelatedEntityType string               `json:"related_entity_type" db:"related_entity_type"` // policy, claim, payment
	RelatedEntityID   string               `json:"related_entity_id" db:"related_entity_id"`
	CustomerID        string               `json:"customer_id" db:"customer_id"`
	QueuedAt          time.Time            `json:"queued_at" db:"queued_at"`
	SentAt            *time.Time           `json:"sent_at" db:"sent_at"`
	CreatedAt         time.Time            `json:"created_at" db:"created_at"`
}

// NotificationTemplate represents a reusable notification template
type NotificationTemplate struct {
	ID               string    `json:"id" db:"id"`
	TemplateCode     string    `json:"template_code" db:"template_code"`
	Name             string    `json:"name" db:"name"`
	Description      string    `json:"description" db:"description"`
	Channels         string    `json:"channels" db:"channels"` // comma-separated: sms,email,push
	ChannelSMS       string    `json:"channel_sms" db:"channel_sms"`
	ChannelEmail     string    `json:"channel_email" db:"channel_email"`
	ChannelPush      string    `json:"channel_push" db:"channel_push"`
	ChannelWhatsApp  string    `json:"channel_whatsapp" db:"channel_whatsapp"`
	ChannelUSSD      string    `json:"channel_ussd" db:"channel_ussd"`
	Variables        string    `json:"variables" db:"variables"` // JSON array: ["name","policy_number"]
	IsActive         bool      `json:"is_active" db:"is_active"`
	IsNAICOMApproved bool      `json:"is_naicom_approved" db:"is_naicom_approved"`
	CreatedBy        string    `json:"created_by" db:"created_by"`
	CreatedAt        time.Time `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time `json:"updated_at" db:"updated_at"`
}

// DeliveryAttempt records each delivery attempt
type DeliveryAttempt struct {
	ID             string     `json:"id" db:"id"`
	NotificationID string     `json:"notification_id" db:"notification_id"`
	Channel        string     `json:"channel" db:"channel"`
	AttemptNumber  int        `json:"attempt_number" db:"attempt_number"`
	Status         string     `json:"status" db:"status"` // sent, delivered, failed
	ExternalID     string     `json:"external_id" db:"external_id"`
	Error          string     `json:"error" db:"error"`
	SentAt         *time.Time `json:"sent_at" db:"sent_at"`
	DeliveredAt    *time.Time `json:"delivered_at" db:"delivered_at"`
	ResponseTimeMs int        `json:"response_time_ms" db:"response_time_ms"`
	CreatedAt      time.Time  `json:"created_at" db:"created_at"`
}

// DeliveryStats provides per-channel delivery statistics
type DeliveryStats struct {
	Channel     string  `json:"channel"`
	Sent        int     `json:"sent"`
	Delivered   int     `json:"delivered"`
	Failed      int     `json:"failed"`
	Retrying    int     `json:"retrying"`
	Expired     int     `json:"expired"`
	SuccessRate float64 `json:"success_rate"`
}

// DeliveryStatsDaily provides daily aggregated stats
type DeliveryStatsDaily struct {
	Date        string  `json:"date"`
	Channel     string  `json:"channel"`
	Sent        int     `json:"sent"`
	Delivered   int     `json:"delivered"`
	Failed      int     `json:"failed"`
	Pending     int     `json:"pending"`
	SuccessRate float64 `json:"success_rate"`
}

// RateLimitStatus tracks per-customer rate limits
type RateLimitStatus struct {
	CustomerID  string    `json:"customer_id" db:"customer_id"`
	Channel     string    `json:"channel" db:"channel"`
	Limit       int       `json:"limit" db:"limit"`
	Used        int       `json:"used" db:"used"`
	PeriodStart time.Time `json:"period_start" db:"period_start"`
	PeriodEnd   time.Time `json:"period_end" db:"period_end"`
}

// NotificationDashboard provides the consolidated view
type NotificationDashboard struct {
	TotalSent      int64                `json:"total_sent"`
	TotalDelivered int64                `json:"total_delivered"`
	TotalFailed    int64                `json:"total_failed"`
	TotalQueued    int64                `json:"total_queued"`
	TotalRetrying  int64                `json:"total_retrying"`
	OverallRate    float64              `json:"overall_rate"`
	ByChannel      []DeliveryStats      `json:"by_channel"`
	TodayStats     []DeliveryStatsDaily `json:"today_stats"`
}

// CustomerPreference stores notification preferences
type CustomerPreference struct {
	ID               string    `json:"id" db:"id"`
	CustomerID       string    `json:"customer_id" db:"customer_id"`
	ChannelSMS       bool      `json:"channel_sms" db:"channel_sms"`
	ChannelEmail     bool      `json:"channel_email" db:"channel_email"`
	ChannelPush      bool      `json:"channel_push" db:"channel_push"`
	ChannelWhatsApp  bool      `json:"channel_whatsapp" db:"channel_whatsapp"`
	ChannelUSSD      bool      `json:"channel_ussd" db:"channel_ussd"`
	PreferredChannel string    `json:"preferred_channel" db:"preferred_channel"`
	QuietHours       string    `json:"quiet_hours" db:"quiet_hours"` // "22:00-07:00"
	IsOptedOut       bool      `json:"is_opted_out" db:"is_opted_out"`
	UpdatedAt        time.Time `json:"updated_at" db:"updated_at"`
}
