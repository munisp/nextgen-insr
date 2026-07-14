package infra

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"go.uber.org/zap"
)

type APISixClient struct {
	adminURL   string
	apiKey     string
	httpClient *http.Client
	logger     *zap.Logger
}

type APISixRoute struct {
	URI         string                 `json:"uri"`
	Name        string                 `json:"name"`
	Methods     []string               `json:"methods"`
	UpstreamURL string                 `json:"upstream_url"`
	Plugins     map[string]interface{} `json:"plugins,omitempty"`
}

func NewAPISixClient(logger *zap.Logger, adminURL string) *APISixClient {
	apiKey := os.Getenv("APISIX_API_KEY")
	if apiKey == "" {
		apiKey = os.Getenv("APISIX_ADMIN_KEY")
	}
	return &APISixClient{
		adminURL: adminURL,
		apiKey:   apiKey,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		logger: logger,
	}
}

func (c *APISixClient) Ping(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "GET", c.adminURL+"/apisix/admin/routes", nil)
	if err != nil {
		return err
	}
	if c.apiKey != "" {
		req.Header.Set("X-API-KEY", c.apiKey)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("apisix ping: %w", err)
	}
	defer resp.Body.Close()
	return nil
}

func (c *APISixClient) CreateRoute(ctx context.Context, routeID string, route APISixRoute) error {
	upstream := map[string]interface{}{
		"type": "roundrobin",
		"nodes": map[string]int{
			route.UpstreamURL: 1,
		},
		"retry_timeout": 3,
		"retries":       2,
		"checks": map[string]interface{}{
			"active": map[string]interface{}{
				"type":      "http",
				"http_path": "/health",
				"healthy": map[string]interface{}{
					"interval":  5,
					"successes": 2,
				},
				"unhealthy": map[string]interface{}{
					"interval":      3,
					"http_failures": 3,
				},
			},
		},
	}
	body := map[string]interface{}{
		"uri":      route.URI,
		"name":     route.Name,
		"methods":  route.Methods,
		"upstream": upstream,
	}
	if route.Plugins != nil {
		body["plugins"] = route.Plugins
	}
	return c.putAdmin(ctx, "/apisix/admin/routes/"+routeID, body)
}

// RegisterPlatformRoutes registers routes for all platform services.
func (c *APISixClient) RegisterPlatformRoutes(ctx context.Context) error {
	routes := []struct {
		id    string
		route APISixRoute
	}{
		{"policy-svc", APISixRoute{URI: "/api/v1/policies/*", Name: "policy-service", Methods: []string{"GET", "POST", "PUT", "DELETE"}, UpstreamURL: "policy-service:8081"}},
		{"claims-svc", APISixRoute{URI: "/api/v1/claims/*", Name: "claims-service", Methods: []string{"GET", "POST", "PUT"}, UpstreamURL: "claims-service:8082"}},
		{"payment-svc", APISixRoute{URI: "/api/v1/payments/*", Name: "payment-service", Methods: []string{"GET", "POST"}, UpstreamURL: "payment-service:8083"}},
		{"customer-svc", APISixRoute{URI: "/api/v1/customers/*", Name: "customer-service", Methods: []string{"GET", "POST", "PUT"}, UpstreamURL: "customer-service:8084"}},
		{"kyc-svc", APISixRoute{URI: "/api/v1/kyc/*", Name: "kyc-orchestrator", Methods: []string{"GET", "POST"}, UpstreamURL: "kyc-orchestrator:8085"}},
		{"kyb-svc", APISixRoute{URI: "/api/v1/kyb/*", Name: "kyb-service", Methods: []string{"GET", "POST"}, UpstreamURL: "kyc-orchestrator:8085"}},
		{"fraud-svc", APISixRoute{URI: "/api/v1/fraud/*", Name: "fraud-detection", Methods: []string{"GET", "POST"}, UpstreamURL: "fraud-detection:8020"}},
		{"actuarial-svc", APISixRoute{URI: "/api/v1/actuarial/*", Name: "actuarial-service", Methods: []string{"GET", "POST"}, UpstreamURL: "actuarial-service:8091"}},
		{"reinsurance-svc", APISixRoute{URI: "/api/v1/reinsurance/*", Name: "reinsurance-service", Methods: []string{"GET", "POST"}, UpstreamURL: "reinsurance-service:8096"}},
		{"analytics-svc", APISixRoute{URI: "/api/v1/analytics/*", Name: "analytics-service", Methods: []string{"GET", "POST"}, UpstreamURL: "analytics-service:8098"}},
		{"underwriting-svc", APISixRoute{URI: "/api/v1/underwriting/*", Name: "underwriting-service", Methods: []string{"GET", "POST"}, UpstreamURL: "underwriting-service:8102"}},
		{"document-svc", APISixRoute{URI: "/api/v1/documents/*", Name: "document-service", Methods: []string{"GET", "POST"}, UpstreamURL: "document-service:8101"}},
		{"notification-svc", APISixRoute{URI: "/api/v1/notifications/*", Name: "notification-service", Methods: []string{"GET", "POST"}, UpstreamURL: "notification-service:8100"}},
		{"mobile-money-svc", APISixRoute{URI: "/api/v1/mobile-money/*", Name: "mobile-money-service", Methods: []string{"GET", "POST"}, UpstreamURL: "mobile-money-service:8106"}},
		{"ussd-svc", APISixRoute{URI: "/api/v1/ussd/*", Name: "ussd-gateway", Methods: []string{"GET", "POST"}, UpstreamURL: "ussd-gateway:8108"}},
		{"liveness-svc", APISixRoute{URI: "/api/v1/liveness/*", Name: "liveness-engine", Methods: []string{"POST"}, UpstreamURL: "liveness-engine:8110"}},
		{"ocr-svc", APISixRoute{URI: "/api/v1/ocr/*", Name: "ocr-engine", Methods: []string{"POST"}, UpstreamURL: "ocr-engine:8111"}},
		{"lakehouse-svc", APISixRoute{URI: "/api/v1/lakehouse/*", Name: "lakehouse-api", Methods: []string{"GET", "POST"}, UpstreamURL: "lakehouse-api:8120"}},
		{"ai-ml-svc", APISixRoute{URI: "/api/v1/ml/*", Name: "ai-ml-platform", Methods: []string{"GET", "POST"}, UpstreamURL: "ai-ml-platform:8130"}},
	}

	for _, r := range routes {
		r.route.Plugins = c.defaultPlugins()
		if err := c.CreateRoute(ctx, r.id, r.route); err != nil {
			c.logger.Warn("route_registration_failed", zap.String("route", r.id), zap.Error(err))
		}
	}
	return nil
}

func (c *APISixClient) defaultPlugins() map[string]interface{} {
	return map[string]interface{}{
		"limit-req": map[string]interface{}{
			"rate":          100,
			"burst":         50,
			"rejected_code": 429,
			"key_type":      "var",
			"key":           "remote_addr",
		},
		"cors": map[string]interface{}{
			"allow_origins": "*",
			"allow_methods": "GET,POST,PUT,DELETE,OPTIONS",
			"allow_headers": "Content-Type,Authorization,X-KYC-Session-ID,X-Request-ID",
		},
		"ip-restriction": map[string]interface{}{
			"message": "Access denied by IP restriction",
		},
		"prometheus": map[string]interface{}{},
	}
}

func (c *APISixClient) SetupOIDCPlugin(ctx context.Context, routeID string, keycloakURL, clientID, clientSecret string) error {
	plugin := map[string]interface{}{
		"openid-connect": map[string]interface{}{
			"client_id":             clientID,
			"client_secret":         clientSecret,
			"discovery":             keycloakURL + "/.well-known/openid-configuration",
			"bearer_only":           true,
			"realm":                 "insurance",
			"introspection_endpoint": keycloakURL + "/protocol/openid-connect/token/introspect",
		},
	}
	return c.patchRoutePlugins(ctx, routeID, plugin)
}

func (c *APISixClient) SetupWAFPlugin(ctx context.Context, routeID string) error {
	plugin := map[string]interface{}{
		"openappsec": map[string]interface{}{
			"mode":              "prevent",
			"security_level":    "high",
			"log_level":         "info",
			"block_response":    map[string]interface{}{"code": 403, "body": `{"error":"blocked by WAF"}`},
		},
	}
	return c.patchRoutePlugins(ctx, routeID, plugin)
}

func (c *APISixClient) putAdmin(ctx context.Context, path string, body interface{}) error {
	data, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, "PUT", c.adminURL+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("X-API-KEY", c.apiKey)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("apisix admin %s failed (%d): %s", path, resp.StatusCode, string(body))
	}
	return nil
}

func (c *APISixClient) patchRoutePlugins(ctx context.Context, routeID string, plugins map[string]interface{}) error {
	return c.putAdmin(ctx, "/apisix/admin/routes/"+routeID, map[string]interface{}{"plugins": plugins})
}
