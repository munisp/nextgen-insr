package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"premium-collection-service/config"
)

// RedisCache wraps go-redis with domain-specific cache operations
type RedisCache struct {
	Client *redis.Client
}

// NewRedisCache creates a new cache client from config
func NewRedisCache(ctx context.Context, cfg *config.RedisConfig) (*RedisCache, error) {
	client := redis.NewClient(&redis.Options{
		Addr:         cfg.RedisAddr(),
		Password:     cfg.Password,
		DB:           cfg.DB,
		MaxRetries:   cfg.MaxRetries,
		PoolSize:     cfg.PoolSize,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
	})

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("ping redis: %w", err)
	}

	return &RedisCache{Client: client}, nil
}

// Close closes the Redis connection
func (r *RedisCache) Close() error {
	return r.Client.Close()
}

// Key prefixes
const (
	PrefixPayment     = "pc:payment:"
	PrefixReceipt     = "pc:receipt:"
	PrefixInstallment = "pc:installment:"
	PrefixStats       = "pc:stats:"
	PrefixDunning     = "pc:dunning:"
	PrefixAutoDebit   = "pc:autodebit:"
	PrefixLock        = "pc:lock:"
	PrefixSession     = "pc:session:"
)

// CacheTTL values
const (
	TCacheShort  = 5 * time.Minute
	TCacheMedium = 30 * time.Minute
	TCacheLong   = 2 * time.Hour
	TCacheDaily  = 24 * time.Hour
)

// CachePayment stores a payment record in cache
func (r *RedisCache) CachePayment(ctx context.Context, payment *PaymentDB, ttl time.Duration) error {
	key := PrefixPayment + payment.ID
	data, err := json.Marshal(payment)
	if err != nil {
		return fmt.Errorf("marshal payment: %w", err)
	}
	return r.Client.Set(ctx, key, data, ttl).Err()
}

// GetCachedPayment retrieves a payment from cache
func (r *RedisCache) GetCachedPayment(ctx context.Context, id string) (*PaymentDB, error) {
	key := PrefixPayment + id
	data, err := r.Client.Get(ctx, key).Bytes()
	if err != nil {
		return nil, err // redis.Nil means cache miss
	}
	var payment PaymentDB
	if err := json.Unmarshal(data, &payment); err != nil {
		return nil, fmt.Errorf("unmarshal payment: %w", err)
	}
	return &payment, nil
}

// InvalidatePayment removes a payment from cache
func (r *RedisCache) InvalidatePayment(ctx context.Context, id string) error {
	return r.Client.Del(ctx, PrefixPayment+id).Err()
}

// CacheReceipt stores a payment receipt in cache
func (r *RedisCache) CacheReceipt(ctx context.Context, receiptID string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixReceipt+receiptID, data, ttl).Err()
}

// GetCachedReceipt retrieves a receipt from cache
func (r *RedisCache) GetCachedReceipt(ctx context.Context, receiptID string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixReceipt+receiptID).Bytes()
}

// CacheInstallmentPlan stores an installment plan in cache
func (r *RedisCache) CacheInstallmentPlan(ctx context.Context, planID string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixInstallment+planID, data, ttl).Err()
}

// GetCachedInstallmentPlan retrieves an installment plan from cache
func (r *RedisCache) GetCachedInstallmentPlan(ctx context.Context, planID string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixInstallment+planID).Bytes()
}

// InvalidateInstallmentPlan removes an installment plan from cache
func (r *RedisCache) InvalidateInstallmentPlan(ctx context.Context, planID string) error {
	return r.Client.Del(ctx, PrefixInstallment+planID).Err()
}

// CacheStats caches collection statistics
func (r *RedisCache) CacheStats(ctx context.Context, period string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixStats+period, data, ttl).Err()
}

// GetCachedStats retrieves cached statistics
func (r *RedisCache) GetCachedStats(ctx context.Context, period string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixStats+period).Bytes()
}

// AcquireLock acquires a distributed lock with automatic expiry
func (r *RedisCache) AcquireLock(ctx context.Context, resource string, ttl time.Duration) error {
	key := PrefixLock + resource
	return r.Client.SetNX(ctx, key, "locked", ttl).Err()
}

// ReleaseLock releases a distributed lock
func (r *RedisCache) ReleaseLock(ctx context.Context, resource string) error {
	return r.Client.Del(ctx, PrefixLock+resource).Err()
}

// IncrementStatsAtomically atomically increments a stats counter
func (r *RedisCache) IncrementStatsAtomically(ctx context.Context, key string, amount int64) (int64, error) {
	return r.Client.IncrBy(ctx, PrefixStats+key, amount).Result()
}

// GetStatsValue retrieves a stats counter
func (r *RedisCache) GetStatsValue(ctx context.Context, key string) (int64, error) {
	return r.Client.Get(ctx, PrefixStats+key).Int64()
}

// SetSession creates or updates a user session
func (r *RedisCache) SetSession(ctx context.Context, sessionID, data string, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixSession+sessionID, data, ttl).Err()
}

// GetSession retrieves a user session
func (r *RedisCache) GetSession(ctx context.Context, sessionID string) (string, error) {
	return r.Client.Get(ctx, PrefixSession+sessionID).Result()
}

// DeleteSession removes a user session
func (r *RedisCache) DeleteSession(ctx context.Context, sessionID string) error {
	return r.Client.Del(ctx, PrefixSession+sessionID).Err()
}

// SetDunningRecord stores a dunning record in cache
func (r *RedisCache) SetDunningRecord(ctx context.Context, recordID string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixDunning+recordID, data, ttl).Err()
}

// GetDunningRecord retrieves a dunning record from cache
func (r *RedisCache) GetDunningRecord(ctx context.Context, recordID string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixDunning+recordID).Bytes()
}

// SetAutoDebitConfig stores auto-debit config in cache
func (r *RedisCache) SetAutoDebitConfig(ctx context.Context, policyID string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixAutoDebit+policyID, data, ttl).Err()
}

// GetAutoDebitConfig retrieves auto-debit config from cache
func (r *RedisCache) GetAutoDebitConfig(ctx context.Context, policyID string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixAutoDebit+policyID).Bytes()
}

// InvalidateAutoDebitConfig removes auto-debit config from cache
func (r *RedisCache) InvalidateAutoDebitConfig(ctx context.Context, policyID string) error {
	return r.Client.Del(ctx, PrefixAutoDebit+policyID).Err()
}

// PublishPaymentEvent publishes a payment event to a Redis stream
func (r *RedisCache) PublishPaymentEvent(ctx context.Context, event map[string]interface{}) error {
	return r.Client.XAdd(ctx, &redis.XAddArgs{
		Stream: "pc:events:payments",
		Values: event,
	}).Err()
}

// StreamPaymentEvents reads recent payment events from a Redis stream
func (r *RedisCache) StreamPaymentEvents(ctx context.Context, count int) ([]*redis.XMessage, error) {
	streams, err := r.Client.XRead(ctx, &redis.XReadArgs{
		Streams: []string{"pc:events:payments", "0"},
		Count:   int64(count),
	}).Result()
	if err != nil {
		return nil, err
	}
	if len(streams) == 0 {
		return nil, nil
	}
	messages := make([]*redis.XMessage, 0, len(streams[0].Messages))
	for i := range streams[0].Messages {
		messages = append(messages, &streams[0].Messages[i])
	}
	return messages, nil
}
