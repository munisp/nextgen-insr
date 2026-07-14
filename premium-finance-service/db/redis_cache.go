package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/insureportal/premium-finance-service/config"
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
	PrefixApp      = "pf:app:"
	PrefixCredit   = "pf:credit:"
	PrefixSchedule = "pf:schedule:"
	PrefixCollateral = "pf:collateral:"
	PrefixSummary  = "pf:summary:"
	PrefixStats    = "pf:stats:"
	PrefixLock     = "pf:lock:"
)

const (
	TCacheShort = 5 * time.Minute
	TCacheMedium = 30 * time.Minute
	TCacheLong  = 2 * time.Hour
)

// CacheApplication stores a finance application in cache
func (r *RedisCache) CacheApplication(ctx context.Context, appID string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixApp+appID, data, ttl).Err()
}

// GetCachedApplication retrieves a finance application from cache
func (r *RedisCache) GetCachedApplication(ctx context.Context, appID string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixApp+appID).Bytes()
}

// InvalidateApplication removes an application from cache
func (r *RedisCache) InvalidateApplication(ctx context.Context, appID string) error {
	return r.Client.Del(ctx, PrefixApp+appID).Err()
}

// CacheCreditProfile stores a credit profile in cache
func (r *RedisCache) CacheCreditProfile(ctx context.Context, customerID string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixCredit+customerID, data, ttl).Err()
}

// GetCachedCreditProfile retrieves a credit profile from cache
func (r *RedisCache) GetCachedCreditProfile(ctx context.Context, customerID string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixCredit+customerID).Bytes()
}

// CachePaymentSchedule stores a payment schedule in cache
func (r *RedisCache) CachePaymentSchedule(ctx context.Context, loanID string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixSchedule+loanID, data, ttl).Err()
}

// GetCachedPaymentSchedule retrieves a payment schedule from cache
func (r *RedisCache) GetCachedPaymentSchedule(ctx context.Context, loanID string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixSchedule+loanID).Bytes()
}

// InvalidatePaymentSchedule removes a schedule from cache
func (r *RedisCache) InvalidatePaymentSchedule(ctx context.Context, loanID string) error {
	return r.Client.Del(ctx, PrefixSchedule+loanID).Err()
}

// CacheCollateral stores collateral info in cache
func (r *RedisCache) CacheCollateral(ctx context.Context, loanID string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixCollateral+loanID, data, ttl).Err()
}

// GetCachedCollateral retrieves collateral from cache
func (r *RedisCache) GetCachedCollateral(ctx context.Context, loanID string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixCollateral+loanID).Bytes()
}

// CacheLoanSummary caches the loan summary view
func (r *RedisCache) CacheLoanSummary(ctx context.Context, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixSummary+"summary", data, ttl).Err()
}

// GetCachedLoanSummary retrieves cached loan summary
func (r *RedisCache) GetCachedLoanSummary(ctx context.Context) ([]byte, error) {
	return r.Client.Get(ctx, PrefixSummary+"summary").Bytes()
}

// AcquireLock acquires a distributed lock
func (r *RedisCache) AcquireLock(ctx context.Context, resource string, ttl time.Duration) error {
	return r.Client.SetNX(ctx, PrefixLock+resource, "locked", ttl).Err()
}

// ReleaseLock releases a distributed lock
func (r *RedisCache) ReleaseLock(ctx context.Context, resource string) error {
	return r.Client.Del(ctx, PrefixLock+resource).Err()
}

// IncrementStatsAtomically atomically increments a stats counter
func (r *RedisCache) IncrementStatsAtomically(ctx context.Context, key string, amount int64) (int64, error) {
	return r.Client.IncrBy(ctx, PrefixStats+key, amount).Result()
}

// PublishFinanceEvent publishes a finance event to a Redis stream
func (r *RedisCache) PublishFinanceEvent(ctx context.Context, event map[string]interface{}) error {
	return r.Client.XAdd(ctx, &redis.XAddArgs{
		Stream: "pf:events:finance",
		Values: event,
	}).Err()
}

// ToJSON serializes any value to JSON bytes
func ToJSON(v interface{}) ([]byte, error) {
	return json.Marshal(v)
}
