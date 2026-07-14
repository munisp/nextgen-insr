package db

import (
	"context"
	"fmt"
	"time"

	"github.com/insureportal/ndpr_compliance/config"
	"github.com/redis/go-redis/v9"
)

type RedisCache struct {
	Client *redis.Client
}

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
	})
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("ping redis: %w", err)
	}
	return &RedisCache{Client: client}, nil
}

func (r *RedisCache) Close() error {
	if r != nil && r.Client != nil {
		return r.Client.Close()
	}
	return nil
}

const (
	PrefixConsent   = "ndpr:consent:"
	PrefixDSAR      = "ndpr:dsar:"
	PrefixBreach    = "ndpr:breach:"
	PrefixDPIA      = "ndpr:dpia:"
	PrefixMetrics   = "ndpr:metrics:"
	PrefixLock      = "ndpr:lock:"
	TCacheShort     = 10 * time.Minute
	TCacheMedium    = 30 * time.Minute
	TCacheLong      = 2 * time.Hour
)

func (r *RedisCache) CacheConsents(ctx context.Context, subjectID string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixConsent+subjectID, data, ttl).Err()
}

func (r *RedisCache) GetConsents(ctx context.Context, subjectID string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixConsent+subjectID).Bytes()
}

func (r *RedisCache) InvalidateConsents(ctx context.Context, subjectID string) error {
	return r.Client.Del(ctx, PrefixConsent+subjectID).Err()
}

func (r *RedisCache) CacheDSAR(ctx context.Context, dsarID string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixDSAR+dsarID, data, ttl).Err()
}

func (r *RedisCache) GetDSAR(ctx context.Context, dsarID string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixDSAR+dsarID).Bytes()
}

func (r *RedisCache) InvalidateDSAR(ctx context.Context, dsarID string) error {
	return r.Client.Del(ctx, PrefixDSAR+dsarID).Err()
}

func (r *RedisCache) CacheBreach(ctx context.Context, breachID string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixBreach+breachID, data, ttl).Err()
}

func (r *RedisCache) GetBreach(ctx context.Context, breachID string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixBreach+breachID).Bytes()
}

func (r *RedisCache) InvalidateBreach(ctx context.Context, breachID string) error {
	return r.Client.Del(ctx, PrefixBreach+breachID).Err()
}

func (r *RedisCache) CacheDPIA(ctx context.Context, dpiaID string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixDPIA+dpiaID, data, ttl).Err()
}

func (r *RedisCache) GetDPIA(ctx context.Context, dpiaID string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixDPIA+dpiaID).Bytes()
}

func (r *RedisCache) InvalidateDPIA(ctx context.Context, dpiaID string) error {
	return r.Client.Del(ctx, PrefixDPIA+dpiaID).Err()
}

func (r *RedisCache) CacheMetrics(ctx context.Context, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixMetrics+"latest", data, ttl).Err()
}

func (r *RedisCache) GetMetrics(ctx context.Context) ([]byte, error) {
	return r.Client.Get(ctx, PrefixMetrics+"latest").Bytes()
}

func (r *RedisCache) AcquireLock(ctx context.Context, resource string, ttl time.Duration) error {
	return r.Client.SetNX(ctx, PrefixLock+resource, "locked", ttl).Err()
}

func (r *RedisCache) ReleaseLock(ctx context.Context, resource string) error {
	return r.Client.Del(ctx, PrefixLock+resource).Err()
}
