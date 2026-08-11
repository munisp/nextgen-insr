package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/insureportal/agent_commission_management/config"
	"github.com/insureportal/agent_commission_management/models"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

type RedisCache struct {
	client *redis.Client
}

func NewRedisCache(cfg *config.Config) (*RedisCache, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:         cfg.RedisAddr,
		Password:     cfg.RedisPass,
		DB:           cfg.RedisDB,
		MaxRetries:   cfg.RedisMaxRetries,
		DialTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
	})
	if err := rdb.Ping(context.Background()).Err(); err != nil {
		return nil, fmt.Errorf("redis ping: %w", err)
	}
	zap.L().Info("Redis connected", zap.String("addr", cfg.RedisAddr))
	return &RedisCache{client: rdb}, nil
}

func (r *RedisCache) Close() error { return r.client.Close() }

const (
	keyPrefix    = "comm:"
	agentTTL     = 1 * time.Hour
	dashboardTTL = 30 * time.Second
	periodTTL    = 24 * time.Hour
)

func agentKey(code string) string          { return fmt.Sprintf("%sagent:%s", keyPrefix, code) }
func dashboardKey() string                 { return fmt.Sprintf("%sdashboard", keyPrefix) }
func periodKey(agentID string) string      { return fmt.Sprintf("%speriod:%s", keyPrefix, agentID) }
func totalEarnedKey(agentID string) string { return fmt.Sprintf("%searned:%s", keyPrefix, agentID) }

func (r *RedisCache) CacheAgentProfile(ctx context.Context, ap *models.AgentProfile) error {
	val, err := json.Marshal(ap)
	if err != nil {
		return err
	}
	return r.client.Set(ctx, agentKey(ap.AgentCode), val, agentTTL).Err()
}

func (r *RedisCache) GetAgentProfile(ctx context.Context, code string) (*models.AgentProfile, error) {
	val, err := r.client.Get(ctx, agentKey(code)).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var ap models.AgentProfile
	if err := json.Unmarshal([]byte(val), &ap); err != nil {
		return nil, err
	}
	return &ap, nil
}

func (r *RedisCache) CacheDashboard(ctx context.Context, dash *models.CommissionDashboard) error {
	val, err := json.Marshal(dash)
	if err != nil {
		return err
	}
	return r.client.Set(ctx, dashboardKey(), val, dashboardTTL).Err()
}

func (r *RedisCache) GetCachedDashboard(ctx context.Context) (*models.CommissionDashboard, error) {
	val, err := r.client.Get(ctx, dashboardKey()).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var dash models.CommissionDashboard
	if err := json.Unmarshal([]byte(val), &dash); err != nil {
		return nil, err
	}
	return &dash, nil
}

func (r *RedisCache) IncrementEarned(ctx context.Context, agentID string, amount float64) error {
	key := totalEarnedKey(agentID)
	return r.client.HIncrByFloat(ctx, key, "total", amount).Err()
}

func (r *RedisCache) GetEarned(ctx context.Context, agentID string) (float64, error) {
	return hGetFloat(r.client, ctx, totalEarnedKey(agentID), "total")
}

func (r *RedisCache) PublishCommissionEvent(ctx context.Context, agentID, commissionID string, amount float64) error {
	channel := "comm:new_commission"
	data := map[string]interface{}{
		"event":         "commission_calculated",
		"agent_id":      agentID,
		"commission_id": commissionID,
		"amount":        amount,
		"timestamp":     time.Now().Format(time.RFC3339),
	}
	val, _ := json.Marshal(data)
	return r.client.Publish(ctx, channel, val).Err()
}

func (r *RedisCache) PublishPaymentEvent(ctx context.Context, paymentID, agentID string, amount float64) error {
	channel := "comm:new_payment"
	data := map[string]interface{}{
		"event":      "payment_processed",
		"payment_id": paymentID,
		"agent_id":   agentID,
		"amount":     amount,
		"timestamp":  time.Now().Format(time.RFC3339),
	}
	val, _ := json.Marshal(data)
	return r.client.Publish(ctx, channel, val).Err()
}

func (r *RedisCache) PublishClawbackEvent(ctx context.Context, commissionID, agentID string, amount float64) error {
	channel := "comm:clawback"
	data := map[string]interface{}{
		"event":         "commission_clawed_back",
		"commission_id": commissionID,
		"agent_id":      agentID,
		"amount":        amount,
		"timestamp":     time.Now().Format(time.RFC3339),
	}
	val, _ := json.Marshal(data)
	return r.client.Publish(ctx, channel, val).Err()
}

func (r *RedisCache) CacheAgentRanking(ctx context.Context, agentID string, rank int, amount float64) error {
	key := fmt.Sprintf("%sranking", keyPrefix)
	return r.client.ZAdd(ctx, key, redis.Z{
		Score:  amount,
		Member: agentID,
	}).Err()
}

func (r *RedisCache) GetTopAgent(ctx context.Context, n int) (string, float64, error) {
	key := fmt.Sprintf("%sranking", keyPrefix)
	results, err := r.client.ZRevRangeWithScores(ctx, key, 0, int64(n-1)).Result()
	if err != nil || len(results) == 0 {
		return "", 0, err
	}
	agentID, _ := results[0].Member.(string)
	return agentID, results[0].Score, nil
}

func (r *RedisCache) SetPeriodCache(ctx context.Context, agentID string, period *models.CommissionPeriod) error {
	val, err := json.Marshal(period)
	if err != nil {
		return err
	}
	return r.client.Set(ctx, periodKey(agentID), val, periodTTL).Err()
}

func hGetFloat(c *redis.Client, ctx context.Context, key, field string) (float64, error) {
	return c.HGet(ctx, key, field).Float64()
}
