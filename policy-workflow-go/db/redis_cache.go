package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/insureportal/policy_workflow_go/config"
	"github.com/insureportal/policy_workflow_go/models"
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
	keyPrefix = "policy:"
	policyTTL = 10 * time.Minute
	transitionTTL = 5 * time.Minute
	dashboardTTL  = 30 * time.Second
	lapseCheckKey = "policy:lapse:last_check"
)

func policyKey(id string) string      { return fmt.Sprintf("%spolicy:%s", keyPrefix, id) }
func transitionKey(policyID string) string { return fmt.Sprintf("%stransitions:%s", keyPrefix, policyID) }
func dashboardKey() string           { return fmt.Sprintf("%sdashboard", keyPrefix) }
func policyByNumberKey(number string) string { return fmt.Sprintf("%spolnum:%s", keyPrefix, number) }

func (r *RedisCache) CachePolicy(ctx context.Context, pol *models.Policy) error {
	val, err := json.Marshal(pol)
	if err != nil { return err }
	if err := r.client.Set(ctx, policyKey(pol.ID), val, policyTTL).Err(); err != nil {
		return err
	}
	return r.client.Set(ctx, policyByNumberKey(pol.PolicyNumber), val, policyTTL).Err()
}

func (r *RedisCache) GetPolicy(ctx context.Context, id string) (*models.Policy, error) {
	val, err := r.client.Get(ctx, policyKey(id)).Result()
	if err == redis.Nil { return nil, nil }
	if err != nil { return nil, err }
	var pol models.Policy
	if err := json.Unmarshal([]byte(val), &pol); err != nil { return nil, err }
	return &pol, nil
}

func (r *RedisCache) InvalidatePolicy(ctx context.Context, id string) error {
	key := policyKey(id)
	numVal, _ := r.client.Get(ctx, policyKey(id)).Result()
	var pol models.Policy
	json.Unmarshal([]byte(numVal), &pol)
	numKey := policyByNumberKey(pol.PolicyNumber)
	return r.client.Del(ctx, key, numKey).Err()
}

func (r *RedisCache) CacheDashboard(ctx context.Context, dash *models.PolicyDashboard) error {
	val, err := json.Marshal(dash)
	if err != nil { return err }
	return r.client.Set(ctx, dashboardKey(), val, dashboardTTL).Err()
}

func (r *RedisCache) GetCachedDashboard(ctx context.Context) (*models.PolicyDashboard, error) {
	val, err := r.client.Get(ctx, dashboardKey()).Result()
	if err == redis.Nil { return nil, nil }
	if err != nil { return nil, err }
	var dash models.PolicyDashboard
	if err := json.Unmarshal([]byte(val), &dash); err != nil { return nil, err }
	return &dash, nil
}

func (r *RedisCache) IncrementTransitionCount(ctx context.Context) error {
	key := fmt.Sprintf("%scounter:transitions", keyPrefix)
	_, err := r.client.Incr(ctx, key).Result()
	if err == nil { r.client.Expire(ctx, key, 24*time.Hour) }
	return err
}

func (r *RedisCache) PublishStateChange(ctx context.Context, policyID string, from, to models.PolicyState) error {
	channel := fmt.Sprintf("policy:state_changes:%s", policyID)
	data := map[string]interface{}{
		"policy_id":  policyID,
		"from_state": string(from),
		"to_state":   string(to),
		"timestamp":  time.Now().Format(time.RFC3339),
	}
	val, _ := json.Marshal(data)
	return r.client.Publish(ctx, channel, val).Err()
}

func (r *RedisCache) CheckLapseDue(ctx context.Context) (int64, error) {
	return r.client.Incr(ctx, lapseCheckKey)
}
