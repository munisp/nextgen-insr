package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/insureportal/microinsurance-engine/config"
	"github.com/redis/go-redis/v9"
)

// RedisCache provides Redis-backed caching for the microinsurance engine.
type RedisCache struct {
	Client *redis.Client
}

// NewRedisCache creates a new Redis client and verifies connectivity.
func NewRedisCache(ctx context.Context, cfg *config.RedisConfig) (*RedisCache, error) {
	client := redis.NewClient(&redis.Options{
		Addr:            cfg.RedisAddr(),
		Password:        cfg.Password,
		DB:              cfg.DB,
		MaxRetries:      cfg.MaxRetries,
		PoolSize:        cfg.PoolSize,
		ReadTimeout:     cfg.ReadTimeout,
		WriteTimeout:    cfg.WriteTimeout,
		DialTimeout:     5 * time.Second,
		IdleTimeout:     5 * time.Minute,
		IdleCheckFrequency: 1 * time.Minute,
	})
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("ping redis: %w", err)
	}
	return &RedisCache{Client: client}, nil
}

// Close shuts down the Redis connection.
func (r *RedisCache) Close() error {
	if r != nil && r.Client != nil {
		return r.Client.Close()
	}
	return nil
}

const (
	PrefixProduct    = "mic:product:"
	PrefixEnroll     = "mic:enroll:"
	PrefixClaim      = "mic:claim:"
	PrefixPayment    = "mic:payment:"
	PrefixGroup      = "mic:group:"
	PrefixUSSD       = "mic:ussd:"
	PrefixTrigger    = "mic:trigger:"
	PrefixStats      = "mic:stats:"
	PrefixLock       = "mic:lock:"
	PrefixProductAll = "mic:products:all"

	TCacheMedium = 30 * time.Minute
	TCacheLong   = 2 * time.Hour
)

// ---- Product Cache ----

// CacheProduct stores a serialized product in Redis.
func (r *RedisCache) CacheProduct(ctx context.Context, key string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixProduct+key, data, ttl).Err()
}

// GetCachedProduct retrieves a cached product.
func (r *RedisCache) GetCachedProduct(ctx context.Context, key string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixProduct+key).Bytes()
}

// InvalidateProduct removes a single product from cache.
func (r *RedisCache) InvalidateProduct(ctx context.Context, key string) error {
	return r.Client.Del(ctx, PrefixProduct+key).Err()
}

// InvalidateAllProducts clears the products cache index.
func (r *RedisCache) InvalidateAllProducts(ctx context.Context) error {
	return r.Client.Del(ctx, PrefixProductAll).Err()
}

// ---- Enrollment Cache ----

// CacheEnrollment stores a serialized enrollment in Redis.
func (r *RedisCache) CacheEnrollment(ctx context.Context, key string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixEnroll+key, data, ttl).Err()
}

// GetCachedEnrollment retrieves a cached enrollment.
func (r *RedisCache) GetCachedEnrollment(ctx context.Context, key string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixEnroll+key).Bytes()
}

// InvalidateEnrollment removes an enrollment from cache.
func (r *RedisCache) InvalidateEnrollment(ctx context.Context, key string) error {
	return r.Client.Del(ctx, PrefixEnroll+key).Err()
}

// InvalidateAllEnrollments clears the enrollments cache index.
func (r *RedisCache) InvalidateAllEnrollments(ctx context.Context) error {
	return r.Client.Del(ctx, PrefixEnroll+"all").Err()
}

// ---- Claim Cache ----

// CacheClaim stores a serialized claim in Redis.
func (r *RedisCache) CacheClaim(ctx context.Context, key string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixClaim+key, data, ttl).Err()
}

// GetCachedClaim retrieves a cached claim.
func (r *RedisCache) GetCachedClaim(ctx context.Context, key string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixClaim+key).Bytes()
}

// InvalidateClaim removes a claim from cache.
func (r *RedisCache) InvalidateClaim(ctx context.Context, key string) error {
	return r.Client.Del(ctx, PrefixClaim+key).Err()
}

// ---- USSD Session Cache ----

// CacheUSSDSession stores a USSD session in Redis.
func (r *RedisCache) CacheUSSDSession(ctx context.Context, sessionID string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixUSSD+sessionID, data, ttl).Err()
}

// GetCachedUSSDSession retrieves a cached USSD session.
func (r *RedisCache) GetCachedUSSDSession(ctx context.Context, sessionID string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixUSSD+sessionID).Bytes()
}

// ---- Group Policy Cache ----

// CacheGroupPolicy stores a serialized group policy in Redis.
func (r *RedisCache) CacheGroupPolicy(ctx context.Context, key string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixGroup+key, data, ttl).Err()
}

// GetCachedGroupPolicy retrieves a cached group policy.
func (r *RedisCache) GetCachedGroupPolicy(ctx context.Context, key string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixGroup+key).Bytes()
}

// InvalidateGroup removes a group from cache.
func (r *RedisCache) InvalidateGroup(ctx context.Context, key string) error {
	return r.Client.Del(ctx, PrefixGroup+key).Err()
}

// ---- Distributed Locking ----

// AcquireLock attempts to acquire a distributed lock. Returns nil on success.
func (r *RedisCache) AcquireLock(ctx context.Context, resource string, ttl time.Duration) error {
	return r.Client.SetNX(ctx, PrefixLock+resource, "locked", ttl).Err()
}

// ReleaseLock releases a distributed lock.
func (r *RedisCache) ReleaseLock(ctx context.Context, resource string) error {
	return r.Client.Del(ctx, PrefixLock+resource).Err()
}

// ---- Stats & Events ----

// IncrementStats atomically increments a stats counter.
func (r *RedisCache) IncrementStats(ctx context.Context, key string, amount int64) (int64, error) {
	return r.Client.IncrBy(ctx, PrefixStats+key, amount).Result()
}

// PublishEvent publishes an event to the Redis Streams-based event bus.
func (r *RedisCache) PublishEvent(ctx context.Context, stream string, event map[string]interface{}) error {
	return r.Client.XAdd(ctx, &redis.XAddArgs{
		Stream: "mic:events:" + stream,
		Values: event,
	}).Err()
}

// ---- JSON Helpers ----

// ToJSON marshals a value to JSON bytes.
func ToJSON(v interface{}) ([]byte, error) {
	return json.Marshal(v)
}
