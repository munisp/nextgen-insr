package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

type APISixClient struct {
	baseURL string
	apiKey  string
	client  *http.Client
}

func NewAPISixClient() *APISixClient {
	addr := os.Getenv("APISIX_ADMIN_URL")
	if addr == "" {
		addr = "http://localhost:9180"
	}
	return &APISixClient{
		baseURL: addr,
		apiKey:  os.Getenv("APISIX_ADMIN_KEY"),
		client:  &http.Client{Timeout: 10 * time.Second},
	}
}

type Route struct {
	ID       string                 `json:"id,omitempty"`
	URI      string                 `json:"uri"`
	Name     string                 `json:"name"`
	Methods  []string               `json:"methods,omitempty"`
	Upstream Upstream               `json:"upstream"`
	Plugins  map[string]interface{} `json:"plugins,omitempty"`
	Status   int                    `json:"status,omitempty"`
}

type Upstream struct {
	Type  string         `json:"type"`
	Nodes map[string]int `json:"nodes"`
}

func (a *APISixClient) CreateRoute(ctx context.Context, route Route) error {
	body, _ := json.Marshal(route)
	url := fmt.Sprintf("%s/apisix/admin/routes/%s", a.baseURL, route.ID)
	req, err := http.NewRequestWithContext(ctx, "PUT", url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-KEY", a.apiKey)

	resp, err := a.client.Do(req)
	if err != nil {
		return fmt.Errorf("apisix create route: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.ReadAll(resp.Body)
	return nil
}

func (a *APISixClient) RegisterService(ctx context.Context, name string, host string, port int) error {
	route := Route{
		ID:   name,
		URI:  fmt.Sprintf("/api/v1/%s/*", name),
		Name: name,
		Upstream: Upstream{
			Type:  "roundrobin",
			Nodes: map[string]int{fmt.Sprintf("%s:%d", host, port): 1},
		},
		Plugins: map[string]interface{}{
			"openid-connect": map[string]interface{}{
				"client_id":     os.Getenv("KEYCLOAK_CLIENT_ID"),
				"client_secret": os.Getenv("KEYCLOAK_CLIENT_SECRET"),
				"discovery":     fmt.Sprintf("%s/realms/%s/.well-known/openid-configuration", os.Getenv("KEYCLOAK_URL"), os.Getenv("KEYCLOAK_REALM")),
			},
			"limit-req": map[string]interface{}{
				"rate":  100,
				"burst": 50,
				"key":   "remote_addr",
			},
		},
	}
	return a.CreateRoute(ctx, route)
}
