package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"reinsurance-service/config"
)

type RedisCache struct{ Client *redis.Client }

func NewRedisCache(ctx context.Context, cfg *config.RedisConfig) (*RedisCache, error) {
	client := redis.NewClient(&redis.Options{
		Addr: cfg.RedisAddr(), Password: cfg.Password, DB: cfg.DB,
		MaxRetries: cfg.MaxRetries, PoolSize: cfg.PoolSize,
		ReadTimeout: cfg.ReadTimeout, WriteTimeout: cfg.WriteTimeout,
	})
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("ping redis: %w", err)
	}
	return &RedisCache{Client: client}, nil
}

func (r *RedisCache) Close() error { return r.Client.Close() }

const (
	PrefixTreaty   = "ri:treaty:"
	PrefixCession  = "ri:cession:"
	PrefixRecovery = "ri:recovery:"
	PrefixCommission = "ri:commission:"
	PrefixSummary  = "ri:summary:"
	PrefixStats    = "ri:stats:"
	PrefixLock     = "ri:lock:"
	TCacheMedium   = 30 * time.Minute
	TCacheLong     = 2 * time.Hour
)

func (r *RedisCache) CacheTreaty(ctx context.Context, id string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixTreaty+id, data, ttl).Err()
}
func (r *RedisCache) GetCachedTreaty(ctx context.Context, id string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixTreaty+id).Bytes()
}
func (r *RedisCache) InvalidateTreaty(ctx context.Context, id string) error {
	return r.Client.Del(ctx, PrefixTreaty+id).Err()
}
func (r *RedisCache) CacheCession(ctx context.Context, id string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixCession+id, data, ttl).Err()
}
func (r *RedisCache) GetCachedCession(ctx context.Context, id string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixCession+id).Bytes()
}
func (r *RedisCache) CacheRecovery(ctx context.Context, id string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixRecovery+id, data, ttl).Err()
}
func (r *RedisCache) CacheCommission(ctx context.Context, id string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixCommission+id, data, ttl).Err()
}
func (r *RedisCache) CacheSummary(ctx context.Context, treatyID string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixSummary+treatyID, data, ttl).Err()
}
func (r *RedisCache) GetCachedSummary(ctx context.Context, treatyID string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixSummary+treatyID).Bytes()
}
func (r *RedisCache) AcquireLock(ctx context.Context, resource string, ttl time.Duration) error {
	return r.Client.SetNX(ctx, PrefixLock+resource, "locked", ttl).Err()
}
func (r *RedisCache) ReleaseLock(ctx context.Context, resource string) error {
	return r.Client.Del(ctx, PrefixLock+resource).Err()
}
func (r *RedisCache) IncrementStats(ctx context.Context, key string, amount int64) (int64, error) {
	return r.Client.IncrBy(ctx, PrefixStats+key, amount).Result()
}
func (r *RedisCache) PublishEvent(ctx context.Context, stream string, event map[string]interface{}) error {
	return r.Client.XAdd(ctx, &redis.XAddArgs{Stream: "ri:events:" + stream, Values: event}).Err()
}

func ToJSON(v interface{}) ([]byte, error) { return json.Marshal(v) }
