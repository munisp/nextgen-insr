package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/insureportal/fraud-detection-go/config"
	"github.com/insureportal/fraud-detection-go/models"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

const (
	// Redis key prefixes
	velocityKeyPrefix = "fraud:velocity:"
	blockKeyPrefix    = "fraud:block:"
	scoreKeyPrefix    = "fraud:cache:score:"
)

// RedisCache wraps a *redis.Client with fraud-domain key helpers.
type RedisCache struct {
	client *redis.Client
	logger *zap.Logger
}

// NewRedisCache creates a Redis client from config.
func NewRedisCache(cfg config.RedisConfig, logger *zap.Logger) (*RedisCache, error) {
	client := redis.NewClient(&redis.Options{
		Addr:         cfg.Address(),
		Password:     cfg.Password,
		DB:           cfg.DB,
		MaxRetries:   cfg.MaxRetries,
		PoolSize:     cfg.PoolSize,
		MinIdleConns: cfg.MinConns,
		DialTimeout:  cfg.DialTimeout,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
	})

	if err := client.Ping(context.Background()).Err(); err != nil {
		return nil, fmt.Errorf("ping redis: %w", err)
	}

	logger.Info("redis connected", zap.String("addr", cfg.Address()))
	return &RedisCache{client: client, logger: logger}, nil
}

// Close releases the Redis connection pool.
func (rc *RedisCache) Close() error {
	return rc.client.Close()
}

// Ping checks Redis connectivity.
func (rc *RedisCache) Ping(ctx context.Context) error {
	return rc.client.Ping(ctx).Err()
}

// TrackTransactionCount records a transaction timestamp for an account
// using a Redis sorted set (score = unix timestamp).
func (rc *RedisCache) TrackTransactionCount(ctx context.Context, accountID string) error {
	key := velocityKeyPrefix + accountID
	now := float64(time.Now().Unix())
	pipe := rc.client.Pipeline()
	pipe.ZAdd(ctx, key, redis.Z{Score: now, Member: now})
	// Keep only the last velocity window worth of entries
	pipe.Expire(ctx, key, 2*time.Hour)
	_, err := pipe.Exec(ctx)
	if err != nil && err != redis.Nil {
		return fmt.Errorf("track transaction: %w", err)
	}
	return nil
}

// CheckVelocity returns the number of transactions an account has made
// within the last `window` duration.
func (rc *RedisCache) CheckVelocity(ctx context.Context, accountID string, window time.Duration) (int, error) {
	key := velocityKeyPrefix + accountID
	now := float64(time.Now().Unix())
	cutoff := now - float64(window.Seconds())

	val, err := rc.client.ZCount(ctx, key, fmt.Sprintf("(%f", cutoff), "+inf").Result()
	if err != nil && err != redis.Nil {
		return 0, fmt.Errorf("check velocity: %w", err)
	}
	return int(val), nil
}

// SetBlockedAccount marks an account as blocked with a TTL.
func (rc *RedisCache) SetBlockedAccount(ctx context.Context, accountID string, ttl time.Duration) error {
	key := blockKeyPrefix + accountID
	if err := rc.client.Set(ctx, key, "blocked", ttl).Err(); err != nil {
		return fmt.Errorf("set blocked account: %w", err)
	}
	return nil
}

// IsBlocked checks whether an account is currently on the block list.
func (rc *RedisCache) IsBlocked(ctx context.Context, accountID string) (bool, error) {
	key := blockKeyPrefix + accountID
	exists, err := rc.client.Exists(ctx, key).Result()
	if err != nil {
		return false, fmt.Errorf("check blocked: %w", err)
	}
	return exists == 1, nil
}

// UnblockAccount removes an account from the block list.
func (rc *RedisCache) UnblockAccount(ctx context.Context, accountID string) {
	key := blockKeyPrefix + accountID
	rc.client.Del(ctx, key)
}

// CacheScore stores a fraud scoring result in Redis with a short TTL.
func (rc *RedisCache) CacheScore(ctx context.Context, score models.FraudScore, ttl time.Duration) error {
	key := scoreKeyPrefix + score.TransactionID
	data, err := json.Marshal(score)
	if err != nil {
		return fmt.Errorf("marshal cached score: %w", err)
	}
	if err := rc.client.Set(ctx, key, data, ttl).Err(); err != nil {
		return fmt.Errorf("cache score: %w", err)
	}
	return nil
}

// GetCachedScore retrieves a previously cached scoring result by transaction ID.
func (rc *RedisCache) GetCachedScore(ctx context.Context, transactionID string) (*models.FraudScore, error) {
	key := scoreKeyPrefix + transactionID

	val, err := rc.client.Get(ctx, key).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get cached score: %w", err)
	}

	var score models.FraudScore
	if err := json.Unmarshal([]byte(val), &score); err != nil {
		return nil, fmt.Errorf("unmarshal cached score: %w", err)
	}
	return &score, nil
}
