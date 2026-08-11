package db

import (
	"context"
	"fmt"
	"time"

	"github.com/insureportal/gamification_service/config"
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
		ConnMaxIdleTime: 5 * time.Minute,
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
	PrefixUserPoints  = "gma:points:"
	PrefixLeaderboard = "gma:leaderboard:"
	PrefixUserBadges  = "gma:badges:"
	PrefixUserChall   = "gma:chall:"
	PrefixReferral    = "gma:ref:"
	PrefixMetrics     = "gma:metrics:"
	PrefixLock        = "gma:lock:"
	TCacheShort       = 10 * time.Minute
	TCacheMedium      = 30 * time.Minute
	TCacheLong        = 2 * time.Hour
)

func (r *RedisCache) CacheUserPoints(ctx context.Context, userID string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixUserPoints+userID, data, ttl).Err()
}

func (r *RedisCache) GetUserPoints(ctx context.Context, userID string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixUserPoints+userID).Bytes()
}

func (r *RedisCache) InvalidateUserPoints(ctx context.Context, userID string) error {
	return r.Client.Del(ctx, PrefixUserPoints+userID).Err()
}

func (r *RedisCache) CacheLeaderboard(ctx context.Context, period string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixLeaderboard+period, data, ttl).Err()
}

func (r *RedisCache) GetLeaderboard(ctx context.Context, period string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixLeaderboard+period).Bytes()
}

func (r *RedisCache) InvalidateLeaderboard(ctx context.Context, period string) error {
	return r.Client.Del(ctx, PrefixLeaderboard+period).Err()
}

func (r *RedisCache) CacheUserBadges(ctx context.Context, userID string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixUserBadges+userID, data, ttl).Err()
}

func (r *RedisCache) GetUserBadges(ctx context.Context, userID string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixUserBadges+userID).Bytes()
}

func (r *RedisCache) InvalidateUserBadges(ctx context.Context, userID string) error {
	return r.Client.Del(ctx, PrefixUserBadges+userID).Err()
}

func (r *RedisCache) CacheUserChallenge(ctx context.Context, key string, data []byte, ttl time.Duration) error {
	return r.Client.Set(ctx, PrefixUserChall+key, data, ttl).Err()
}

func (r *RedisCache) GetUserChallenge(ctx context.Context, key string) ([]byte, error) {
	return r.Client.Get(ctx, PrefixUserChall+key).Bytes()
}

func (r *RedisCache) InvalidateUserChallenge(ctx context.Context, key string) error {
	return r.Client.Del(ctx, PrefixUserChall+key).Err()
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

// IncrementPoints atomically increments a points counter in Redis.
func (r *RedisCache) IncrementPoints(ctx context.Context, key string, amount int64) (int64, error) {
	return r.Client.IncrBy(ctx, key, amount).Result()
}

// DecrementPoints atomically decrements a points counter in Redis.
func (r *RedisCache) DecrementPoints(ctx context.Context, key string, amount int64) (int64, error) {
	return r.Client.DecrBy(ctx, key, amount).Result()
}

// SetLeaderboardEntry updates a user's rank in a leaderboard.
func (r *RedisCache) SetLeaderboardEntry(ctx context.Context, period string, userID string, points int) error {
	return r.Client.ZAdd(ctx, PrefixLeaderboard+"scores:"+period, redis.Z{
		Score:  float64(points),
		Member: userID,
	}).Err()
}

// GetLeaderboardScores returns top N scores for a period.
func (r *RedisCache) GetLeaderboardScores(ctx context.Context, period string, offset, count int) ([]redis.Z, error) {
	return r.Client.ZRevRangeWithScores(ctx, PrefixLeaderboard+"scores:"+period,
		int64(offset), int64(offset+count-1)).Result()
}
