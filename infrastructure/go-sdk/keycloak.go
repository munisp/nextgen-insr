package infra

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"
)

const maxTokenCacheSize = 10000

type KeycloakClient struct {
	realmURL     string
	clientID     string
	clientSecret string
	adminURL     string
	httpClient   *http.Client
	logger       *zap.Logger
	tokenCache   map[string]*cachedToken
	mu           sync.RWMutex
	redis        *RedisClient
}

type cachedToken struct {
	Claims    map[string]interface{}
	ExpiresAt time.Time
}

type KeycloakUser struct {
	ID         string                 `json:"id"`
	Username   string                 `json:"username"`
	Email      string                 `json:"email"`
	FirstName  string                 `json:"firstName"`
	LastName   string                 `json:"lastName"`
	Enabled    bool                   `json:"enabled"`
	Attributes map[string][]string    `json:"attributes,omitempty"`
}

func NewKeycloakClient(logger *zap.Logger, realmURL, clientID, clientSecret, adminURL string) *KeycloakClient {
	return &KeycloakClient{
		realmURL:     realmURL,
		clientID:     clientID,
		clientSecret: clientSecret,
		adminURL:     adminURL,
		httpClient:   &http.Client{Timeout: 10 * time.Second},
		logger:       logger,
		tokenCache:   make(map[string]*cachedToken),
	}
}

func (c *KeycloakClient) Ping(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "GET", c.realmURL+"/.well-known/openid-configuration", nil)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("keycloak ping: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("keycloak unhealthy: %d", resp.StatusCode)
	}
	return nil
}

func (c *KeycloakClient) ValidateToken(ctx context.Context, token string) (map[string]interface{}, error) {
	c.mu.RLock()
	if cached, ok := c.tokenCache[token]; ok && time.Now().Before(cached.ExpiresAt) {
		c.mu.RUnlock()
		return cached.Claims, nil
	}
	c.mu.RUnlock()

	req, err := http.NewRequestWithContext(ctx, "GET", c.realmURL+"/protocol/openid-connect/userinfo", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token validation: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("invalid token: status %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	var claims map[string]interface{}
	json.Unmarshal(body, &claims)

	c.mu.Lock()
	c.tokenCache[token] = &cachedToken{Claims: claims, ExpiresAt: time.Now().Add(5 * time.Minute)}
	// Enforce max cache size — evict expired entries
	if len(c.tokenCache) > maxTokenCacheSize {
		now := time.Now()
		for k, v := range c.tokenCache {
			if now.After(v.ExpiresAt) {
				delete(c.tokenCache, k)
			}
		}
	}
	c.mu.Unlock()

	return claims, nil
}

func (c *KeycloakClient) GetKYCLevel(ctx context.Context, token string) (int, error) {
	claims, err := c.ValidateToken(ctx, token)
	if err != nil {
		return 0, err
	}
	if level, ok := claims["kyc_level"]; ok {
		switch v := level.(type) {
		case float64:
			return int(v), nil
		case string:
			var l int
			fmt.Sscanf(v, "%d", &l)
			return l, nil
		}
	}
	return 0, nil
}

func (c *KeycloakClient) GetServiceToken(ctx context.Context) (string, error) {
	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", c.clientID)
	data.Set("client_secret", c.clientSecret)

	req, err := http.NewRequestWithContext(ctx, "POST", c.realmURL+"/protocol/openid-connect/token", strings.NewReader(data.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("service token: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	json.Unmarshal(body, &result)
	if token, ok := result["access_token"].(string); ok {
		return token, nil
	}
	return "", fmt.Errorf("no access_token in response")
}

func (c *KeycloakClient) UpdateUserKYCLevel(ctx context.Context, userID string, kycLevel int, kycStatus string) error {
	adminToken, err := c.GetServiceToken(ctx)
	if err != nil {
		return err
	}
	payload := map[string]interface{}{
		"attributes": map[string][]string{
			"kyc_level":  {fmt.Sprintf("%d", kycLevel)},
			"kyc_status": {kycStatus},
		},
	}
	data, _ := json.Marshal(payload)
	realm := extractRealm(c.realmURL)
	req, err := http.NewRequestWithContext(ctx, "PUT", fmt.Sprintf("%s/admin/realms/%s/users/%s", c.adminURL, realm, userID), bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+adminToken)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("update user: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("update user failed (%d): %s", resp.StatusCode, string(body))
	}
	return nil
}

// SetupRealmClients registers all platform service clients in the Keycloak realm.
func (c *KeycloakClient) SetupRealmClients(ctx context.Context) error {
	clients := []map[string]interface{}{
		{"clientId": "policy-service", "name": "Policy Service", "serviceAccountsEnabled": true, "directAccessGrantsEnabled": false},
		{"clientId": "claims-service", "name": "Claims Service", "serviceAccountsEnabled": true, "directAccessGrantsEnabled": false},
		{"clientId": "payment-service", "name": "Payment Service", "serviceAccountsEnabled": true, "directAccessGrantsEnabled": false},
		{"clientId": "kyc-service", "name": "KYC Orchestrator", "serviceAccountsEnabled": true, "directAccessGrantsEnabled": false},
		{"clientId": "fraud-service", "name": "Fraud Detection", "serviceAccountsEnabled": true, "directAccessGrantsEnabled": false},
		{"clientId": "analytics-service", "name": "Analytics Service", "serviceAccountsEnabled": true, "directAccessGrantsEnabled": false},
		{"clientId": "mobile-app", "name": "Mobile Application", "publicClient": true, "redirectUris": []string{"*"}},
		{"clientId": "customer-portal", "name": "Customer Portal", "publicClient": true, "redirectUris": []string{"*"}},
		{"clientId": "agent-portal", "name": "Agent Portal", "publicClient": true, "redirectUris": []string{"*"}},
	}

	adminToken, err := c.GetServiceToken(ctx)
	if err != nil {
		return err
	}
	realm := extractRealm(c.realmURL)
	for _, client := range clients {
		data, _ := json.Marshal(client)
		req, _ := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/admin/realms/%s/clients", c.adminURL, realm), bytes.NewReader(data))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+adminToken)
		resp, err := c.httpClient.Do(req)
		if err != nil {
			c.logger.Warn("client_registration_failed", zap.String("client", client["clientId"].(string)), zap.Error(err))
			continue
		}
		resp.Body.Close()
	}
	return nil
}

// SetRedisClient attaches Redis for distributed token invalidation across replicas.
func (c *KeycloakClient) SetRedisClient(redis *RedisClient) {
	c.redis = redis
	go c.subscribeToInvalidations()
}

func (c *KeycloakClient) subscribeToInvalidations() {
	if c.redis == nil || c.redis.client == nil {
		return
	}
	ctx := context.Background()
	sub := c.redis.Subscribe(ctx, "__token_invalidation__")
	defer sub.Close()

	for msg := range sub.Channel() {
		var data map[string]interface{}
		if err := json.Unmarshal([]byte(msg.Payload), &data); err != nil {
			continue
		}
		if token, ok := data["token"].(string); ok && token != "" {
			c.mu.Lock()
			delete(c.tokenCache, token)
			c.mu.Unlock()
		}
		if userID, ok := data["user_id"].(string); ok && userID != "" {
			c.mu.Lock()
			for k, v := range c.tokenCache {
				if sub, ok := v.Claims["sub"].(string); ok && sub == userID {
					delete(c.tokenCache, k)
				}
			}
			c.mu.Unlock()
		}
	}
}

func (c *KeycloakClient) InvalidateTokenCache(token string) {
	c.mu.Lock()
	delete(c.tokenCache, token)
	c.mu.Unlock()
}

// InvalidateToken invalidates a specific token across all service replicas via Redis pub/sub.
func (c *KeycloakClient) InvalidateToken(ctx context.Context, token string) error {
	c.InvalidateTokenCache(token)
	if c.redis != nil {
		event := map[string]interface{}{"token": token, "timestamp": time.Now().Unix()}
		return c.redis.Publish(ctx, "__token_invalidation__", event)
	}
	return nil
}

// InvalidateUserTokens invalidates all tokens for a user across all replicas.
func (c *KeycloakClient) InvalidateUserTokens(ctx context.Context, userID string) error {
	c.mu.Lock()
	for k, v := range c.tokenCache {
		if sub, ok := v.Claims["sub"].(string); ok && sub == userID {
			delete(c.tokenCache, k)
		}
	}
	c.mu.Unlock()
	if c.redis != nil {
		event := map[string]interface{}{"user_id": userID, "timestamp": time.Now().Unix()}
		return c.redis.Publish(ctx, "__token_invalidation__", event)
	}
	return nil
}

func extractRealm(realmURL string) string {
	parts := strings.Split(realmURL, "/realms/")
	if len(parts) == 2 {
		return parts[1]
	}
	return "insurance"
}
