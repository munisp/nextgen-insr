package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/insureportal/enhanced_kyc_kyb/config"
	"github.com/insureportal/enhanced_kyc_kyb/models"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

const (
	kycResultPrefix = "kyc:result:"
	ninRatePrefix   = "rate:nin:"
	bvnRatePrefix   = "rate:bvn:"
	attemptPrefix   = "attempt:"
	ninLookupPrefix = "nin:lookup:"
	bvnLookupPrefix = "bvn:lookup:"
)

// RedisCache provides in-memory caching, rate limiting, and attempt tracking.
type RedisCache struct {
	client *redis.Client
	log    *zap.Logger
	cfg    *config.Config
	ctx    context.Context
}

// NewRedisCache initializes a Redis connection and returns a ready-to-use cache.
func NewRedisCache(cfg *config.Config, log *zap.Logger) (*RedisCache, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})

	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis ping failed: %w", err)
	}

	log.Info("redis connected successfully")
	return &RedisCache{client: client, log: log, cfg: cfg, ctx: ctx}, nil
}

// Close shuts down the Redis connection.
func (r *RedisCache) Close() error {
	return r.client.Close()
}

// Ping checks that the Redis connection is alive.
func (r *RedisCache) Ping() error {
	return r.client.Ping(r.ctx).Err()
}

// --- KYC Result Caching ---

// CacheKYCResult stores a KYC verification result with TTL.
func (r *RedisCache) CacheKYCResult(customerID string, result *models.VerificationResult) error {
	key := kycResultPrefix + customerID
	data, err := marshal(result)
	if err != nil {
		return fmt.Errorf("marshal KYC result: %w", err)
	}
	return r.client.Set(r.ctx, key, data, r.cfg.KYCTTL).Err()
}

// GetCachedKYCResult retrieves a cached KYC result, or nil if not found/expired.
func (r *RedisCache) GetCachedKYCResult(customerID string) (*models.VerificationResult, error) {
	key := kycResultPrefix + customerID
	data, err := r.client.Get(r.ctx, key).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get cached KYC result: %w", err)
	}
	var result models.VerificationResult
	if err := unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("unmarshal cached KYC result: %w", err)
	}
	return &result, nil
}

// InvalidateKYCCache removes a cached result (e.g. after status change).
func (r *RedisCache) InvalidateKYCCache(customerID string) {
	r.client.Del(r.ctx, kycResultPrefix+customerID)
}

// --- NIN Verification Lookup Cache ---

// CacheNINLookup caches a NIN verification response.
func (r *RedisCache) CacheNINLookup(nin string, result *models.NINResult) error {
	key := ninLookupPrefix + nin
	data, err := marshal(result)
	if err != nil {
		return fmt.Errorf("marshal NIN lookup: %w", err)
	}
	return r.client.Set(r.ctx, key, data, 1*time.Hour).Err()
}

// GetCachedNINLookup returns a cached NIN lookup result.
func (r *RedisCache) GetCachedNINLookup(nin string) (*models.NINResult, error) {
	key := ninLookupPrefix + nin
	data, err := r.client.Get(r.ctx, key).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get cached NIN lookup: %w", err)
	}
	var result models.NINResult
	if err := unmarshal(data, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// --- BVN Verification Lookup Cache ---

// CacheBVNLookup caches a BVN verification response.
func (r *RedisCache) CacheBVNLookup(bvn string, result *models.BVNResult) error {
	key := bvnLookupPrefix + bvn
	data, err := marshal(result)
	if err != nil {
		return fmt.Errorf("marshal BVN lookup: %w", err)
	}
	return r.client.Set(r.ctx, key, data, 1*time.Hour).Err()
}

// GetCachedBVNLookup returns a cached BVN lookup result.
func (r *RedisCache) GetCachedBVNLookup(bvn string) (*models.BVNResult, error) {
	key := bvnLookupPrefix + bvn
	data, err := r.client.Get(r.ctx, key).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get cached BVN lookup: %w", err)
	}
	var result models.BVNResult
	if err := unmarshal(data, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// --- Rate Limiting ---

// AllowNIN checks whether the given NIN is allowed under rate limiting.
func (r *RedisCache) AllowNIN(nin string) bool {
	key := ninRatePrefix + nin
	count := r.client.Incr(r.ctx, key).Val()
	if count == 1 {
		r.client.Expire(r.ctx, key, r.cfg.RateLimitWindow)
	}
	return count <= int64(r.cfg.RateLimitNIN)
}

// AllowBVN checks whether the given BVN is allowed under rate limiting.
func (r *RedisCache) AllowBVN(bvn string) bool {
	key := bvnRatePrefix + bvn
	count := r.client.Incr(r.ctx, key).Val()
	if count == 1 {
		r.client.Expire(r.ctx, key, r.cfg.RateLimitWindow)
	}
	return count <= int64(r.cfg.RateLimitBVN)
}

// --- Verification Attempt Tracking ---

// RecordAttempt records a verification attempt and returns the current count.
func (r *RedisCache) RecordAttempt(customerID string) int64 {
	key := attemptPrefix + customerID
	count := r.client.Incr(r.ctx, key).Val()
	if count == 1 {
		r.client.Expire(r.ctx, key, 24*time.Hour)
	}
	return count
}

// GetAttemptCount returns the current number of attempts for a customer.
func (r *RedisCache) GetAttemptCount(customerID string) int64 {
	val := r.client.Get(r.ctx, attemptPrefix+customerID)
	if val.Err() == redis.Nil {
		return 0
	}
	count, _ := val.Int64()
	return count
}

// --- Generic Helpers ---

func marshal(v interface{}) ([]byte, error) {
	return json.Marshal(v)
}

func unmarshal(data []byte, v interface{}) error {
	return json.Unmarshal(data, v)
}
