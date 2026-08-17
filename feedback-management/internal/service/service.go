package service

import (
	"context"
	"fmt"
	"github.com/munisp/NGApp/feedback-management/internal/models"
	"github.com/munisp/NGApp/feedback-management/internal/repository"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
)

type FeedbackService struct {
	repo *repository.FeedbackRepository
}

func NewFeedbackService(repo *repository.FeedbackRepository) *FeedbackService {
	return &FeedbackService{repo: repo}
}

func (s *FeedbackService) SubmitFeedback(ctx context.Context, req SubmitFeedbackRequest) (*models.FeedbackSubmission, error) {
	sentiment, score := analyzeSentiment(req.Description, req.Rating)
	priority := assessPriority(req.Type, req.Rating, sentiment)
	feedback := &models.FeedbackSubmission{
		FeedbackRef: fmt.Sprintf("FB-%d", time.Now().UnixNano()%1000000),
		CustomerID:  req.CustomerID, CustomerName: req.CustomerName, Channel: req.Channel,
		Category: req.Category, SubCategory: req.SubCategory, Type: req.Type,
		Subject: req.Subject, Description: req.Description, Rating: req.Rating,
		Sentiment: sentiment, SentimentScore: score, Module: req.Module,
		PolicyNumber: req.PolicyNumber, Priority: priority, Status: "open",
		Metadata: req.Metadata,
	}
	if err := s.repo.CreateFeedback(ctx, feedback); err != nil {
		return nil, fmt.Errorf("failed to submit feedback: %w", err)
	}
	return feedback, nil
}

func (s *FeedbackService) RespondToFeedback(ctx context.Context, feedbackID uuid.UUID, req RespondRequest) (*models.FeedbackResponse, error) {
	feedback, err := s.repo.GetFeedback(ctx, feedbackID)
	if err != nil {
		return nil, fmt.Errorf("feedback not found")
	}
	resp := &models.FeedbackResponse{
		FeedbackID: feedbackID, ResponderID: req.ResponderID,
		ResponderName: req.ResponderName, Message: req.Message, IsInternal: req.IsInternal,
	}
	if err := s.repo.CreateResponse(ctx, resp); err != nil {
		return nil, fmt.Errorf("failed to create response: %w", err)
	}
	if feedback.Status == "open" {
		feedback.Status = "in_progress"
		s.repo.UpdateFeedback(ctx, feedback)
	}
	return resp, nil
}

func (s *FeedbackService) ResolveFeedback(ctx context.Context, feedbackID uuid.UUID, resolution string) error {
	feedback, err := s.repo.GetFeedback(ctx, feedbackID)
	if err != nil {
		return fmt.Errorf("feedback not found")
	}
	now := time.Now()
	feedback.Status = "resolved"
	feedback.Resolution = resolution
	feedback.ResolvedAt = &now
	return s.repo.UpdateFeedback(ctx, feedback)
}

func (s *FeedbackService) EscalateFeedback(ctx context.Context, feedbackID uuid.UUID, assignTo string) error {
	feedback, err := s.repo.GetFeedback(ctx, feedbackID)
	if err != nil {
		return fmt.Errorf("feedback not found")
	}
	feedback.Status = "escalated"
	feedback.Priority = "urgent"
	feedback.AssignedTo = assignTo
	return s.repo.UpdateFeedback(ctx, feedback)
}

func (s *FeedbackService) CreateSurvey(ctx context.Context, req CreateSurveyRequest) (*models.SurveyTemplate, error) {
	survey := &models.SurveyTemplate{
		Name: req.Name, Description: req.Description, TriggerEvent: req.TriggerEvent,
		Questions: req.Questions, IsActive: true,
	}
	if err := s.repo.CreateSurvey(ctx, survey); err != nil {
		return nil, fmt.Errorf("failed to create survey: %w", err)
	}
	return survey, nil
}

func (s *FeedbackService) SubmitSurveyResponse(ctx context.Context, req SurveyResponseRequest) (*models.SurveyResponse, error) {
	resp := &models.SurveyResponse{
		SurveyID: req.SurveyID, CustomerID: req.CustomerID,
		PolicyNumber: req.PolicyNumber, Answers: req.Answers,
		NPSScore: req.NPSScore, OverallRating: req.OverallRating,
		CompletedAt: time.Now(),
	}
	if err := s.repo.CreateSurveyResponse(ctx, resp); err != nil {
		return nil, fmt.Errorf("failed to submit survey response: %w", err)
	}
	return resp, nil
}

func (s *FeedbackService) GenerateAnalytics(ctx context.Context, period string) (*models.FeedbackAnalytics, error) {
	start, _ := time.Parse("2006-01", period)
	end := start.AddDate(0, 1, 0)
	total, _ := s.repo.GetFeedbackCount(ctx, start, end)
	avgRating, _ := s.repo.GetAvgRating(ctx, start, end)
	sentimentCounts, _ := s.repo.GetSentimentCounts(ctx, start, end)

	analytics := &models.FeedbackAnalytics{
		Period: period, TotalFeedback: int(total),
		AvgRating:          math.Round(avgRating*100) / 100,
		SentimentBreakdown: sentimentCounts,
	}
	if err := s.repo.CreateAnalytics(ctx, analytics); err != nil {
		return nil, fmt.Errorf("failed to create analytics: %w", err)
	}
	return analytics, nil
}

func (s *FeedbackService) GetFeedback(ctx context.Context, id uuid.UUID) (*models.FeedbackSubmission, error) {
	return s.repo.GetFeedback(ctx, id)
}

func (s *FeedbackService) ListFeedback(ctx context.Context, category, status, priority string) ([]models.FeedbackSubmission, error) {
	return s.repo.ListFeedback(ctx, category, status, priority)
}

func (s *FeedbackService) GetResponses(ctx context.Context, feedbackID uuid.UUID) ([]models.FeedbackResponse, error) {
	return s.repo.GetResponses(ctx, feedbackID)
}

func (s *FeedbackService) GetSurveys(ctx context.Context) ([]models.SurveyTemplate, error) {
	return s.repo.ListSurveys(ctx)
}

func analyzeSentiment(text string, rating int) (string, float64) {
	lower := strings.ToLower(text)
	negativeWords := []string{"bad", "terrible", "awful", "worst", "horrible", "poor", "slow", "rude", "frustrated", "disappointed", "unacceptable"}
	positiveWords := []string{"good", "great", "excellent", "amazing", "wonderful", "helpful", "quick", "professional", "satisfied", "happy", "impressed"}
	negCount, posCount := 0, 0
	for _, w := range negativeWords {
		if strings.Contains(lower, w) {
			negCount++
		}
	}
	for _, w := range positiveWords {
		if strings.Contains(lower, w) {
			posCount++
		}
	}
	score := float64(posCount-negCount) / float64(posCount+negCount+1)
	if rating > 0 {
		score = (score + (float64(rating)-3)/2) / 2
	}
	if score > 0.2 {
		return "positive", score
	}
	if score < -0.2 {
		return "negative", score
	}
	return "neutral", score
}

func assessPriority(feedbackType string, rating int, sentiment string) string {
	if feedbackType == "complaint" && rating <= 2 {
		return "urgent"
	}
	if feedbackType == "complaint" && sentiment == "negative" {
		return "high"
	}
	if feedbackType == "complaint" {
		return "medium"
	}
	return "low"
}
