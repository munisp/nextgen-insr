package offline

import (
	"encoding/json"
	"time"
)

// SyncDirection indicates the direction of sync
type SyncDirection string

const (
	SyncPush SyncDirection = "push"
	SyncPull SyncDirection = "pull"
	SyncBoth SyncDirection = "both"
)

// SyncStatus represents the state of a sync operation
type SyncStatus string

const (
	SyncPending    SyncStatus = "pending"
	SyncInProgress SyncStatus = "in_progress"
	SyncCompleted  SyncStatus = "completed"
	SyncFailed     SyncStatus = "failed"
	SyncConflict   SyncStatus = "conflict"
)

// SyncRecord represents a single entity queued for sync
type SyncRecord struct {
	ID            string          `json:"id"`
	EntityType    string          `json:"entity_type"`
	EntityID      string          `json:"entity_id"`
	Direction     SyncDirection   `json:"direction"`
	Status        SyncStatus      `json:"status"`
	Payload       json.RawMessage `json:"payload"`
	LocalVersion  int64           `json:"local_version"`
	ServerVersion int64           `json:"server_version,omitempty"`
	CreatedAt     time.Time       `json:"created_at"`
	SyncedAt      *time.Time      `json:"synced_at,omitempty"`
	RetryCount    int             `json:"retry_count"`
	Error         string          `json:"error,omitempty"`
}

// SyncRequest is sent from mobile to server to push local changes
type SyncRequest struct {
	DeviceID      string       `json:"device_id"`
	LastSyncToken string       `json:"last_sync_token"`
	Changes       []SyncRecord `json:"changes"`
}

// SyncResponse is returned from server with remote changes
type SyncResponse struct {
	SyncToken string       `json:"sync_token"`
	Changes   []SyncRecord `json:"changes"`
	Conflicts []Conflict   `json:"conflicts,omitempty"`
	HasMore   bool         `json:"has_more"`
}

// Conflict represents a sync conflict that needs resolution
type Conflict struct {
	EntityType    string          `json:"entity_type"`
	EntityID      string          `json:"entity_id"`
	LocalVersion  json.RawMessage `json:"local_version"`
	ServerVersion json.RawMessage `json:"server_version"`
	Resolution    string          `json:"resolution,omitempty"`
}

// OfflineConfig configures offline sync behavior
type OfflineConfig struct {
	MaxRetries       int    `json:"max_retries"`
	RetryBackoffMs   int    `json:"retry_backoff_ms"`
	SyncIntervalMs   int    `json:"sync_interval_ms"`
	MaxBatchSize     int    `json:"max_batch_size"`
	ConflictStrategy string `json:"conflict_strategy"`
	CacheTTLSeconds  int    `json:"cache_ttl_seconds"`
}

// DefaultOfflineConfig returns sensible defaults for Nigerian market conditions
func DefaultOfflineConfig() *OfflineConfig {
	return &OfflineConfig{
		MaxRetries:       5,
		RetryBackoffMs:   2000,
		SyncIntervalMs:   30000,
		MaxBatchSize:     50,
		ConflictStrategy: "server_wins",
		CacheTTLSeconds:  86400,
	}
}

// SyncableEntities lists entity types that support offline sync
var SyncableEntities = []string{
	"policy",
	"claim",
	"customer",
	"quote",
	"payment",
	"lead",
	"kyc_application",
}
