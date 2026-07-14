package infra

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"go.uber.org/zap"
)

type PermifyClient struct {
	baseURL    string
	tenantID   string
	httpClient *http.Client
	logger     *zap.Logger
}

func NewPermifyClient(logger *zap.Logger, baseURL, tenantID string) *PermifyClient {
	return &PermifyClient{
		baseURL:    baseURL,
		tenantID:   tenantID,
		httpClient: &http.Client{Timeout: 5 * time.Second},
		logger:     logger,
	}
}

func (c *PermifyClient) Ping(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/healthz", nil)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("permify ping: %w", err)
	}
	defer resp.Body.Close()
	return nil
}

// PlatformSchema returns the complete Permify authorization schema for the insurance platform.
func PlatformSchema() string {
	return `entity user {}

entity organization {
	relation admin @user
	relation member @user
	permission manage = admin
	permission view = admin or member
}

entity customer {
	relation owner @user
	relation agent @user
	relation organization @organization
	permission view = owner or agent or organization.admin
	permission edit = owner or organization.admin
	permission delete = organization.admin
}

entity policy {
	relation owner @user
	relation customer @customer
	relation underwriter @user
	relation organization @organization
	permission view = owner or customer.owner or underwriter or organization.member
	permission edit = underwriter or organization.admin
	permission approve = underwriter or organization.admin
	permission cancel = owner or organization.admin
}

entity claim {
	relation claimant @user
	relation policy @policy
	relation adjudicator @user
	relation organization @organization
	permission view = claimant or policy.owner or adjudicator or organization.member
	permission edit = adjudicator or organization.admin
	permission approve = adjudicator or organization.admin
	permission settle = organization.admin
}

entity payment {
	relation payer @user
	relation payee @user
	relation policy @policy
	relation organization @organization
	permission view = payer or payee or organization.member
	permission process = organization.admin
	permission refund = organization.admin
}

entity kyc_verification {
	relation subject @user
	relation reviewer @user
	relation organization @organization
	permission view = subject or reviewer or organization.admin
	permission review = reviewer or organization.admin
	permission approve = reviewer or organization.admin
}

entity kyb_verification {
	relation company @organization
	relation reviewer @user
	relation director @user
	permission view = director or reviewer or company.admin
	permission review = reviewer
	permission approve = reviewer
}

entity agent {
	relation user @user
	relation manager @user
	relation organization @organization
	permission view = user or manager or organization.admin
	permission manage = manager or organization.admin
	permission commission = user or organization.admin
}

entity document {
	relation owner @user
	relation organization @organization
	permission view = owner or organization.member
	permission edit = owner or organization.admin
	permission delete = organization.admin
}

entity report {
	relation creator @user
	relation organization @organization
	permission view = creator or organization.member
	permission export = organization.admin
}`
}

func (c *PermifyClient) WriteSchema(ctx context.Context) error {
	payload := map[string]interface{}{
		"schema": PlatformSchema(),
	}
	data, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/v1/tenants/%s/schemas/write", c.baseURL, c.tenantID), bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("write schema: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("schema write failed (%d): %s", resp.StatusCode, string(body))
	}
	return nil
}

func (c *PermifyClient) WriteRelationship(ctx context.Context, entityType, entityID, relation, subjectType, subjectID string) error {
	payload := map[string]interface{}{
		"metadata": map[string]string{"schema_version": ""},
		"tuples": []map[string]interface{}{
			{
				"entity":   map[string]string{"type": entityType, "id": entityID},
				"relation": relation,
				"subject":  map[string]string{"type": subjectType, "id": subjectID},
			},
		},
	}
	data, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/v1/tenants/%s/relationships/write", c.baseURL, c.tenantID), bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("write relationship: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("relationship write failed (%d): %s", resp.StatusCode, string(body))
	}
	return nil
}

func (c *PermifyClient) CheckPermission(ctx context.Context, entityType, entityID, permission, subjectType, subjectID string) (bool, error) {
	payload := map[string]interface{}{
		"metadata":   map[string]interface{}{"schema_version": "", "depth": 5},
		"entity":     map[string]string{"type": entityType, "id": entityID},
		"permission": permission,
		"subject":    map[string]string{"type": subjectType, "id": subjectID},
	}
	data, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/v1/tenants/%s/permissions/check", c.baseURL, c.tenantID), bytes.NewReader(data))
	if err != nil {
		return false, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		c.logger.Warn("permify_unavailable_denying", zap.String("entity", entityType), zap.String("permission", permission))
		return false, fmt.Errorf("permify unavailable: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return false, err
	}
	if can, ok := result["can"].(string); ok {
		return can == "CHECK_RESULT_ALLOWED", nil
	}
	return false, nil
}
