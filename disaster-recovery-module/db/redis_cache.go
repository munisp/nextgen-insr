package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/insureportal/disaster_recovery_module/config"
	"github.com/insureportal/disaster_recovery_module/models"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// RedisCache provides caching layer for DR service
type RedisCache struct {
	client *redis.Client
}

// NewRedisCache creates a new Redis connection
func NewRedisCache(cfg *config.Config) (*RedisCache, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:         cfg.RedisAddr,
		Password:     cfg.RedisPass,
		DB:           cfg.RedisDB,
		MaxRetries:   cfg.RedisMaxRetries,
		DialTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
	})

	if err := rdb.Ping(context.Background()).Err(); err != nil {
		return nil, fmt.Errorf("failed to ping redis: %w", err)
	}

	zap.L().Info("Redis connected successfully", zap.String("addr", cfg.RedisAddr))

	return &RedisCache{client: rdb}, nil
}

// Close closes the Redis connection
func (r *RedisCache) Close() error {
	return r.client.Close()
}

// Cache keys
const (
	// Cache TTLs
	KeyHeartbeatTTL   = 5 * time.Minute  // Heartbeat TTL - 5 minutes
	KeyDashboardTTL   = 30 * time.Second // Dashboard cached for 30 seconds
	KeyServiceStatus  = 2 * time.Minute  // Per-service status cache
	KeyFailoverLock   = 10 * time.Minute // Failover operation lock
	KeyBackupStatus   = 1 * time.Hour    // Backup status cache
	KeyDrillSchedule  = 24 * time.Hour   // Drill schedule cache
)

const (
	keyPrefix = "dr:"
)

// Service health key patterns
func heartbeatKey(serviceName, instanceID string) string {
	return fmt.Sprintf("%sheartbeat:%s:%s", keyPrefix, serviceName, instanceID)
}
func serviceStatusKey(serviceName string) string {
	return fmt.Sprintf("%sservice:status:%s", keyPrefix, serviceName)
}
func dashboardKey() string {
	return fmt.Sprintf("%sdashboard", keyPrefix)
}
func failoverLockKey() string {
	return fmt.Sprintf("%sfailover:lock", keyPrefix)
}
func backupStatusKey() string {
	return fmt.Sprintf("%sbackup:latest", keyPrefix)
}
func replicationLagKey() string {
	return fmt.Sprintf("%sreplication:lag", keyPrefix)
}

// RecordHeartbeat records a service heartbeat in Redis with TTL
func (r *RedisCache) RecordHeartbeat(ctx context.Context, serviceName, instanceID string, isHealthy bool, responseMs int) error {
	data := map[string]interface{}{
		"service_name":  serviceName,
		"instance_id":   instanceID,
		"is_healthy":    isHealthy,
		"response_ms":   responseMs,
		"timestamp":     time.Now().Format(time.RFC3339),
	}
	key := heartbeatKey(serviceName, instanceID)
	val, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("failed to marshal heartbeat: %w", err)
	}

	if err := r.client.Set(ctx, key, val, KeyHeartbeatTTL).Err(); err != nil {
		return fmt.Errorf("failed to set heartbeat: %w", err)
	}
	return nil
}

// GetLatestHeartbeat retrieves the latest heartbeat for a service
func (r *RedisCache) GetLatestHeartbeat(ctx context.Context, serviceName, instanceID string) (map[string]interface{}, error) {
	key := heartbeatKey(serviceName, instanceID)
	val, err := r.client.Get(ctx, key).Result()
	if err == redis.Nil {
		return nil, nil
	} else if err != nil {
		return nil, err
	}

	var data map[string]interface{}
	if err := json.Unmarshal([]byte(val), &data); err != nil {
		return nil, err
	}
	return data, nil
}

// SetServiceStatus caches a service's status
func (r *RedisCache) SetServiceStatus(ctx context.Context, status *models.ServiceHealthStatus) error {
	key := serviceStatusKey(status.ServiceName)
	val, err := json.Marshal(status)
	if err != nil {
		return err
	}
	return r.client.Set(ctx, key, val, KeyServiceStatus).Err()
}

// GetServiceStatus retrieves cached service status
func (r *RedisCache) GetServiceStatus(ctx context.Context, serviceName string) (*models.ServiceHealthStatus, error) {
	key := serviceStatusKey(serviceName)
	val, err := r.client.Get(ctx, key).Result()
	if err == redis.Nil {
		return nil, nil
	} else if err != nil {
		return nil, err
	}

	var status models.ServiceHealthStatus
	if err := json.Unmarshal([]byte(val), &status); err != nil {
		return nil, err
	}
	return &status, nil
}

// CacheDashboard caches the DR dashboard data
func (r *RedisCache) CacheDashboard(ctx context.Context, dashboard *models.DRDashboard) error {
	key := dashboardKey()
	val, err := json.Marshal(dashboard)
	if err != nil {
		return err
	}
	return r.client.Set(ctx, key, val, KeyDashboardTTL).Err()
}

// GetCachedDashboard retrieves cached dashboard
func (r *RedisCache) GetCachedDashboard(ctx context.Context) (*models.DRDashboard, error) {
	key := dashboardKey()
	val, err := r.client.Get(ctx, key).Result()
	if err == redis.Nil {
		return nil, nil
	} else if err != nil {
		return nil, err
	}

	var dashboard models.DRDashboard
	if err := json.Unmarshal([]byte(val), &dashboard); err != nil {
		return nil, err
	}
	return &dashboard, nil
}

// AcquireFailoverLock acquires an exclusive lock for failover operations
// Returns true if lock was acquired, false if already held
func (r *RedisCache) AcquireFailoverLock(ctx context.Context, requester string) (bool, error) {
	key := failoverLockKey()
	// Use SET NX with expiry to acquire lock
	acquired, err := r.client.SetNX(ctx, key, requester, KeyFailoverLock).Result()
	if err != nil {
		return false, err
	}

	if acquired {
		zap.L().Info("Failover lock acquired", zap.String("requester", requester))
	} else {
		existing, err := r.client.Get(ctx, key).Result()
		if err == nil {
			zap.L().Warn("Failover lock already held", zap.String("holder", existing))
		}
	}
	return acquired, nil
}

// ReleaseFailoverLock releases the failover lock
func (r *RedisCache) ReleaseFailoverLock(ctx context.Context, requester string) error {
	key := failoverLockKey()
	current, err := r.client.Get(ctx, key).Result()
	if err == redis.Nil {
		return nil // No lock to release
	}
	if current != requester {
		return fmt.Errorf("cannot release lock held by '%s'", current)
	}
	return r.client.Del(ctx, key).Err()
}

// SetReplicationLag caches the current replication lag
func (r *RedisCache) SetReplicationLag(ctx context.Context, lagSeconds float64) error {
	key := replicationLagKey()
	return r.client.Set(ctx, key, lagSeconds, KeyHeartbeatTTL).Err()
}

// GetReplicationLag retrieves cached replication lag
func (r *RedisCache) GetReplicationLag(ctx context.Context) (float64, error) {
	key := replicationLagKey()
	val, err := r.client.Get(ctx, key).Result()
	if err == redis.Nil {
		return 0, nil
	}
	return r.client.GetFloat64(ctx, key)
}

// CacheLatestBackup caches the latest backup status
func (r *RedisCache) CacheLatestBackup(ctx context.Context, backup *models.BackupStatus) error {
	key := backupStatusKey()
	val, err := json.Marshal(backup)
	if err != nil {
		return err
	}
	return r.client.Set(ctx, key, val, KeyBackupStatus).Err()
}

// GetCachedBackup retrieves cached backup status
func (r *RedisCache) GetCachedBackup(ctx context.Context) (*models.BackupStatus, error) {
	key := backupStatusKey()
	val, err := r.client.Get(ctx, key).Result()
	if err == redis.Nil {
		return nil, nil
	}

	var backup models.BackupStatus
	if err := json.Unmarshal([]byte(val), &backup); err != nil {
		return nil, err
	}
	return &backup, nil
}

// PublishFailoverEvent publishes a failover event to Redis for real-time notification
func (r *RedisCache) PublishFailoverEvent(ctx context.Context, event models.FailoverEvent) error {
	channel := "dr:failover_events"
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return r.client.Publish(ctx, channel, data).Err()
}

// IncrementCounter increments a named counter (used for stats tracking)
func (r *RedisCache) IncrementCounter(ctx context.Context, name string, delta int64) error {
	key := fmt.Sprintf("%scounter:%s", keyPrefix, name)
	_, err := r.client.IncrBy(ctx, key, delta).Result()
	if err == nil {
		r.client.Expire(ctx, key, 24*time.Hour)
	}
	return err
}

// GetCounter retrieves a named counter
func (r *RedisCache) GetCounter(ctx context.Context, name string) (int64, error) {
	key := fmt.Sprintf("%scounter:%s", keyPrefix, name)
	return r.client.Get(ctx, key).Int64()
}

// SetDrillSchedule caches the next scheduled drill date
func (r *RedisCache) SetDrillSchedule(ctx context.Context, nextDrillDate string) error {
	key := fmt.Sprintf("%sdrill:next", keyPrefix)
	return r.client.Set(ctx, key, nextDrillDate, KeyDrillSchedule).Err()
}

// GetDrillSchedule retrieves the next scheduled drill date
func (r *RedisCache) GetDrillSchedule(ctx context.Context) (string, error) {
	key := fmt.Sprintf("%sdrill:next", keyPrefix)
	return r.client.Get(ctx, key).Result()
}

// PublishNotification publishes a real-time DR event to subscribers
func (r *RedisCache) PublishNotification(ctx context.Context, eventType string, data interface{}) error {
	channel := fmt.Sprintf("dr:events:%s", eventType)
	val, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return r.client.Publish(ctx, channel, val).Err()
}

// ZAddWithExpiry adds a member to a sorted set with expiry (for time-series data)
func (r *RedisCache) ZAddWithExpiry(ctx context.Context, key, member string, score float64, ttl time.Duration) error {
	err := r.client.ZAdd(ctx, key, redis.Z{
		Score:  score,
		Member: member,
	}).Err()
	if err == nil {
		r.client.Expire(ctx, key, ttl)
	}
	return err
}
