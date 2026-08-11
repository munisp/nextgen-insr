package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/insureportal/notification_service/config"
	"github.com/insureportal/notification_service/models"
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
	keyPrefix = "notif:"
	notificationTTL = 1 * time.Hour
	rateLimitTTL    = 24 * time.Hour
	queuedCountTTL  = 1 * time.Hour
	dashboardTTL    = 30 * time.Second
)

func notificationKey(id string) string   { return fmt.Sprintf("%snotification:%s", keyPrefix, id) }
func rateLimitKey(customerID, channel string) string {
	return fmt.Sprintf("%srate_limit:%s:%s", keyPrefix, customerID, channel)
}
func dashboardKey() string { return fmt.Sprintf("%sdashboard", keyPrefix) }
func queuedKey() string    { return fmt.Sprintf("%scounter:queued", keyPrefix) }
func sentKey() string      { return fmt.Sprintf("%scounter:sent", keyPrefix) }
func failedKey() string    { return fmt.Sprintf("%scounter:failed", keyPrefix) }

func (r *RedisCache) CacheNotification(ctx context.Context, n *models.Notification) error {
	val, err := json.Marshal(n)
	if err != nil { return err }
	return r.client.Set(ctx, notificationKey(n.ID), val, notificationTTL).Err()
}

func (r *RedisCache) GetNotification(ctx context.Context, id string) (*models.Notification, error) {
	val, err := r.client.Get(ctx, notificationKey(id)).Result()
	if err == redis.Nil { return nil, nil }
	if err != nil { return nil, err }
	var n models.Notification
	if err := json.Unmarshal([]byte(val), &n); err != nil { return nil, err }
	return &n, nil
}

func (r *RedisCache) CheckRateLimit(ctx context.Context, customerID, channel string, limit int) (bool, error) {
	key := rateLimitKey(customerID, channel)
	count, err := r.client.Get(ctx, key).Int()
	if err == redis.Nil {
		count = 0
	} else if err != nil {
		return false, err
	}

	if count >= limit {
		return false, nil // Rate limit exceeded
	}

	if _, err := r.client.Incr(ctx, key).Result(); err != nil {
		return false, err
	}
	r.client.Expire(ctx, key, rateLimitTTL)
	return true, nil
}

func (r *RedisCache) IncrementCounter(ctx context.Context, name string) error {
	key := fmt.Sprintf("%scounter:%s", keyPrefix, name)
	_, err := r.client.Incr(ctx, key).Result()
	if err == nil { r.client.Expire(ctx, key, 24*time.Hour) }
	return err
}

func (r *RedisCache) GetCounter(ctx context.Context, name string) (int64, error) {
	key := fmt.Sprintf("%scounter:%s", keyPrefix, name)
	return r.client.Get(ctx, key).Int64()
}

func (r *RedisCache) CacheDashboard(ctx context.Context, dash *models.NotificationDashboard) error {
	val, err := json.Marshal(dash)
	if err != nil { return err }
	return r.client.Set(ctx, dashboardKey(), val, dashboardTTL).Err()
}

func (r *RedisCache) GetCachedDashboard(ctx context.Context) (*models.NotificationDashboard, error) {
	val, err := r.client.Get(ctx, dashboardKey()).Result()
	if err == redis.Nil { return nil, nil }
	if err != nil { return nil, err }
	var dash models.NotificationDashboard
	if err := json.Unmarshal([]byte(val), &dash); err != nil { return nil, err }
	return &dash, nil
}

func (r *RedisCache) PublishDeliveryEvent(ctx context.Context, n models.Notification, status string) error {
	channel := fmt.Sprintf("notif:delivery:%s", string(n.Channel))
	data := map[string]interface{}{
		"event":        "delivery_" + status,
		"notification": n.NotificationID,
		"channel":      string(n.Channel),
		"status":       status,
		"to":           n.To,
		"timestamp":    time.Now().Format(time.RFC3339),
	}
	val, _ := json.Marshal(data)
	return r.client.Publish(ctx, channel, val).Err()
}

func (r *RedisCache) PublishTemplateEvent(ctx context.Context, code string) error {
	channel := "notif:templates"
	data := map[string]interface{}{
		"event":     "template_updated",
		"code":      code,
		"timestamp": time.Now().Format(time.RFC3339),
	}
	val, _ := json.Marshal(data)
	return r.client.Publish(ctx, channel, val).Err()
}

func (r *RedisCache) GetRetryDelay(attempt int, initialDelay, backoffFactor int) time.Duration {
	delay := time.Duration(initialDelay) * time.Duration(backoffFactor)
	return delay
}

func (r *RedisCache) IsInQuietHours(startTime, endTime string) bool {
	now := time.Now()
	currentHour := now.Hour()
	startParts := splitTime(startTime)
	endParts := splitTime(endTime)

	startH, startM := startParts[0], startParts[1]
	endH, endM := endParts[0], endParts[1]

	current := currentHour*60 + now.Minute()
	start := startH*60 + startM
	end := endH*60 + endM

	if start > end {
		// Spans midnight (e.g., 22:00-07:00)
		return current >= start || current < end
	}
	return current >= start && current < end
}

func splitTime(t string) []int {
	var parts []int
	for _, c := range t {
		if c == ':' {
			parts = append(parts, -1)
			continue
		}
		if len(parts) == 0 {
			parts = append(parts, 0)
		}
		parts[len(parts)-1] = parts[len(parts)-1]*10 + int(c-'0')
	}
	if parts[len(parts)-1] < 0 {
		parts = parts[:len(parts)-1]
	}
	return parts
}
