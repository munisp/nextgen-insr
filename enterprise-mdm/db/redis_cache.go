package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/insureportal/enterprise_mdm/config"
	"github.com/insureportal/enterprise_mdm/models"
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
	keyPrefix    = "mdm:"
	goldenTTL    = 10 * time.Minute
	agentTTL     = 1 * time.Hour
	dashboardTTL = 30 * time.Second
)

func goldenKey(entityID, entityType string) string {
	return fmt.Sprintf("%sgolden:%s:%s", keyPrefix, entityType, entityID)
}
func agentKey(code string) string {
	return fmt.Sprintf("%sagent:%s", keyPrefix, code)
}
func dashboardKey() string  { return fmt.Sprintf("%sdashboard", keyPrefix) }
func issueCountKey() string { return fmt.Sprintf("%scounter:open_issues", keyPrefix) }

func (r *RedisCache) CacheGoldenRecord(ctx context.Context, gr *models.GoldenRecord) error {
	val, err := json.Marshal(gr)
	if err != nil {
		return err
	}
	return r.client.Set(ctx, goldenKey(gr.EntityID, string(gr.EntityType)), val, goldenTTL).Err()
}

func (r *RedisCache) GetGoldenRecord(ctx context.Context, entityID, entityType string) (*models.GoldenRecord, error) {
	val, err := r.client.Get(ctx, goldenKey(entityID, entityType)).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var gr models.GoldenRecord
	if err := json.Unmarshal([]byte(val), &gr); err != nil {
		return nil, err
	}
	return &gr, nil
}

func (r *RedisCache) InvalidateGoldenRecord(ctx context.Context, entityID, entityType string) error {
	return r.client.Del(ctx, goldenKey(entityID, entityType)).Err()
}

func (r *RedisCache) CacheAgentRecord(ctx context.Context, ar *models.AgentRecord) error {
	val, err := json.Marshal(ar)
	if err != nil {
		return err
	}
	return r.client.Set(ctx, agentKey(ar.AgentCode), val, agentTTL).Err()
}

func (r *RedisCache) GetAgentRecord(ctx context.Context, code string) (*models.AgentRecord, error) {
	val, err := r.client.Get(ctx, agentKey(code)).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var ar models.AgentRecord
	if err := json.Unmarshal([]byte(val), &ar); err != nil {
		return nil, err
	}
	return &ar, nil
}

func (r *RedisCache) CacheDashboard(ctx context.Context, dash *models.MasterDataDashboard) error {
	val, err := json.Marshal(dash)
	if err != nil {
		return err
	}
	return r.client.Set(ctx, dashboardKey(), val, dashboardTTL).Err()
}

func (r *RedisCache) GetCachedDashboard(ctx context.Context) (*models.MasterDataDashboard, error) {
	val, err := r.client.Get(ctx, dashboardKey()).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var dash models.MasterDataDashboard
	if err := json.Unmarshal([]byte(val), &dash); err != nil {
		return nil, err
	}
	return &dash, nil
}

func (r *RedisCache) IncrementIssueCount(ctx context.Context) error {
	key := issueCountKey()
	_, err := r.client.Incr(ctx, key).Result()
	if err == nil {
		r.client.Expire(ctx, key, 24*time.Hour)
	}
	return err
}

func (r *RedisCache) DecrementIssueCount(ctx context.Context) error {
	key := issueCountKey()
	_, err := r.client.Decr(ctx, key).Result()
	if err == nil {
		r.client.Expire(ctx, key, 24*time.Hour)
	}
	return err
}

func (r *RedisCache) GetOpenIssueCount(ctx context.Context) (int64, error) {
	key := issueCountKey()
	return r.client.Get(ctx, key).Int64()
}

func (r *RedisCache) PublishMergeEvent(ctx context.Context, goldenRecordID, candidateID string, matchScore float64) error {
	channel := "mdm:merge_events"
	data := map[string]interface{}{
		"event":         "merge_candidate_found",
		"golden_record": goldenRecordID,
		"candidate":     candidateID,
		"match_score":   matchScore,
		"timestamp":     time.Now().Format(time.RFC3339),
	}
	val, _ := json.Marshal(data)
	return r.client.Publish(ctx, channel, val).Err()
}

func (r *RedisCache) PublishSyncEvent(ctx context.Context, syncID, source, target string) error {
	channel := "mdm:sync_events"
	data := map[string]interface{}{
		"event":     "data_sync",
		"sync_id":   syncID,
		"source":    source,
		"target":    target,
		"timestamp": time.Now().Format(time.RFC3339),
	}
	val, _ := json.Marshal(data)
	return r.client.Publish(ctx, channel, val).Err()
}

func (r *RedisCache) PublishQualityEvent(ctx context.Context, entityType, entityID string, score float64) error {
	channel := fmt.Sprintf("mdm:quality:%s", entityType)
	data := map[string]interface{}{
		"event":         "quality_assessed",
		"entity_type":   entityType,
		"entity_id":     entityID,
		"quality_score": score,
		"timestamp":     time.Now().Format(time.RFC3339),
	}
	val, _ := json.Marshal(data)
	return r.client.Publish(ctx, channel, val).Err()
}

func (r *RedisCache) FindFuzzyMatch(ctx context.Context, entityType, searchField, searchValue string) ([]string, error) {
	key := fmt.Sprintf("%sfuzzy:%s:%s", keyPrefix, entityType, searchField)
	pattern := fmt.Sprintf("%s*%s*", key, searchValue[:min(3, len(searchValue))])

	// Use Redis SCAN with pattern for fuzzy matching
	var results []string
	iter := r.client.Scan(ctx, 0, pattern, 100).Iterator()
	for iter.Next(ctx) {
		results = append(results, iter.Val())
	}
	return results, iter.Err()
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
