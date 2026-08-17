package models

import (
	"time"

	"github.com/google/uuid"
)

type FeedbackSubmission struct {
	ID             uuid.UUID              `json:"id" gorm:"type:uuid;primaryKey"`
	FeedbackRef    string                 `json:"feedback_ref" gorm:"uniqueIndex;not null"`
	CustomerID     string                 `json:"customer_id" gorm:"index"`
	CustomerName   string                 `json:"customer_name"`
	Channel        string                 `json:"channel"`               // web, mobile, email, phone, agent, sms
	Category       string                 `json:"category" gorm:"index"` // service, product, claims, billing, general
	SubCategory    string                 `json:"sub_category"`
	Type           string                 `json:"type"` // complaint, suggestion, compliment, inquiry
	Subject        string                 `json:"subject"`
	Description    string                 `json:"description"`
	Rating         int                    `json:"rating"`    // 1-5 NPS-style
	Sentiment      string                 `json:"sentiment"` // positive, negative, neutral
	SentimentScore float64                `json:"sentiment_score"`
	Module         string                 `json:"module"` // which platform module
	PolicyNumber   string                 `json:"policy_number"`
	Priority       string                 `json:"priority" gorm:"default:'medium'"` // low, medium, high, urgent
	Status         string                 `json:"status" gorm:"default:'open'"`     // open, in_progress, resolved, closed, escalated
	AssignedTo     string                 `json:"assigned_to"`
	Resolution     string                 `json:"resolution"`
	ResolvedAt     *time.Time             `json:"resolved_at"`
	Metadata       map[string]interface{} `json:"metadata" gorm:"serializer:json"`
	CreatedAt      time.Time              `json:"created_at"`
	UpdatedAt      time.Time              `json:"updated_at"`
}

type FeedbackResponse struct {
	ID            uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	FeedbackID    uuid.UUID `json:"feedback_id" gorm:"type:uuid;index;not null"`
	ResponderID   string    `json:"responder_id"`
	ResponderName string    `json:"responder_name"`
	Message       string    `json:"message"`
	IsInternal    bool      `json:"is_internal" gorm:"default:false"`
	CreatedAt     time.Time `json:"created_at"`
}

type SurveyTemplate struct {
	ID           uuid.UUID        `json:"id" gorm:"type:uuid;primaryKey"`
	Name         string           `json:"name" gorm:"uniqueIndex;not null"`
	Description  string           `json:"description"`
	TriggerEvent string           `json:"trigger_event"` // policy_purchase, claim_settlement, renewal, service_call
	Questions    []SurveyQuestion `json:"questions" gorm:"serializer:json"`
	IsActive     bool             `json:"is_active" gorm:"default:true"`
	CreatedAt    time.Time        `json:"created_at"`
}

type SurveyQuestion struct {
	ID       string   `json:"id"`
	Text     string   `json:"text"`
	Type     string   `json:"type"` // rating, text, multiple_choice, yes_no
	Options  []string `json:"options,omitempty"`
	Required bool     `json:"required"`
}

type SurveyResponse struct {
	ID            uuid.UUID              `json:"id" gorm:"type:uuid;primaryKey"`
	SurveyID      uuid.UUID              `json:"survey_id" gorm:"type:uuid;index"`
	CustomerID    string                 `json:"customer_id" gorm:"index"`
	PolicyNumber  string                 `json:"policy_number"`
	Answers       map[string]interface{} `json:"answers" gorm:"serializer:json"`
	NPSScore      int                    `json:"nps_score"`      // 0-10
	OverallRating int                    `json:"overall_rating"` // 1-5
	CompletedAt   time.Time              `json:"completed_at"`
	CreatedAt     time.Time              `json:"created_at"`
}

type FeedbackAnalytics struct {
	ID                 uuid.UUID      `json:"id" gorm:"type:uuid;primaryKey"`
	Period             string         `json:"period"`
	TotalFeedback      int            `json:"total_feedback"`
	AvgRating          float64        `json:"avg_rating"`
	NPSScore           float64        `json:"nps_score"`
	SentimentBreakdown map[string]int `json:"sentiment_breakdown" gorm:"serializer:json"`
	CategoryBreakdown  map[string]int `json:"category_breakdown" gorm:"serializer:json"`
	ResolutionTime     float64        `json:"avg_resolution_hours"`
	SatisfactionRate   float64        `json:"satisfaction_rate"`
	CreatedAt          time.Time      `json:"created_at"`
}
