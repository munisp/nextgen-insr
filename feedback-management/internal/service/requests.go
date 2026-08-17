package service

import (
	"github.com/munisp/NGApp/feedback-management/internal/models"

	"github.com/google/uuid"
)

type SubmitFeedbackRequest struct {
	CustomerID   string                 `json:"customer_id"`
	CustomerName string                 `json:"customer_name"`
	Channel      string                 `json:"channel"`
	Category     string                 `json:"category"`
	SubCategory  string                 `json:"sub_category"`
	Type         string                 `json:"type"`
	Subject      string                 `json:"subject"`
	Description  string                 `json:"description"`
	Rating       int                    `json:"rating"`
	Module       string                 `json:"module"`
	PolicyNumber string                 `json:"policy_number"`
	Metadata     map[string]interface{} `json:"metadata"`
}

type RespondRequest struct {
	ResponderID   string `json:"responder_id"`
	ResponderName string `json:"responder_name"`
	Message       string `json:"message"`
	IsInternal    bool   `json:"is_internal"`
}

type CreateSurveyRequest struct {
	Name         string                  `json:"name"`
	Description  string                  `json:"description"`
	TriggerEvent string                  `json:"trigger_event"`
	Questions    []models.SurveyQuestion `json:"questions"`
}

type SurveyResponseRequest struct {
	SurveyID      uuid.UUID              `json:"survey_id"`
	CustomerID    string                 `json:"customer_id"`
	PolicyNumber  string                 `json:"policy_number"`
	Answers       map[string]interface{} `json:"answers"`
	NPSScore      int                    `json:"nps_score"`
	OverallRating int                    `json:"overall_rating"`
}
