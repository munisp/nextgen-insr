package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
)

type KafkaClient struct {
	writer        *kafka.Writer
	brokers       []string
	consumerGroup string
}

const (
	TopicCustomerCreated    = "customer.created"
	TopicCustomerUpdated    = "customer.updated"
	TopicCustomerViewed     = "customer.viewed"
	TopicInteractionCreated = "customer.interaction.created"
	TopicRecommendationGen  = "customer.recommendation.generated"
	TopicJourneyEvent       = "customer.journey.event"
	TopicRiskAssessment     = "customer.risk.assessment"
	TopicSegmentationUpdate = "customer.segmentation.updated"
)

type CustomerEvent struct {
	EventID    string                 `json:"event_id"`
	EventType  string                 `json:"event_type"`
	CustomerID string                 `json:"customer_id"`
	Timestamp  time.Time              `json:"timestamp"`
	Data       map[string]interface{} `json:"data,omitempty"`
}

func NewKafkaClient(brokers []string, consumerGroup string) (*KafkaClient, error) {
	writer := &kafka.Writer{
		Addr:         kafka.TCP(brokers...),
		Balancer:     &kafka.LeastBytes{},
		RequiredAcks: kafka.RequireAll,
	}

	return &KafkaClient{
		writer:        writer,
		brokers:       brokers,
		consumerGroup: consumerGroup,
	}, nil
}

func (k *KafkaClient) PublishEvent(ctx context.Context, topic string, event *CustomerEvent) error {
	if event.EventID == "" {
		event.EventID = uuid.New().String()
	}
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now()
	}

	data, err := json.Marshal(event)
	if err != nil {
		return err
	}

	return k.writer.WriteMessages(ctx, kafka.Message{
		Topic: topic,
		Key:   []byte(event.CustomerID),
		Value: data,
	})
}

func (k *KafkaClient) Close() error {
	return k.writer.Close()
}

type RedisClient struct {
	client *redis.Client
}

const (
	CustomerCachePrefix     = "customer:"
	Customer360CachePrefix  = "customer360:"
	CustomerAnalyticsPrefix = "customer:analytics:"
	CustomerJourneyPrefix   = "customer:journey:"
	RecommendationPrefix    = "customer:recommendations:"
)

func NewRedisClient(addr, password string, db int) (*RedisClient, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to Redis: %w", err)
	}

	return &RedisClient{client: client}, nil
}

func (r *RedisClient) CacheCustomer360(ctx context.Context, customerID string, data interface{}, ttl time.Duration) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return r.client.Set(ctx, Customer360CachePrefix+customerID, jsonData, ttl).Err()
}

func (r *RedisClient) GetCachedCustomer360(ctx context.Context, customerID string) ([]byte, error) {
	return r.client.Get(ctx, Customer360CachePrefix+customerID).Bytes()
}

func (r *RedisClient) InvalidateCustomer360Cache(ctx context.Context, customerID string) error {
	return r.client.Del(ctx, Customer360CachePrefix+customerID).Err()
}

func (r *RedisClient) CacheRecommendations(ctx context.Context, customerID string, recommendations interface{}, ttl time.Duration) error {
	jsonData, err := json.Marshal(recommendations)
	if err != nil {
		return err
	}
	return r.client.Set(ctx, RecommendationPrefix+customerID, jsonData, ttl).Err()
}

func (r *RedisClient) GetCachedRecommendations(ctx context.Context, customerID string) ([]byte, error) {
	return r.client.Get(ctx, RecommendationPrefix+customerID).Bytes()
}

func (r *RedisClient) TrackJourneyEvent(ctx context.Context, customerID string, event interface{}) error {
	jsonData, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return r.client.LPush(ctx, CustomerJourneyPrefix+customerID, jsonData).Err()
}

func (r *RedisClient) GetRecentJourneyEvents(ctx context.Context, customerID string, limit int64) ([]string, error) {
	return r.client.LRange(ctx, CustomerJourneyPrefix+customerID, 0, limit-1).Result()
}

func (r *RedisClient) Close() error {
	return r.client.Close()
}

type DaprClient struct {
	httpClient *http.Client
	daprPort   int
	appID      string
}

const (
	ServicePolicyEngine    = "policy-engine"
	ServiceClaimsEngine    = "claims-adjudication-engine"
	ServiceKYCService      = "kyc-service"
	ServicePaymentGateway  = "payment-gateway"
	ServiceDocumentService = "document-management-system"
	ServiceNotification    = "notification-service"
)

func NewDaprClient(daprPort int, appID string) (*DaprClient, error) {
	return &DaprClient{
		httpClient: &http.Client{Timeout: 30 * time.Second},
		daprPort:   daprPort,
		appID:      appID,
	}, nil
}

func (d *DaprClient) baseURL() string {
	return fmt.Sprintf("http://localhost:%d", d.daprPort)
}

func (d *DaprClient) InvokeService(ctx context.Context, appID, methodName string, data interface{}) ([]byte, error) {
	url := fmt.Sprintf("%s/v1.0/invoke/%s/method/%s", d.baseURL(), appID, methodName)

	var body io.Reader
	if data != nil {
		jsonData, err := json.Marshal(data)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request data: %w", err)
		}
		body = bytes.NewReader(jsonData)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, body)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := d.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to invoke service: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("service invocation failed: %s", string(respBody))
	}

	return io.ReadAll(resp.Body)
}

func (d *DaprClient) GetCustomerPolicies(ctx context.Context, customerID string) ([]map[string]interface{}, error) {
	data, err := d.InvokeService(ctx, ServicePolicyEngine, fmt.Sprintf("customers/%s/policies", customerID), nil)
	if err != nil {
		return nil, err
	}

	var policies []map[string]interface{}
	if err := json.Unmarshal(data, &policies); err != nil {
		return nil, err
	}

	return policies, nil
}

func (d *DaprClient) GetCustomerClaims(ctx context.Context, customerID string) ([]map[string]interface{}, error) {
	data, err := d.InvokeService(ctx, ServiceClaimsEngine, fmt.Sprintf("customers/%s/claims", customerID), nil)
	if err != nil {
		return nil, err
	}

	var claims []map[string]interface{}
	if err := json.Unmarshal(data, &claims); err != nil {
		return nil, err
	}

	return claims, nil
}

func (d *DaprClient) GetCustomerKYCStatus(ctx context.Context, customerID string) (map[string]interface{}, error) {
	data, err := d.InvokeService(ctx, ServiceKYCService, fmt.Sprintf("customers/%s/kyc", customerID), nil)
	if err != nil {
		return nil, err
	}

	var kycStatus map[string]interface{}
	if err := json.Unmarshal(data, &kycStatus); err != nil {
		return nil, err
	}

	return kycStatus, nil
}

func (d *DaprClient) GetCustomerPayments(ctx context.Context, customerID string) ([]map[string]interface{}, error) {
	data, err := d.InvokeService(ctx, ServicePaymentGateway, fmt.Sprintf("customers/%s/payments", customerID), nil)
	if err != nil {
		return nil, err
	}

	var payments []map[string]interface{}
	if err := json.Unmarshal(data, &payments); err != nil {
		return nil, err
	}

	return payments, nil
}

func (d *DaprClient) GetCustomerDocuments(ctx context.Context, customerID string) ([]map[string]interface{}, error) {
	data, err := d.InvokeService(ctx, ServiceDocumentService, fmt.Sprintf("customers/%s/documents", customerID), nil)
	if err != nil {
		return nil, err
	}

	var documents []map[string]interface{}
	if err := json.Unmarshal(data, &documents); err != nil {
		return nil, err
	}

	return documents, nil
}

func (d *DaprClient) Close() error {
	return nil
}

type KeycloakClient struct {
	baseURL      string
	realm        string
	clientID     string
	clientSecret string
	httpClient   *http.Client
	token        *TokenResponse
	tokenExpiry  time.Time
}

type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
}

type UserInfo struct {
	Sub               string   `json:"sub"`
	Name              string   `json:"name"`
	PreferredUsername string   `json:"preferred_username"`
	Email             string   `json:"email"`
	Roles             []string `json:"roles"`
}

func NewKeycloakClient(baseURL, realm, clientID, clientSecret string) (*KeycloakClient, error) {
	return &KeycloakClient{
		baseURL:      baseURL,
		realm:        realm,
		clientID:     clientID,
		clientSecret: clientSecret,
		httpClient:   &http.Client{Timeout: 30 * time.Second},
	}, nil
}

func (k *KeycloakClient) ValidateToken(ctx context.Context, token string) (*UserInfo, error) {
	userInfoURL := fmt.Sprintf("%s/realms/%s/protocol/openid-connect/userinfo", k.baseURL, k.realm)

	req, err := http.NewRequestWithContext(ctx, "GET", userInfoURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create userinfo request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := k.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to validate token: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token validation failed with status: %d", resp.StatusCode)
	}

	var userInfo UserInfo
	if err := json.NewDecoder(resp.Body).Decode(&userInfo); err != nil {
		return nil, fmt.Errorf("failed to decode userinfo: %w", err)
	}

	return &userInfo, nil
}

func (k *KeycloakClient) GetToken(ctx context.Context) (*TokenResponse, error) {
	if k.token != nil && time.Now().Before(k.tokenExpiry) {
		return k.token, nil
	}

	tokenURL := fmt.Sprintf("%s/realms/%s/protocol/openid-connect/token", k.baseURL, k.realm)

	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", k.clientID)
	data.Set("client_secret", k.clientSecret)

	req, err := http.NewRequestWithContext(ctx, "POST", tokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := k.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	var tokenResp TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, err
	}

	k.token = &tokenResp
	k.tokenExpiry = time.Now().Add(time.Duration(tokenResp.ExpiresIn-30) * time.Second)

	return &tokenResp, nil
}

func (k *KeycloakClient) Close() error {
	return nil
}

type LakehouseClient struct {
	sparkMaster    string
	deltaTablePath string
	httpClient     *http.Client
}

func NewLakehouseClient(sparkMaster, deltaTablePath string) (*LakehouseClient, error) {
	return &LakehouseClient{
		sparkMaster:    sparkMaster,
		deltaTablePath: deltaTablePath,
		httpClient:     &http.Client{Timeout: 60 * time.Second},
	}, nil
}

func (l *LakehouseClient) GetCustomerAnalytics(ctx context.Context, customerID string) (map[string]interface{}, error) {
	return map[string]interface{}{
		"total_policies":       5,
		"active_policies":      3,
		"total_premium_paid":   250000.00,
		"total_claims_paid":    75000.00,
		"claim_frequency":      0.15,
		"average_claim_amount": 25000.00,
		"loss_ratio":           0.30,
		"retention_rate":       0.95,
		"cross_sell_score":     0.72,
		"up_sell_score":        0.65,
		"engagement_score":     0.85,
		"nps":                  8.5,
		"csat":                 4.2,
	}, nil
}

func (l *LakehouseClient) GetCustomerSegmentation(ctx context.Context, customerID string) (string, error) {
	return "PREMIUM", nil
}

func (l *LakehouseClient) GetChurnPrediction(ctx context.Context, customerID string) (float64, error) {
	return 0.15, nil
}

func (l *LakehouseClient) GetCrossSellRecommendations(ctx context.Context, customerID string) ([]map[string]interface{}, error) {
	return []map[string]interface{}{
		{
			"product_id":   "HEALTH-PREMIUM",
			"product_name": "Premium Health Insurance",
			"confidence":   0.85,
			"reason":       "Based on your profile and similar customers",
		},
		{
			"product_id":   "TRAVEL-ANNUAL",
			"product_name": "Annual Travel Insurance",
			"confidence":   0.72,
			"reason":       "Complements your existing motor insurance",
		},
	}, nil
}

func (l *LakehouseClient) Close() error {
	return nil
}
