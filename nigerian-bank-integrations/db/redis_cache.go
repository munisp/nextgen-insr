package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/insureportal/nigerian-bank-integrations/config"
)

type RedisCache struct {
	Client *redis.Client
}

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

func (r *RedisCache) Close() error { return r.Client.Close() }

const (
	PrefixVerify = "nb:verify:"
	PrefixTransfer = "nb:transfer:"
	PrefixCallback = "nb:callback:"
	PrefixSettlement = "nb:settlement:"
	PrefixStats    = "nb:stats:"
	PrefixLock     = "nb:lock:"
	TCacheMedium   = 30 * time.Minute
	TCacheLong     = 2 * time.Hour
)

func (r *RedisCache) CacheVerification(ctx context.Context, key string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixVerify+key, data, ttl).Err()
}

func (r *RedisCache) GetCachedVerification(ctx context.Context, key string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixVerify+key).Bytes()
}

func (r *RedisCache) InvalidateVerification(ctx context.Context, key string) error {
	return r.Client.Del(ctx, PrefixVerify+key).Err()
}

func (r *RedisCache) CacheTransfer(ctx context.Context, ref string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixTransfer+ref, data, ttl).Err()
}

func (r *RedisCache) GetCachedTransfer(ctx context.Context, ref string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixTransfer+ref).Bytes()
}

func (r *RedisCache) InvalidateTransfer(ctx context.Context, ref string) error {
	return r.Client.Del(ctx, PrefixTransfer+ref).Err()
}

func (r *RedisCache) CacheSettlement(ctx context.Context, date string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixSettlement+date, data, ttl).Err()
}

func (r *RedisCache) GetCachedSettlement(ctx context.Context, date string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixSettlement+date).Bytes()
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
	return r.Client.XAdd(ctx, &redis.XAddArgs{Stream: "nb:events:" + stream, Values: event}).Err()
}

func ToJSON(v interface{}) ([]byte, error) { return json.Marshal(v) }
