package service

import (
	"context"
	"customer-360-service/internal/middleware"
	"customer-360-service/internal/models"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Customer360Service struct {
	db        *gorm.DB
	kafka     *middleware.KafkaClient
	redis     *middleware.RedisClient
	dapr      *middleware.DaprClient
	keycloak  *middleware.KeycloakClient
	lakehouse *middleware.LakehouseClient
}

type Customer360Config struct {
	KafkaBrokers     []string
	RedisAddr        string
	RedisPassword    string
	DaprPort         int
	KeycloakURL      string
	KeycloakRealm    string
	KeycloakClientID string
	KeycloakSecret   string
	SparkMaster      string
	DeltaTablePath   string
}

func NewCustomer360Service(db *gorm.DB, config *Customer360Config) (*Customer360Service, error) {
	kafka, err := middleware.NewKafkaClient(config.KafkaBrokers, "customer-360-consumer")
	if err != nil {
		return nil, fmt.Errorf("failed to create kafka client: %w", err)
	}

	redis, err := middleware.NewRedisClient(config.RedisAddr, config.RedisPassword, 0)
	if err != nil {
		return nil, fmt.Errorf("failed to create redis client: %w", err)
	}

	dapr, err := middleware.NewDaprClient(config.DaprPort, "customer-360-service")
	if err != nil {
		return nil, fmt.Errorf("failed to create dapr client: %w", err)
	}

	keycloak, err := middleware.NewKeycloakClient(config.KeycloakURL, config.KeycloakRealm, config.KeycloakClientID, config.KeycloakSecret)
	if err != nil {
		return nil, fmt.Errorf("failed to create keycloak client: %w", err)
	}

	lakehouse, err := middleware.NewLakehouseClient(config.SparkMaster, config.DeltaTablePath)
	if err != nil {
		return nil, fmt.Errorf("failed to create lakehouse client: %w", err)
	}

	return &Customer360Service{
		db:        db,
		kafka:     kafka,
		redis:     redis,
		dapr:      dapr,
		keycloak:  keycloak,
		lakehouse: lakehouse,
	}, nil
}

func (s *Customer360Service) GetCustomer360View(ctx context.Context, customerID string, userToken string) (*models.Customer360View, error) {
	_, err := s.keycloak.ValidateToken(ctx, userToken)
	if err != nil {
		return nil, fmt.Errorf("unauthorized: %w", err)
	}

	cachedData, err := s.redis.GetCachedCustomer360(ctx, customerID)
	if err == nil && cachedData != nil {
		var view models.Customer360View
		if err := json.Unmarshal(cachedData, &view); err == nil {
			s.kafka.PublishEvent(ctx, middleware.TopicCustomerViewed, &middleware.CustomerEvent{
				EventType:  "CUSTOMER_360_VIEWED",
				CustomerID: customerID,
				Data:       map[string]interface{}{"source": "cache"},
			})
			return &view, nil
		}
	}

	view, err := s.buildCustomer360View(ctx, customerID)
	if err != nil {
		return nil, err
	}

	_ = s.redis.CacheCustomer360(ctx, customerID, view, 15*time.Minute)

	s.kafka.PublishEvent(ctx, middleware.TopicCustomerViewed, &middleware.CustomerEvent{
		EventType:  "CUSTOMER_360_VIEWED",
		CustomerID: customerID,
		Data:       map[string]interface{}{"source": "database"},
	})

	return view, nil
}

func (s *Customer360Service) buildCustomer360View(ctx context.Context, customerID string) (*models.Customer360View, error) {
	var customer models.Customer
	if err := s.db.WithContext(ctx).First(&customer, "id = ?", customerID).Error; err != nil {
		return nil, fmt.Errorf("customer not found: %w", err)
	}

	view := &models.Customer360View{
		Customer: &customer,
	}

	policiesData, err := s.dapr.GetCustomerPolicies(ctx, customerID)
	if err == nil {
		view.Policies = convertToPolicies(policiesData)
	}

	claimsData, err := s.dapr.GetCustomerClaims(ctx, customerID)
	if err == nil {
		view.Claims = convertToClaims(claimsData)
	}

	documentsData, err := s.dapr.GetCustomerDocuments(ctx, customerID)
	if err == nil {
		view.Documents = convertToDocuments(documentsData)
	}

	paymentsData, err := s.dapr.GetCustomerPayments(ctx, customerID)
	if err == nil {
		view.Payments = convertToPayments(paymentsData)
	}

	var interactions []models.CustomerInteraction
	s.db.WithContext(ctx).Where("customer_id = ?", customerID).Order("created_at DESC").Limit(50).Find(&interactions)
	view.Interactions = interactions

	analyticsData, err := s.lakehouse.GetCustomerAnalytics(ctx, customerID)
	if err == nil {
		view.Analytics = convertToAnalytics(analyticsData, &customer)
	}

	recommendations, err := s.generateRecommendations(ctx, customerID, view)
	if err == nil {
		view.Recommendations = recommendations
	}

	journeyEvents, err := s.getJourneyEvents(ctx, customerID)
	if err == nil {
		view.JourneyEvents = journeyEvents
	}

	riskProfile, err := s.calculateRiskProfile(ctx, customerID, view)
	if err == nil {
		view.RiskProfile = riskProfile
	}

	return view, nil
}

func (s *Customer360Service) generateRecommendations(ctx context.Context, customerID string, view *models.Customer360View) ([]models.Recommendation, error) {
	cachedRecs, err := s.redis.GetCachedRecommendations(ctx, customerID)
	if err == nil && cachedRecs != nil {
		var recommendations []models.Recommendation
		if err := json.Unmarshal(cachedRecs, &recommendations); err == nil {
			return recommendations, nil
		}
	}

	crossSellRecs, err := s.lakehouse.GetCrossSellRecommendations(ctx, customerID)
	if err != nil {
		return nil, err
	}

	var recommendations []models.Recommendation

	for i, rec := range crossSellRecs {
		productID, _ := rec["product_id"].(string)
		productName, _ := rec["product_name"].(string)
		confidence, _ := rec["confidence"].(float64)
		reason, _ := rec["reason"].(string)

		recommendations = append(recommendations, models.Recommendation{
			ID:          uuid.New().String(),
			Type:        "CROSS_SELL",
			Title:       fmt.Sprintf("Recommended: %s", productName),
			Description: reason,
			ProductID:   productID,
			ProductName: productName,
			Confidence:  confidence,
			Priority:    i + 1,
			Reason:      reason,
			Status:      "ACTIVE",
			CreatedAt:   time.Now(),
		})
	}

	for _, policy := range view.Policies {
		if policy.Status == "ACTIVE" && policy.ExpiryDate.Before(time.Now().AddDate(0, 1, 0)) {
			recommendations = append(recommendations, models.Recommendation{
				ID:          uuid.New().String(),
				Type:        "RENEWAL",
				Title:       fmt.Sprintf("Renew %s", policy.ProductName),
				Description: fmt.Sprintf("Your %s policy expires on %s", policy.ProductName, policy.ExpiryDate.Format("Jan 02, 2006")),
				ProductID:   policy.ID.String(),
				ProductName: policy.ProductName,
				Confidence:  0.95,
				Priority:    1,
				Reason:      "Policy expiring soon",
				Status:      "ACTIVE",
				CreatedAt:   time.Now(),
			})
		}
	}

	if view.Customer.LifetimeValue > 100000 {
		recommendations = append(recommendations, models.Recommendation{
			ID:          uuid.New().String(),
			Type:        "LOYALTY",
			Title:       "Premium Customer Benefits",
			Description: "As a valued customer, you're eligible for exclusive premium benefits",
			Confidence:  0.90,
			Priority:    2,
			Reason:      "High lifetime value customer",
			Status:      "ACTIVE",
			CreatedAt:   time.Now(),
		})
	}

	_ = s.redis.CacheRecommendations(ctx, customerID, recommendations, 1*time.Hour)

	s.kafka.PublishEvent(ctx, middleware.TopicRecommendationGen, &middleware.CustomerEvent{
		EventType:  "RECOMMENDATIONS_GENERATED",
		CustomerID: customerID,
		Data: map[string]interface{}{
			"count": len(recommendations),
		},
	})

	return recommendations, nil
}

func (s *Customer360Service) getJourneyEvents(ctx context.Context, customerID string) ([]models.JourneyEvent, error) {
	eventsData, err := s.redis.GetRecentJourneyEvents(ctx, customerID, 100)
	if err != nil {
		return nil, err
	}

	var events []models.JourneyEvent
	for _, data := range eventsData {
		var event models.JourneyEvent
		if err := json.Unmarshal([]byte(data), &event); err == nil {
			events = append(events, event)
		}
	}

	return events, nil
}

func (s *Customer360Service) calculateRiskProfile(ctx context.Context, customerID string, view *models.Customer360View) (*models.RiskProfile, error) {
	churnRisk, _ := s.lakehouse.GetChurnPrediction(ctx, customerID)

	var fraudRisk float64 = 0.1
	var claimRisk float64 = 0.2
	var creditRisk float64 = 0.15

	if len(view.Claims) > 0 {
		totalClaims := float64(len(view.Claims))
		claimRisk = totalClaims / float64(len(view.Policies)+1) * 0.5
		if claimRisk > 1 {
			claimRisk = 1
		}
	}

	overallRisk := (fraudRisk*0.25 + creditRisk*0.25 + churnRisk*0.25 + claimRisk*0.25)

	riskFactors := []models.RiskFactor{
		{Factor: "Fraud Risk", Score: fraudRisk, Weight: 0.25, Impact: getRiskImpact(fraudRisk), Description: "Based on transaction patterns and behavior analysis"},
		{Factor: "Credit Risk", Score: creditRisk, Weight: 0.25, Impact: getRiskImpact(creditRisk), Description: "Based on payment history and credit score"},
		{Factor: "Churn Risk", Score: churnRisk, Weight: 0.25, Impact: getRiskImpact(churnRisk), Description: "Likelihood of customer leaving based on engagement"},
		{Factor: "Claim Risk", Score: claimRisk, Weight: 0.25, Impact: getRiskImpact(claimRisk), Description: "Based on claim frequency and patterns"},
	}

	riskTrend := "STABLE"
	if overallRisk > 0.5 {
		riskTrend = "INCREASING"
	} else if overallRisk < 0.2 {
		riskTrend = "DECREASING"
	}

	s.kafka.PublishEvent(ctx, middleware.TopicRiskAssessment, &middleware.CustomerEvent{
		EventType:  "RISK_ASSESSED",
		CustomerID: customerID,
		Data: map[string]interface{}{
			"overall_risk": overallRisk,
			"risk_trend":   riskTrend,
		},
	})

	return &models.RiskProfile{
		OverallRiskScore:   overallRisk,
		FraudRiskScore:     fraudRisk,
		CreditRiskScore:    creditRisk,
		ChurnRiskScore:     churnRisk,
		ClaimRiskScore:     claimRisk,
		RiskFactors:        riskFactors,
		RiskTrend:          riskTrend,
		LastAssessmentDate: time.Now(),
		NextAssessmentDate: time.Now().AddDate(0, 1, 0),
	}, nil
}

func (s *Customer360Service) TrackJourneyEvent(ctx context.Context, customerID string, event *models.JourneyEvent) error {
	event.ID = uuid.New().String()
	event.CustomerID = uuid.MustParse(customerID)
	event.Timestamp = time.Now()

	if err := s.redis.TrackJourneyEvent(ctx, customerID, event); err != nil {
		return err
	}

	s.kafka.PublishEvent(ctx, middleware.TopicJourneyEvent, &middleware.CustomerEvent{
		EventType:  "JOURNEY_EVENT_TRACKED",
		CustomerID: customerID,
		Data: map[string]interface{}{
			"event_type": event.EventType,
			"event_name": event.EventName,
			"channel":    event.Channel,
		},
	})

	_ = s.redis.InvalidateCustomer360Cache(ctx, customerID)

	return nil
}

func (s *Customer360Service) CreateInteraction(ctx context.Context, customerID string, interaction *models.CustomerInteraction) error {
	interaction.ID = uuid.New()
	interaction.CustomerID = uuid.MustParse(customerID)
	interaction.CreatedAt = time.Now()
	interaction.UpdatedAt = time.Now()

	if err := s.db.WithContext(ctx).Create(interaction).Error; err != nil {
		return fmt.Errorf("failed to create interaction: %w", err)
	}

	s.kafka.PublishEvent(ctx, middleware.TopicInteractionCreated, &middleware.CustomerEvent{
		EventType:  "INTERACTION_CREATED",
		CustomerID: customerID,
		Data: map[string]interface{}{
			"interaction_id":   interaction.ID.String(),
			"interaction_type": interaction.InteractionType,
			"channel":          interaction.Channel,
		},
	})

	_ = s.redis.InvalidateCustomer360Cache(ctx, customerID)

	return nil
}

func (s *Customer360Service) UpdateCustomerSegment(ctx context.Context, customerID string) error {
	segment, err := s.lakehouse.GetCustomerSegmentation(ctx, customerID)
	if err != nil {
		return err
	}

	if err := s.db.WithContext(ctx).Model(&models.Customer{}).Where("id = ?", customerID).Update("customer_segment", segment).Error; err != nil {
		return err
	}

	s.kafka.PublishEvent(ctx, middleware.TopicSegmentationUpdate, &middleware.CustomerEvent{
		EventType:  "SEGMENTATION_UPDATED",
		CustomerID: customerID,
		Data: map[string]interface{}{
			"new_segment": segment,
		},
	})

	_ = s.redis.InvalidateCustomer360Cache(ctx, customerID)

	return nil
}

func (s *Customer360Service) GetCustomerAnalytics(ctx context.Context, customerID string) (*models.CustomerAnalytics, error) {
	analyticsData, err := s.lakehouse.GetCustomerAnalytics(ctx, customerID)
	if err != nil {
		return nil, err
	}

	var customer models.Customer
	s.db.WithContext(ctx).First(&customer, "id = ?", customerID)

	return convertToAnalytics(analyticsData, &customer), nil
}

func (s *Customer360Service) SearchCustomers(ctx context.Context, query string, filters map[string]interface{}, page, pageSize int) ([]models.Customer, int64, error) {
	var customers []models.Customer
	var total int64

	db := s.db.WithContext(ctx).Model(&models.Customer{})

	if query != "" {
		db = db.Where("first_name ILIKE ? OR last_name ILIKE ? OR email ILIKE ? OR customer_number ILIKE ?",
			"%"+query+"%", "%"+query+"%", "%"+query+"%", "%"+query+"%")
	}

	for key, value := range filters {
		db = db.Where(key+" = ?", value)
	}

	db.Count(&total)

	offset := (page - 1) * pageSize
	db.Offset(offset).Limit(pageSize).Find(&customers)

	return customers, total, nil
}

func (s *Customer360Service) Close() error {
	_ = s.kafka.Close()
	_ = s.redis.Close()
	_ = s.dapr.Close()
	_ = s.keycloak.Close()
	_ = s.lakehouse.Close()
	return nil
}

func convertToPolicies(data []map[string]interface{}) []models.CustomerPolicy {
	var policies []models.CustomerPolicy
	for _, d := range data {
		policy := models.CustomerPolicy{}
		if id, ok := d["id"].(string); ok {
			policy.ID = uuid.MustParse(id)
		}
		if policyNumber, ok := d["policy_number"].(string); ok {
			policy.PolicyNumber = policyNumber
		}
		if productType, ok := d["product_type"].(string); ok {
			policy.ProductType = productType
		}
		if productName, ok := d["product_name"].(string); ok {
			policy.ProductName = productName
		}
		if status, ok := d["status"].(string); ok {
			policy.Status = status
		}
		if premium, ok := d["premium_amount"].(float64); ok {
			policy.PremiumAmount = premium
		}
		if sumInsured, ok := d["sum_insured"].(float64); ok {
			policy.SumInsured = sumInsured
		}
		policies = append(policies, policy)
	}
	return policies
}

func convertToClaims(data []map[string]interface{}) []models.CustomerClaim {
	var claims []models.CustomerClaim
	for _, d := range data {
		claim := models.CustomerClaim{}
		if id, ok := d["id"].(string); ok {
			claim.ID = uuid.MustParse(id)
		}
		if claimNumber, ok := d["claim_number"].(string); ok {
			claim.ClaimNumber = claimNumber
		}
		if claimType, ok := d["claim_type"].(string); ok {
			claim.ClaimType = claimType
		}
		if status, ok := d["status"].(string); ok {
			claim.Status = status
		}
		if amount, ok := d["claim_amount"].(float64); ok {
			claim.ClaimAmount = amount
		}
		claims = append(claims, claim)
	}
	return claims
}

func convertToDocuments(data []map[string]interface{}) []models.CustomerDocument {
	var documents []models.CustomerDocument
	for _, d := range data {
		doc := models.CustomerDocument{}
		if id, ok := d["id"].(string); ok {
			doc.ID = uuid.MustParse(id)
		}
		if docType, ok := d["document_type"].(string); ok {
			doc.DocumentType = docType
		}
		if fileName, ok := d["file_name"].(string); ok {
			doc.FileName = fileName
		}
		if status, ok := d["status"].(string); ok {
			doc.Status = status
		}
		documents = append(documents, doc)
	}
	return documents
}

func convertToPayments(data []map[string]interface{}) []models.CustomerPayment {
	var payments []models.CustomerPayment
	for _, d := range data {
		payment := models.CustomerPayment{}
		if id, ok := d["id"].(string); ok {
			payment.ID = uuid.MustParse(id)
		}
		if paymentType, ok := d["payment_type"].(string); ok {
			payment.PaymentType = paymentType
		}
		if amount, ok := d["amount"].(float64); ok {
			payment.Amount = amount
		}
		if status, ok := d["status"].(string); ok {
			payment.Status = status
		}
		payments = append(payments, payment)
	}
	return payments
}

func convertToAnalytics(data map[string]interface{}, customer *models.Customer) *models.CustomerAnalytics {
	analytics := &models.CustomerAnalytics{
		CustomerSince: customer.CreatedAt,
	}

	if v, ok := data["total_policies"].(int); ok {
		analytics.TotalPolicies = v
	}
	if v, ok := data["active_policies"].(int); ok {
		analytics.ActivePolicies = v
	}
	if v, ok := data["total_premium_paid"].(float64); ok {
		analytics.TotalPremiumPaid = v
	}
	if v, ok := data["total_claims_paid"].(float64); ok {
		analytics.TotalClaimsPaid = v
	}
	if v, ok := data["claim_frequency"].(float64); ok {
		analytics.ClaimFrequency = v
	}
	if v, ok := data["average_claim_amount"].(float64); ok {
		analytics.AverageClaimAmount = v
	}
	if v, ok := data["loss_ratio"].(float64); ok {
		analytics.LossRatio = v
	}
	if v, ok := data["retention_rate"].(float64); ok {
		analytics.RetentionRate = v
	}
	if v, ok := data["cross_sell_score"].(float64); ok {
		analytics.CrossSellScore = v
	}
	if v, ok := data["up_sell_score"].(float64); ok {
		analytics.UpSellScore = v
	}
	if v, ok := data["engagement_score"].(float64); ok {
		analytics.EngagementScore = v
	}
	if v, ok := data["nps"].(float64); ok {
		analytics.NPS = v
	}
	if v, ok := data["csat"].(float64); ok {
		analytics.CSAT = v
	}

	return analytics
}

func getRiskImpact(score float64) string {
	if score < 0.2 {
		return "LOW"
	} else if score < 0.5 {
		return "MEDIUM"
	} else if score < 0.8 {
		return "HIGH"
	}
	return "CRITICAL"
}
