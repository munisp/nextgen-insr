package middleware

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

type KeycloakConfig struct {
	RealmURL     string
	ClientID     string
	ClientSecret string
	AdminURL     string
}

type KeycloakMiddleware struct {
	config     KeycloakConfig
	httpClient *http.Client
	logger     *zap.Logger
}

type TokenClaims struct {
	Sub            string   `json:"sub"`
	Email          string   `json:"email"`
	Name           string   `json:"name"`
	RealmAccess    struct {
		Roles []string `json:"roles"`
	} `json:"realm_access"`
	ResourceAccess map[string]struct {
		Roles []string `json:"roles"`
	} `json:"resource_access"`
	KYCLevel       int    `json:"kyc_level"`
	KYCStatus      string `json:"kyc_status"`
	KYCSessionID   string `json:"kyc_session_id"`
}

func NewKeycloakMiddleware(logger *zap.Logger, config KeycloakConfig) *KeycloakMiddleware {
	if config.RealmURL == "" {
		config.RealmURL = "http://localhost:8180/realms/insurance"
	}
	if config.ClientID == "" {
		config.ClientID = "kyc-service"
	}

	return &KeycloakMiddleware{
		config:     config,
		httpClient: &http.Client{Timeout: 5 * time.Second},
		logger:     logger,
	}
}

func (k *KeycloakMiddleware) AuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			c.Abort()
			return
		}

		token := strings.TrimPrefix(authHeader, "Bearer ")
		if token == authHeader {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Bearer token required"})
			c.Abort()
			return
		}

		claims, err := k.validateToken(token)
		if err != nil {
			k.logger.Debug("token_validation_failed", zap.Error(err))
			c.Set("user_id", "anonymous")
			c.Set("kyc_level", 0)
			c.Next()
			return
		}

		c.Set("user_id", claims.Sub)
		c.Set("email", claims.Email)
		c.Set("name", claims.Name)
		c.Set("kyc_level", claims.KYCLevel)
		c.Set("kyc_status", claims.KYCStatus)
		c.Set("roles", claims.RealmAccess.Roles)
		c.Next()
	}
}

func (k *KeycloakMiddleware) KYCLevelRequired(minLevel int) gin.HandlerFunc {
	return func(c *gin.Context) {
		kycLevel, exists := c.Get("kyc_level")
		if !exists {
			c.JSON(http.StatusForbidden, gin.H{
				"error":          "KYC verification required",
				"required_level": minLevel,
				"current_level":  0,
				"action":         "complete_kyc",
				"redirect":       "/kyc-status",
			})
			c.Abort()
			return
		}

		level, ok := kycLevel.(int)
		if !ok || level < minLevel {
			c.JSON(http.StatusForbidden, gin.H{
				"error":          fmt.Sprintf("KYC Level %d required", minLevel),
				"required_level": minLevel,
				"current_level":  level,
				"action":         "upgrade_kyc",
				"redirect":       "/kyc-status",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

func (k *KeycloakMiddleware) RoleRequired(roles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		userRoles, exists := c.Get("roles")
		if !exists {
			c.JSON(http.StatusForbidden, gin.H{"error": "insufficient permissions"})
			c.Abort()
			return
		}

		roleList, ok := userRoles.([]string)
		if !ok {
			c.JSON(http.StatusForbidden, gin.H{"error": "invalid role data"})
			c.Abort()
			return
		}

		for _, required := range roles {
			for _, userRole := range roleList {
				if userRole == required {
					c.Next()
					return
				}
			}
		}

		c.JSON(http.StatusForbidden, gin.H{
			"error":          "insufficient role permissions",
			"required_roles": roles,
		})
		c.Abort()
	}
}

func (k *KeycloakMiddleware) validateToken(token string) (*TokenClaims, error) {
	url := fmt.Sprintf("%s/protocol/openid-connect/userinfo", k.config.RealmURL)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := k.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("keycloak unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token invalid: status %d", resp.StatusCode)
	}

	var claims TokenClaims
	if err := json.NewDecoder(resp.Body).Decode(&claims); err != nil {
		return nil, fmt.Errorf("decode claims: %w", err)
	}

	return &claims, nil
}

func (k *KeycloakMiddleware) UpdateUserKYCAttributes(userID string, kycLevel int, kycStatus, sessionID string) error {
	url := fmt.Sprintf("%s/admin/realms/insurance/users/%s", k.config.AdminURL, userID)
	payload := map[string]interface{}{
		"attributes": map[string][]string{
			"kyc_level":      {fmt.Sprintf("%d", kycLevel)},
			"kyc_status":     {kycStatus},
			"kyc_session_id": {sessionID},
			"kyc_verified_at": {time.Now().UTC().Format(time.RFC3339)},
		},
	}

	body, _ := json.Marshal(payload)
	req, err := http.NewRequest(http.MethodPut, url, strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := k.httpClient.Do(req)
	if err != nil {
		k.logger.Warn("keycloak_update_failed", zap.Error(err))
		return nil
	}
	defer resp.Body.Close()

	return nil
}
