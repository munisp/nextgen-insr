// Package keycloak provides a Go client for the keycloak service.
package keycloak

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"

	"go.uber.org/zap"
)

// Client is the keycloak HTTP client
type Client struct {
	logger     *zap.Logger
	endpoint   string
	httpClient *http.Client
}

// NewClient creates a new keycloak client
func NewClient(logger *zap.Logger) *Client {
	endpoint := getEnv("KEYCLOAK_ENDPOINT", "http://keycloak:8080")
	return &Client{
		logger:     logger,
		endpoint:   endpoint,
		httpClient: &http.Client{},
	}
}

// Ping checks keycloak availability
func (c *Client) Ping(ctx context.Context) string {
	req, err := http.NewRequestWithContext(ctx, "GET", c.endpoint+"/health", nil)
	if err != nil {
		return "error"
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "unreachable"
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusOK {
		return "ok"
	}
	return fmt.Sprintf("http_%d", resp.StatusCode)
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v != nil {
		json.NewEncoder(w).Encode(v)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (c *Client) IntrospectTokenHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	writeJSON(w, http.StatusOK, map[string]interface{}{"active": true, "token": req.Token})
}
func (c *Client) RefreshTokenHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "refreshed"})
}
func (c *Client) GetUserHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"id": r.PathValue("userId")})
}
func (c *Client) AssignRoleHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNoContent, nil)
}
func (c *Client) RemoveRoleHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNoContent, nil)
}
func (c *Client) GetUserRolesHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{"roles": []string{}})
}
func (c *Client) CreateUserHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusCreated, map[string]string{"status": "created"})
}
func (c *Client) UpdateUserHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}
func (c *Client) LogoutUserHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNoContent, nil)
}
