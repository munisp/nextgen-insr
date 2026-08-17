package repository

import (
	"context"
	"github.com/munisp/NGApp/feedback-management/internal/models"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type FeedbackRepository struct{ db *gorm.DB }

func NewFeedbackRepository(db *gorm.DB) *FeedbackRepository { return &FeedbackRepository{db: db} }

func (r *FeedbackRepository) AutoMigrate() error {
	return r.db.AutoMigrate(&models.FeedbackSubmission{}, &models.FeedbackResponse{}, &models.SurveyTemplate{}, &models.SurveyResponse{}, &models.FeedbackAnalytics{})
}

func (r *FeedbackRepository) CreateFeedback(ctx context.Context, f *models.FeedbackSubmission) error {
	f.ID = uuid.New()
	f.CreatedAt = time.Now()
	f.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Create(f).Error
}

func (r *FeedbackRepository) GetFeedback(ctx context.Context, id uuid.UUID) (*models.FeedbackSubmission, error) {
	var f models.FeedbackSubmission
	return &f, r.db.WithContext(ctx).First(&f, "id = ?", id).Error
}

func (r *FeedbackRepository) ListFeedback(ctx context.Context, category, status, priority string) ([]models.FeedbackSubmission, error) {
	var feedbacks []models.FeedbackSubmission
	q := r.db.WithContext(ctx)
	if category != "" {
		q = q.Where("category = ?", category)
	}
	if status != "" {
		q = q.Where("status = ?", status)
	}
	if priority != "" {
		q = q.Where("priority = ?", priority)
	}
	return feedbacks, q.Order("created_at DESC").Limit(100).Find(&feedbacks).Error
}

func (r *FeedbackRepository) UpdateFeedback(ctx context.Context, f *models.FeedbackSubmission) error {
	f.UpdatedAt = time.Now()
	return r.db.WithContext(ctx).Save(f).Error
}

func (r *FeedbackRepository) CreateResponse(ctx context.Context, resp *models.FeedbackResponse) error {
	resp.ID = uuid.New()
	resp.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(resp).Error
}

func (r *FeedbackRepository) GetResponses(ctx context.Context, feedbackID uuid.UUID) ([]models.FeedbackResponse, error) {
	var responses []models.FeedbackResponse
	return responses, r.db.WithContext(ctx).Where("feedback_id = ?", feedbackID).Order("created_at").Find(&responses).Error
}

func (r *FeedbackRepository) CreateSurvey(ctx context.Context, s *models.SurveyTemplate) error {
	s.ID = uuid.New()
	s.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(s).Error
}

func (r *FeedbackRepository) ListSurveys(ctx context.Context) ([]models.SurveyTemplate, error) {
	var surveys []models.SurveyTemplate
	return surveys, r.db.WithContext(ctx).Where("is_active = ?", true).Find(&surveys).Error
}

func (r *FeedbackRepository) CreateSurveyResponse(ctx context.Context, sr *models.SurveyResponse) error {
	sr.ID = uuid.New()
	sr.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(sr).Error
}

func (r *FeedbackRepository) GetSurveyResponses(ctx context.Context, surveyID uuid.UUID) ([]models.SurveyResponse, error) {
	var responses []models.SurveyResponse
	return responses, r.db.WithContext(ctx).Where("survey_id = ?", surveyID).Find(&responses).Error
}

func (r *FeedbackRepository) GetAvgRating(ctx context.Context, from, to time.Time) (float64, error) {
	var avg float64
	return avg, r.db.WithContext(ctx).Model(&models.FeedbackSubmission{}).Where("created_at BETWEEN ? AND ? AND rating > 0", from, to).Select("COALESCE(AVG(rating), 0)").Scan(&avg).Error
}

func (r *FeedbackRepository) GetFeedbackCount(ctx context.Context, from, to time.Time) (int64, error) {
	var count int64
	return count, r.db.WithContext(ctx).Model(&models.FeedbackSubmission{}).Where("created_at BETWEEN ? AND ?", from, to).Count(&count).Error
}

func (r *FeedbackRepository) GetSentimentCounts(ctx context.Context, from, to time.Time) (map[string]int, error) {
	type Result struct {
		Sentiment string
		Count     int
	}
	var results []Result
	r.db.WithContext(ctx).Model(&models.FeedbackSubmission{}).Where("created_at BETWEEN ? AND ?", from, to).Select("sentiment, COUNT(*) as count").Group("sentiment").Scan(&results)
	counts := make(map[string]int)
	for _, r := range results {
		counts[r.Sentiment] = r.Count
	}
	return counts, nil
}

func (r *FeedbackRepository) GetNPSResponses(ctx context.Context, surveyID uuid.UUID) (promoters, passives, detractors int64, err error) {
	r.db.WithContext(ctx).Model(&models.SurveyResponse{}).Where("survey_id = ? AND nps_score >= 9", surveyID).Count(&promoters)
	r.db.WithContext(ctx).Model(&models.SurveyResponse{}).Where("survey_id = ? AND nps_score >= 7 AND nps_score <= 8", surveyID).Count(&passives)
	r.db.WithContext(ctx).Model(&models.SurveyResponse{}).Where("survey_id = ? AND nps_score <= 6", surveyID).Count(&detractors)
	return
}

func (r *FeedbackRepository) CreateAnalytics(ctx context.Context, a *models.FeedbackAnalytics) error {
	a.ID = uuid.New()
	a.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(a).Error
}
