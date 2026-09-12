// apisix-gateway — typed control-plane service over the REAL Apache APISIX
// Admin API (the platform's actual gateway, see infra/apisix and
// docker-compose.services.yaml). It manages routes, consumers and rate-limit
// policy, and probes upstream health.
//
// APISIX_ADMIN_URL and APISIX_ADMIN_KEY are REQUIRED for every Admin-API
// operation: without them, or when APISIX is unreachable, endpoints fail
// loud (503/502) with the real reason and /health is degraded. No route,
// consumer or health state is ever fabricated.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// Route is an APISIX route definition.
type Route struct {
	ID       string         `json:"id,omitempty"`
	Name     string         `json:"name"`
	URI      string         `json:"uri"`
	Methods  []string       `json:"methods,omitempty"`
	Upstream map[string]any `json:"upstream"`
	Plugins  map[string]any `json:"plugins,omitempty"`
}

// Consumer is an APISIX API consumer (key-auth credentials).
type Consumer struct {
	Username string         `json:"username"`
	Plugins  map[string]any `json:"plugins,omitempty"`
	Desc     string         `json:"desc,omitempty"`
}

// RateLimitConfig maps to the APISIX limit-count plugin.
type RateLimitConfig struct {
	Count          int    `json:"count"`
	TimeWindow     int    `json:"time_window"`
	RejectedCode   int    `json:"rejected_code"`
	Key            string `json:"key"` // remote_addr | consumer_name | server_addr
	Policy         string `json:"policy,omitempty"`
	ShowLimitQuota bool   `json:"show_limit_quota_header"`
}

// HealthCheck is APISIX upstream health-check configuration.
type HealthCheck struct {
	Active struct {
		HTTPPath string  `json:"http_path"`
		Timeout  float64 `json:"timeout"`
		Healthy  struct {
			Interval     int   `json:"interval"`
			Successes    int   `json:"successes"`
			HTTPStatuses []int `json:"http_statuses"`
		} `json:"healthy"`
		Unhealthy struct {
			Interval     int   `json:"interval"`
			HTTPFailures int   `json:"http_failures"`
			HTTPStatuses []int `json:"http_statuses"`
		} `json:"unhealthy"`
	} `json:"active"`
}

// APIGateway is a typed client for the APISIX Admin API.
type APIGateway struct {
	adminURL string
	adminKey string
	client   *http.Client
}

func NewAPIGateway(adminURL, adminKey string) *APIGateway {
	return &APIGateway{
		adminURL: strings.TrimRight(adminURL, "/"),
		adminKey: adminKey,
		client:   &http.Client{Timeout: 10 * time.Second},
	}
}

func (g *APIGateway) admin(method, path string, body any) (json.RawMessage, error) {
	if g.adminURL == "" || g.adminKey == "" {
		return nil, fmt.Errorf("APISIX_ADMIN_URL / APISIX_ADMIN_KEY not configured")
	}
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, g.adminURL+"/apisix/admin"+path, rdr)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-API-KEY", g.adminKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := g.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("apisix admin unreachable at %s: %w", g.adminURL, err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("apisix admin %s %s -> %d: %s", method, path, resp.StatusCode, truncate(string(b), 512))
	}
	return json.RawMessage(b), nil
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// CreateRoute registers a real route in APISIX.
func (g *APIGateway) CreateRoute(r Route) (json.RawMessage, error) {
	if r.ID != "" {
		return g.admin(http.MethodPut, "/routes/"+r.ID, r)
	}
	return g.admin(http.MethodPost, "/routes", r)
}

func (g *APIGateway) ListRoutes() (json.RawMessage, error) {
	return g.admin(http.MethodGet, "/routes", nil)
}

func (g *APIGateway) DeleteRoute(id string) (json.RawMessage, error) {
	return g.admin(http.MethodDelete, "/routes/"+id, nil)
}

// CreateConsumer registers a real API consumer.
func (g *APIGateway) CreateConsumer(c Consumer) (json.RawMessage, error) {
	return g.admin(http.MethodPut, "/consumers/"+c.Username, c)
}

func (g *APIGateway) ListConsumers() (json.RawMessage, error) {
	return g.admin(http.MethodGet, "/consumers", nil)
}

// ApplyRateLimit attaches a limit-count policy to an existing route.
func (g *APIGateway) ApplyRateLimit(routeID string, cfg RateLimitConfig) (json.RawMessage, error) {
	if cfg.RejectedCode == 0 {
		cfg.RejectedCode = 429
	}
	if cfg.Key == "" {
		cfg.Key = "remote_addr"
	}
	plugin := map[string]any{
		"limit-count": map[string]any{
			"count":                   cfg.Count,
			"time_window":             cfg.TimeWindow,
			"rejected_code":           cfg.RejectedCode,
			"key":                     cfg.Key,
			"show_limit_quota_header": true,
		},
	}
	if cfg.Policy != "" {
		plugin["limit-count"].(map[string]any)["policy"] = cfg.Policy
	}
	// merge into existing route
	raw, err := g.admin(http.MethodGet, "/routes/"+routeID, nil)
	if err != nil {
		return nil, err
	}
	var route map[string]any
	if err := json.Unmarshal(raw, &route); err != nil {
		return nil, fmt.Errorf("cannot parse route %s: %w", routeID, err)
	}
	node := route
	if v, ok := route["value"].(map[string]any); ok {
		node = v
	}
	plugins, _ := node["plugins"].(map[string]any)
	if plugins == nil {
		plugins = map[string]any{}
	}
	for k, v := range plugin {
		plugins[k] = v
	}
	node["plugins"] = plugins
	delete(node, "create_time")
	delete(node, "update_time")
	return g.admin(http.MethodPut, "/routes/"+routeID, node)
}

// UpstreamHealth returns the real upstream node health from APISIX.
func (g *APIGateway) UpstreamHealth() (json.RawMessage, error) {
	if g.adminURL == "" {
		return nil, fmt.Errorf("APISIX_ADMIN_URL not configured")
	}
	req, err := http.NewRequest(http.MethodGet, g.adminURL+"/v1/healthcheck", nil)
	if err != nil {
		return nil, err
	}
	resp, err := g.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("apisix healthcheck endpoint unreachable: %w", err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("apisix /v1/healthcheck -> %d: %s", resp.StatusCode, truncate(string(b), 256))
	}
	return json.RawMessage(b), nil
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func rawJSON(w http.ResponseWriter, code int, raw json.RawMessage) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_, _ = w.Write(raw)
}

func failLoud(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]string{"error": err.Error()})
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8098"
	}
	gw := NewAPIGateway(os.Getenv("APISIX_ADMIN_URL"), os.Getenv("APISIX_ADMIN_KEY"))

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if gw.adminURL == "" || gw.adminKey == "" {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "degraded", "reason": "APISIX_ADMIN_URL / APISIX_ADMIN_KEY not configured"})
			return
		}
		if _, err := gw.admin(http.MethodGet, "/routes", nil); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "degraded", "reason": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "apisix-gateway"})
	})

	mux.HandleFunc("/api/v1/routes", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			raw, err := gw.ListRoutes()
			if err != nil {
				failLoud(w, http.StatusBadGateway, err)
				return
			}
			rawJSON(w, http.StatusOK, raw)
		case http.MethodPost:
			var route Route
			if err := json.NewDecoder(r.Body).Decode(&route); err != nil || route.URI == "" || route.Upstream == nil {
				failLoud(w, http.StatusBadRequest, fmt.Errorf("route requires uri and upstream"))
				return
			}
			raw, err := gw.CreateRoute(route)
			if err != nil {
				failLoud(w, http.StatusBadGateway, err)
				return
			}
			rawJSON(w, http.StatusOK, raw)
		default:
			failLoud(w, http.StatusMethodNotAllowed, fmt.Errorf("GET or POST only"))
		}
	})

	mux.HandleFunc("/api/v1/routes/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/api/v1/routes/")
		if id == "" {
			failLoud(w, http.StatusBadRequest, fmt.Errorf("route id required"))
			return
		}
		if r.Method == http.MethodDelete {
			raw, err := gw.DeleteRoute(id)
			if err != nil {
				failLoud(w, http.StatusBadGateway, err)
				return
			}
			rawJSON(w, http.StatusOK, raw)
			return
		}
		failLoud(w, http.StatusMethodNotAllowed, fmt.Errorf("DELETE only"))
	})

	mux.HandleFunc("/api/v1/consumers", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			raw, err := gw.ListConsumers()
			if err != nil {
				failLoud(w, http.StatusBadGateway, err)
				return
			}
			rawJSON(w, http.StatusOK, raw)
		case http.MethodPost:
			var c Consumer
			if err := json.NewDecoder(r.Body).Decode(&c); err != nil || c.Username == "" {
				failLoud(w, http.StatusBadRequest, fmt.Errorf("consumer username required"))
				return
			}
			raw, err := gw.CreateConsumer(c)
			if err != nil {
				failLoud(w, http.StatusBadGateway, err)
				return
			}
			rawJSON(w, http.StatusOK, raw)
		default:
			failLoud(w, http.StatusMethodNotAllowed, fmt.Errorf("GET or POST only"))
		}
	})

	mux.HandleFunc("/api/v1/rate-limit", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			failLoud(w, http.StatusMethodNotAllowed, fmt.Errorf("POST only"))
			return
		}
		var body struct {
			RouteID string          `json:"route_id"`
			Config  RateLimitConfig `json:"config"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.RouteID == "" || body.Config.Count <= 0 || body.Config.TimeWindow <= 0 {
			failLoud(w, http.StatusBadRequest, fmt.Errorf("route_id and config.count/time_window required"))
			return
		}
		raw, err := gw.ApplyRateLimit(body.RouteID, body.Config)
		if err != nil {
			failLoud(w, http.StatusBadGateway, err)
			return
		}
		rawJSON(w, http.StatusOK, raw)
	})

	mux.HandleFunc("/api/v1/upstream-health", func(w http.ResponseWriter, r *http.Request) {
		raw, err := gw.UpstreamHealth()
		if err != nil {
			failLoud(w, http.StatusBadGateway, err)
			return
		}
		rawJSON(w, http.StatusOK, raw)
	})

	log.Printf("apisix-gateway listening on :%s (admin=%q)", port, gw.adminURL)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
