package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/insureportal/takaful_module/config"
	"github.com/insureportal/takaful_module/models"
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
	keyPrefix     = "takaful:"
	poolTTL       = 5 * time.Minute
	participantTTL = 10 * time.Minute
	productTTL    = 1 * time.Hour
	counterTTL    = 24 * time.Hour
)

func poolKey(id string) string      { return fmt.Sprintf("%spool:%s", keyPrefix, id) }
func participantKey(id string) string { return fmt.Sprintf("%sparticipant:%s", keyPrefix, id) }
func productKey(id string) string    { return fmt.Sprintf("%sproduct:%s", keyPrefix, id) }
func contributionCounterKey() string { return fmt.Sprintf("%scounter:contributions", keyPrefix) }
func poolSnapshotKey(poolID string) string { return fmt.Sprintf("%ssnapshot:%s", keyPrefix, poolID) }

func (r *RedisCache) CachePool(ctx context.Context, pool *models.TabarruPool) error {
	val, err := json.Marshal(pool)
	if err != nil { return err }
	return r.client.Set(ctx, poolKey(pool.ID), val, poolTTL).Err()
}

func (r *RedisCache) GetPool(ctx context.Context, id string) (*models.TabarruPool, error) {
	val, err := r.client.Get(ctx, poolKey(id)).Result()
	if err == redis.Nil { return nil, nil }
	if err != nil { return nil, err }
	var pool models.TabarruPool
	if err := json.Unmarshal([]byte(val), &pool); err != nil { return nil, err }
	return &pool, nil
}

func (r *RedisCache) InvalidatePool(ctx context.Context, id string) error {
	return r.client.Del(ctx, poolKey(id)).Err()
}

func (r *RedisCache) CacheParticipant(ctx context.Context, p *models.Participant) error {
	val, err := json.Marshal(p)
	if err != nil { return err }
	return r.client.Set(ctx, participantKey(p.ID), val, participantTTL).Err()
}

func (r *RedisCache) GetParticipant(ctx context.Context, id string) (*models.Participant, error) {
	val, err := r.client.Get(ctx, participantKey(id)).Result()
	if err == redis.Nil { return nil, nil }
	if err != nil { return nil, err }
	var p models.Participant
	if err := json.Unmarshal([]byte(val), &p); err != nil { return nil, err }
	return &p, nil
}

func (r *RedisCache) CacheProduct(ctx context.Context, p *models.TakafulProduct) error {
	val, err := json.Marshal(p)
	if err != nil { return err }
	return r.client.Set(ctx, productKey(p.ID), val, productTTL).Err()
}

func (r *RedisCache) GetProduct(ctx context.Context, id string) (*models.TakafulProduct, error) {
	val, err := r.client.Get(ctx, productKey(id)).Result()
	if err == redis.Nil { return nil, nil }
	if err != nil { return nil, err }
	var p models.TakafulProduct
	if err := json.Unmarshal([]byte(val), &p); err != nil { return nil, err }
	return &p, nil
}

func (r *RedisCache) IncrementContributionCount(ctx context.Context) error {
	key := contributionCounterKey()
	_, err := r.client.Incr(ctx, key).Result()
	if err == nil { r.client.Expire(ctx, key, counterTTL) }
	return err
}

func (r *RedisCache) GetContributionCount(ctx context.Context) (int64, error) {
	return r.client.Get(ctx, contributionCounterKey()).Int64()
}

func (r *RedisCache) PublishEvent(ctx context.Context, eventType string, data interface{}) error {
	channel := fmt.Sprintf("takaful:events:%s", eventType)
	val, err := json.Marshal(data)
	if err != nil { return err }
	return r.client.Publish(ctx, channel, val).Err()
}

func (r *RedisCache) PublishContributionEvent(ctx context.Context, contrib models.Contribution) error {
	return r.PublishEvent(ctx, "contribution", map[string]interface{}{
		"event":   "contribution_made",
		"amount":  contrib.Amount,
		"tabarru": contrib.TabarruPortion,
		"wakala":  contrib.WakalaFee,
		"participant_id": contrib.ParticipantID,
		"product_id": contrib.ProductID,
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

func (r *RedisCache) PublishClaimEvent(ctx context.Context, claim models.Claim) error {
	return r.PublishEvent(ctx, "claim", map[string]interface{}{
		"event":    "claim_" + claim.Status,
		"amount":   claim.ClaimAmount,
		"paid":     claim.PaidAmount,
		"claim_id": claim.ID,
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

func (r *RedisCache) CachePoolSnapshot(ctx context.Context, snapshot *models.PoolSnapshot) error {
	val, err := json.Marshal(snapshot)
	if err != nil { return err }
	key := poolSnapshotKey(snapshot.PoolID)
	return r.client.Set(ctx, key, val, poolTTL).Err()
}
