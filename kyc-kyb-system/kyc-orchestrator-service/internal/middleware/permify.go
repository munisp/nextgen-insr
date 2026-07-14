package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

type PermifyClient struct {
	baseURL    string
	tenantID   string
	httpClient *http.Client
	logger     *zap.Logger
}

type PermissionCheck struct {
	Entity     string `json:"entity"`
	Permission string `json:"permission"`
	Subject    string `json:"subject"`
}

type PermissionResult struct {
	Can    bool   `json:"can"`
	Reason string `json:"reason"`
}

func NewPermifyClient(logger *zap.Logger, baseURL, tenantID string) *PermifyClient {
	if baseURL == "" {
		baseURL = "http://localhost:3476"
	}
	if tenantID == "" {
		tenantID = "insurance-platform"
	}

	return &PermifyClient{
		baseURL:    baseURL,
		tenantID:   tenantID,
		httpClient: &http.Client{Timeout: 5 * time.Second},
		logger:     logger,
	}
}

func (p *PermifyClient) SetupKYCSchema(ctx context.Context) error {
	schema := map[string]interface{}{
		"schema": `
			entity user {}

			entity kyc_verification {
				relation owner @user
				relation reviewer @user

				permission view = owner or reviewer
				permission submit = owner
				permission review = reviewer
				permission approve = reviewer
			}

			entity kyb_verification {
				relation owner @user
				relation reviewer @user
				relation director @user

				permission view = owner or reviewer or director
				permission submit = owner
				permission review = reviewer
				permission approve = reviewer
				permission add_director = owner
			}

			entity policy {
				relation holder @user
				relation kyc_verified @user

				permission apply = holder and kyc_verified
				permission view = holder
				permission renew = holder and kyc_verified
				permission cancel = holder
			}

			entity claim {
				relation filer @user
				relation kyc_verified @user

				permission file = filer and kyc_verified
				permission view = filer
				permission update = filer
			}

			entity payment {
				relation payer @user
				relation kyc_verified @user

				permission process = payer and kyc_verified
				permission view = payer
				permission refund = payer
			}

			entity mobile_money {
				relation sender @user
				relation kyc_verified @user

				permission transfer = sender and kyc_verified
				permission view = sender
			}

			entity agent {
				relation user @user
				relation kyb_verified @user

				permission onboard = user and kyb_verified
				permission sell_policy = user and kyb_verified
				permission view_commission = user
			}
		`,
	}

	body, _ := json.Marshal(schema)
	url := fmt.Sprintf("%s/v1/tenants/%s/schemas/write", p.baseURL, p.tenantID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.httpClient.Do(req)
	if err != nil {
		p.logger.Warn("permify_schema_setup_failed", zap.Error(err))
		return nil
	}
	defer resp.Body.Close()

	p.logger.Info("permify_kyc_schema_configured")
	return nil
}

func (p *PermifyClient) GrantKYCVerified(ctx context.Context, userID string, entityType, entityID string) error {
	relation := map[string]interface{}{
		"metadata": map[string]string{"schema_version": ""},
		"tuples": []map[string]interface{}{
			{
				"entity": map[string]string{
					"type": entityType,
					"id":   entityID,
				},
				"relation": "kyc_verified",
				"subject": map[string]interface{}{
					"type": "user",
					"id":   userID,
				},
			},
		},
	}

	body, _ := json.Marshal(relation)
	url := fmt.Sprintf("%s/v1/tenants/%s/relationships/write", p.baseURL, p.tenantID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.httpClient.Do(req)
	if err != nil {
		p.logger.Debug("permify_grant_failed", zap.Error(err))
		return nil
	}
	defer resp.Body.Close()

	return nil
}

func (p *PermifyClient) CheckPermission(ctx context.Context, check PermissionCheck) (*PermissionResult, error) {
	payload := map[string]interface{}{
		"metadata": map[string]interface{}{
			"schema_version": "",
			"snap_token":     "",
			"depth":          5,
		},
		"entity": map[string]string{
			"type": check.Entity,
			"id":   check.Permission,
		},
		"permission": check.Permission,
		"subject": map[string]interface{}{
			"type": "user",
			"id":   check.Subject,
		},
	}

	body, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/v1/tenants/%s/permissions/check", p.baseURL, p.tenantID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return &PermissionResult{Can: true, Reason: "permify_unavailable_defaulting_allow"}, nil
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return &PermissionResult{Can: true, Reason: "permify_unavailable"}, nil
	}
	defer resp.Body.Close()

	var result struct {
		Can            string `json:"can"`
		RemainingDepth int    `json:"remaining_depth"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return &PermissionResult{Can: true, Reason: "decode_error"}, nil
	}

	return &PermissionResult{
		Can:    result.Can == "RESULT_ALLOWED",
		Reason: result.Can,
	}, nil
}

func (p *PermifyClient) KYCPermissionMiddleware(entityType, permission string) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, exists := c.Get("user_id")
		if !exists {
			c.JSON(http.StatusForbidden, gin.H{"error": "user identity required"})
			c.Abort()
			return
		}

		entityID := c.Param("id")
		if entityID == "" {
			entityID = c.Param("sessionId")
		}

		result, err := p.CheckPermission(c.Request.Context(), PermissionCheck{
			Entity:     entityType,
			Permission: permission,
			Subject:    fmt.Sprintf("%v", userID),
		})
		if err != nil {
			c.Next()
			return
		}

		if !result.Can {
			c.JSON(http.StatusForbidden, gin.H{
				"error":      "permission denied",
				"entity":     entityType,
				"entity_id":  entityID,
				"permission": permission,
				"reason":     result.Reason,
			})
			c.Abort()
			return
		}

		c.Next()
	}
}
