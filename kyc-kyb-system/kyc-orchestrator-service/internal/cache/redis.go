package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"github.com/munisp/NGApp/kyc-kyb-system/kyc-orchestrator-service/internal/models"
)

type RedisCache struct {
	client *redis.Client
	logger *zap.Logger
	prefix string
}

func NewRedisCache(logger *zap.Logger, addr string) (*RedisCache, error) {
	if addr == "" {
		addr = "localhost:6379"
	}

	client := redis.NewClient(&redis.Options{
		Addr:         addr,
		Password:     "",
		DB:           0,
		DialTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
		PoolSize:     20,
		MinIdleConns: 5,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		logger.Warn("redis_not_available", zap.Error(err))
	}

	return &RedisCache{
		client: client,
		logger: logger,
		prefix: "kyc:",
	}, nil
}

func (c *RedisCache) SetSession(ctx context.Context, sessionID string, v *models.KYCVerification, ttl time.Duration) error {
	data, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("marshal verification: %w", err)
	}

	key := c.prefix + "session:" + sessionID
	if err := c.client.Set(ctx, key, data, ttl).Err(); err != nil {
		c.logger.Warn("redis_set_failed", zap.Error(err), zap.String("key", key))
		return err
	}
	return nil
}

func (c *RedisCache) GetSession(ctx context.Context, sessionID string) (*models.KYCVerification, error) {
	key := c.prefix + "session:" + sessionID
	data, err := c.client.Get(ctx, key).Bytes()
	if err != nil {
		if err == redis.Nil {
			return nil, nil
		}
		return nil, err
	}

	var v models.KYCVerification
	if err := json.Unmarshal(data, &v); err != nil {
		return nil, fmt.Errorf("unmarshal verification: %w", err)
	}
	return &v, nil
}

func (c *RedisCache) InvalidateSession(ctx context.Context, sessionID string) error {
	key := c.prefix + "session:" + sessionID
	return c.client.Del(ctx, key).Err()
}

func (c *RedisCache) SetKYCGate(ctx context.Context, userID string, allowed bool, level int, ttl time.Duration) error {
	gate := map[string]interface{}{
		"allowed": allowed,
		"level":   level,
		"checked": time.Now().Unix(),
	}
	data, _ := json.Marshal(gate)
	key := c.prefix + "gate:" + userID
	return c.client.Set(ctx, key, data, ttl).Err()
}

func (c *RedisCache) GetKYCGate(ctx context.Context, userID string) (bool, int, error) {
	key := c.prefix + "gate:" + userID
	data, err := c.client.Get(ctx, key).Bytes()
	if err != nil {
		if err == redis.Nil {
			return false, 0, nil
		}
		return false, 0, err
	}

	var gate struct {
		Allowed bool `json:"allowed"`
		Level   int  `json:"level"`
	}
	if err := json.Unmarshal(data, &gate); err != nil {
		return false, 0, err
	}
	return gate.Allowed, gate.Level, nil
}

func (c *RedisCache) IncrementRateLimit(ctx context.Context, key string, window time.Duration) (int64, error) {
	rateKey := c.prefix + "rate:" + key
	pipe := c.client.Pipeline()
	incr := pipe.Incr(ctx, rateKey)
	pipe.Expire(ctx, rateKey, window)
	_, err := pipe.Exec(ctx)
	if err != nil {
		return 0, err
	}
	return incr.Val(), nil
}

func (c *RedisCache) SetVerificationLock(ctx context.Context, userID string, ttl time.Duration) (bool, error) {
	key := c.prefix + "lock:" + userID
	return c.client.SetNX(ctx, key, time.Now().Unix(), ttl).Result()
}

func (c *RedisCache) ReleaseVerificationLock(ctx context.Context, userID string) error {
	key := c.prefix + "lock:" + userID
	return c.client.Del(ctx, key).Err()
}

func (c *RedisCache) PublishEvent(ctx context.Context, channel string, event interface{}) error {
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return c.client.Publish(ctx, c.prefix+channel, data).Err()
}

func (c *RedisCache) Close() error {
	return c.client.Close()
}
