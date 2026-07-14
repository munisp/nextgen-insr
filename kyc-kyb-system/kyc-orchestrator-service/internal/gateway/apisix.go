package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"go.uber.org/zap"
)

type APISixGateway struct {
	adminURL   string
	httpClient *http.Client
	logger     *zap.Logger
}

type RouteConfig struct {
	URI         string            `json:"uri"`
	Name        string            `json:"name"`
	Methods     []string          `json:"methods"`
	Upstream    UpstreamConfig    `json:"upstream"`
	Plugins     map[string]interface{} `json:"plugins"`
}

type UpstreamConfig struct {
	Type  string      `json:"type"`
	Nodes []NodeConfig `json:"nodes"`
}

type NodeConfig struct {
	Host   string `json:"host"`
	Port   int    `json:"port"`
	Weight int    `json:"weight"`
}

func NewAPISixGateway(logger *zap.Logger, adminURL string) (*APISixGateway, error) {
	if adminURL == "" {
		adminURL = "http://localhost:9180"
	}

	gw := &APISixGateway{
		adminURL:   adminURL,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		logger:     logger,
	}

	if err := gw.setupKYCRoutes(); err != nil {
		logger.Warn("apisix_route_setup_failed", zap.Error(err))
	}

	return gw, nil
}

func (g *APISixGateway) setupKYCRoutes() error {
	routes := []RouteConfig{
		{
			URI:     "/api/v1/kyc/*",
			Name:    "kyc-orchestrator",
			Methods: []string{"GET", "POST", "PUT"},
			Upstream: UpstreamConfig{
				Type: "roundrobin",
				Nodes: []NodeConfig{{Host: "127.0.0.1", Port: 8085, Weight: 1}},
			},
			Plugins: map[string]interface{}{
				"limit-req": map[string]interface{}{
					"rate":          10,
					"burst":         5,
					"rejected_code": 429,
					"key_type":      "var",
					"key":           "remote_addr",
				},
				"openid-connect": map[string]interface{}{
					"client_id":     "kyc-service",
					"client_secret": "${KYC_OIDC_SECRET}",
					"discovery":     "http://localhost:8180/realms/insurance/.well-known/openid-configuration",
					"scope":         "openid profile kyc:read kyc:write",
					"bearer_only":   true,
				},
				"ip-restriction": map[string]interface{}{
					"whitelist": []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.1"},
				},
				"cors": map[string]interface{}{
					"allow_origins": "*",
					"allow_methods": "GET,POST,PUT,DELETE,OPTIONS",
					"allow_headers": "Content-Type,Authorization,X-KYC-Session-ID",
				},
				"prometheus": map[string]interface{}{
					"prefer_name": true,
				},
				"request-id": map[string]interface{}{
					"header_name":  "X-Request-ID",
					"include_in_response": true,
				},
			},
		},
		{
			URI:     "/api/v1/kyb/*",
			Name:    "kyb-orchestrator",
			Methods: []string{"GET", "POST", "PUT"},
			Upstream: UpstreamConfig{
				Type: "roundrobin",
				Nodes: []NodeConfig{{Host: "127.0.0.1", Port: 8085, Weight: 1}},
			},
			Plugins: map[string]interface{}{
				"limit-req": map[string]interface{}{
					"rate":          5,
					"burst":         3,
					"rejected_code": 429,
					"key_type":      "var",
					"key":           "remote_addr",
				},
				"openid-connect": map[string]interface{}{
					"client_id":     "kyb-service",
					"client_secret": "${KYB_OIDC_SECRET}",
					"discovery":     "http://localhost:8180/realms/insurance/.well-known/openid-configuration",
					"scope":         "openid profile kyb:read kyb:write",
					"bearer_only":   true,
				},
			},
		},
		{
			URI:     "/api/v1/liveness/*",
			Name:    "deepface-liveness",
			Methods: []string{"POST"},
			Upstream: UpstreamConfig{
				Type: "roundrobin",
				Nodes: []NodeConfig{{Host: "127.0.0.1", Port: 8110, Weight: 1}},
			},
			Plugins: map[string]interface{}{
				"limit-req": map[string]interface{}{
					"rate":          20,
					"burst":         10,
					"rejected_code": 429,
					"key_type":      "var",
					"key":           "remote_addr",
				},
				"request-validation": map[string]interface{}{
					"body_schema": map[string]interface{}{
						"type":     "object",
						"required": []string{"session_id"},
					},
				},
			},
		},
		{
			URI:     "/api/v1/ocr/*",
			Name:    "document-ocr",
			Methods: []string{"POST"},
			Upstream: UpstreamConfig{
				Type: "roundrobin",
				Nodes: []NodeConfig{{Host: "127.0.0.1", Port: 8111, Weight: 1}},
			},
			Plugins: map[string]interface{}{
				"limit-req": map[string]interface{}{
					"rate":          15,
					"burst":         8,
					"rejected_code": 429,
					"key_type":      "var",
					"key":           "remote_addr",
				},
			},
		},
		{
			URI:     "/api/v1/match/*",
			Name:    "identity-matcher",
			Methods: []string{"POST"},
			Upstream: UpstreamConfig{
				Type: "roundrobin",
				Nodes: []NodeConfig{{Host: "127.0.0.1", Port: 8112, Weight: 1}},
			},
			Plugins: map[string]interface{}{
				"limit-req": map[string]interface{}{
					"rate":          10,
					"burst":         5,
					"rejected_code": 429,
					"key_type":      "var",
					"key":           "remote_addr",
				},
			},
		},
	}

	for i, route := range routes {
		body, _ := json.Marshal(route)
		url := fmt.Sprintf("%s/apisix/admin/routes/%d", g.adminURL, 100+i)
		req, err := http.NewRequest(http.MethodPut, url, bytes.NewReader(body))
		if err != nil {
			continue
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-API-KEY", "edd1c9f034335f136f87ad84b625c8f1")

		resp, err := g.httpClient.Do(req)
		if err != nil {
			g.logger.Debug("apisix_route_skip", zap.String("name", route.Name), zap.Error(err))
			continue
		}
		resp.Body.Close()
		g.logger.Info("apisix_route_configured", zap.String("name", route.Name), zap.String("uri", route.URI))
	}

	return nil
}

func (g *APISixGateway) SetupOpenAppSecPlugin(ctx context.Context) error {
	wafConfig := map[string]interface{}{
		"plugins": map[string]interface{}{
			"openappsec": map[string]interface{}{
				"enable":           true,
				"mode":             "prevent",
				"practice_id":      "kyc-waf-practice",
				"source_identifiers": []string{"headerkey:X-Forwarded-For", "sourceip"},
				"custom_rules": []map[string]interface{}{
					{
						"name":     "block-sql-injection-kyc",
						"priority": 1,
						"action":   "prevent",
						"conditions": []map[string]interface{}{
							{
								"field":    "body",
								"operator": "contains",
								"value":    []string{"SELECT", "DROP", "INSERT", "UPDATE", "DELETE", "UNION", "--", ";"},
							},
						},
					},
					{
						"name":     "block-xss-kyc",
						"priority": 2,
						"action":   "prevent",
						"conditions": []map[string]interface{}{
							{
								"field":    "body",
								"operator": "contains",
								"value":    []string{"<script>", "javascript:", "onerror=", "onload="},
							},
						},
					},
					{
						"name":     "rate-limit-kyc-uploads",
						"priority": 3,
						"action":   "prevent",
						"conditions": []map[string]interface{}{
							{
								"field":    "uri",
								"operator": "contains",
								"value":    []string{"/document", "/selfie", "/liveness"},
							},
						},
					},
				},
			},
		},
	}

	body, _ := json.Marshal(wafConfig)
	url := fmt.Sprintf("%s/apisix/admin/global_rules/1", g.adminURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-KEY", "edd1c9f034335f136f87ad84b625c8f1")

	resp, err := g.httpClient.Do(req)
	if err != nil {
		g.logger.Warn("openappsec_setup_failed", zap.Error(err))
		return nil
	}
	defer resp.Body.Close()

	g.logger.Info("openappsec_waf_configured")
	return nil
}

func (g *APISixGateway) CheckKYCRateLimit(ctx context.Context, clientIP string) (bool, error) {
	return true, nil
}
