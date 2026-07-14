package infra

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// Lua script for atomic rate limiting (no INCR/EXPIRE race condition).
const rateLimitLua = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local current = redis.call('INCR', key)
if current == 1 then
    redis.call('EXPIRE', key, window)
end
if current > max then
    return 0
end
return 1
`

// Lua script for safe lock release (only owner can release).
const releaseLockLua = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
else
    return 0
end
`

// Lua script for pattern-based invalidation with pub/sub notification.
const invalidateLua = `
local deleted = 0
local cursor = "0"
repeat
    local result = redis.call('SCAN', cursor, 'MATCH', KEYS[1], 'COUNT', 100)
    cursor = result[1]
    local keys = result[2]
    for _, key in ipairs(keys) do
        redis.call('DEL', key)
        deleted = deleted + 1
    end
until cursor == "0"
if deleted > 0 then
    redis.call('PUBLISH', '__cache_invalidation__', KEYS[1])
end
return deleted
`

// CircuitState represents the state of the Redis circuit breaker.
type CircuitState int

const (
	CircuitClosed CircuitState = iota
	CircuitOpen
	CircuitHalfOpen
)

// LockGuard represents an acquired distributed lock with owner verification.
type LockGuard struct {
	Key     string
	OwnerID string
}

type RedisClient struct {
	client          *redis.Client
	logger          *zap.Logger
	mu              sync.RWMutex
	circuitState    CircuitState
	failureCount    int
	successCount    int
	lastFailure     time.Time
	circuitTimeout  time.Duration
	failureThreshold int
	successThreshold int
	rateLimitScript *redis.Script
	releaseLockScript *redis.Script
	invalidateScript  *redis.Script
}

func NewRedisClient(logger *zap.Logger, addr string) *RedisClient {
	c := &RedisClient{
		logger:           logger,
		circuitState:     CircuitClosed,
		circuitTimeout:   30 * time.Second,
		failureThreshold: 5,
		successThreshold: 3,
		rateLimitScript:  redis.NewScript(rateLimitLua),
		releaseLockScript: redis.NewScript(releaseLockLua),
		invalidateScript:  redis.NewScript(invalidateLua),
	}
	rdb := redis.NewClient(&redis.Options{
		Addr:            addr,
		PoolSize:        20,
		MinIdleConns:    5,
		MaxRetries:      3,
		DialTimeout:     3 * time.Second,
		ReadTimeout:     2 * time.Second,
		WriteTimeout:    2 * time.Second,
		PoolTimeout:     3 * time.Second,
		ConnMaxLifetime: 30 * time.Minute,
	})
	c.client = rdb

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		logger.Warn("redis_ping_failed", zap.Error(err))
	} else {
		logger.Info("redis_connected", zap.String("addr", addr))
	}
	return c
}

func (c *RedisClient) checkCircuit() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	switch c.circuitState {
	case CircuitClosed:
		return true
	case CircuitOpen:
		if time.Since(c.lastFailure) >= c.circuitTimeout {
			return true // will transition to half-open
		}
		return false
	case CircuitHalfOpen:
		return true
	}
	return true
}

func (c *RedisClient) recordSuccess() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.failureCount = 0
	c.successCount++
	if c.circuitState == CircuitHalfOpen && c.successCount >= c.successThreshold {
		c.circuitState = CircuitClosed
		c.logger.Info("redis_circuit_breaker: closed")
	}
}

func (c *RedisClient) recordFailure() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.failureCount++
	c.successCount = 0
	c.lastFailure = time.Now()
	if c.failureCount >= c.failureThreshold {
		c.circuitState = CircuitOpen
		c.logger.Warn("redis_circuit_breaker: opened", zap.Int("failures", c.failureCount))
	}
}

// GetCircuitState returns the current circuit breaker state.
func (c *RedisClient) GetCircuitState() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	switch c.circuitState {
	case CircuitClosed:
		return "closed"
	case CircuitOpen:
		return "open"
	case CircuitHalfOpen:
		return "half-open"
	}
	return "unknown"
}

func (c *RedisClient) Ping(ctx context.Context) error {
	if c.client == nil {
		return fmt.Errorf("redis not initialized")
	}
	if !c.checkCircuit() {
		return fmt.Errorf("redis circuit breaker is open")
	}
	if err := c.client.Ping(ctx).Err(); err != nil {
		c.recordFailure()
		return err
	}
	c.recordSuccess()
	return nil
}

func (c *RedisClient) Client() *redis.Client { return c.client }

func (c *RedisClient) CacheJSON(ctx context.Context, key string, value interface{}, ttl time.Duration) error {
	if !c.checkCircuit() {
		return fmt.Errorf("redis circuit breaker is open")
	}
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	if err := c.client.Set(ctx, key, data, ttl).Err(); err != nil {
		c.recordFailure()
		return err
	}
	c.recordSuccess()
	return nil
}

func (c *RedisClient) GetCachedJSON(ctx context.Context, key string, dest interface{}) error {
	if !c.checkCircuit() {
		return fmt.Errorf("redis circuit breaker is open")
	}
	data, err := c.client.Get(ctx, key).Bytes()
	if err != nil {
		if err == redis.Nil {
			c.recordSuccess()
			return err
		}
		c.recordFailure()
		return err
	}
	c.recordSuccess()
	return json.Unmarshal(data, dest)
}

// RateLimit uses an atomic Lua script (no INCR/EXPIRE race condition).
func (c *RedisClient) RateLimit(ctx context.Context, key string, maxRequests int64, window time.Duration) (bool, error) {
	if !c.checkCircuit() {
		return true, nil // fail open
	}
	result, err := c.rateLimitScript.Run(ctx, c.client, []string{key}, maxRequests, int(window.Seconds())).Int64()
	if err != nil {
		c.recordFailure()
		return true, err // fail open
	}
	c.recordSuccess()
	return result == 1, nil
}

// AcquireLock acquires a distributed lock with unique owner ID (safe release).
func (c *RedisClient) AcquireLock(ctx context.Context, key string, ttl time.Duration) (*LockGuard, error) {
	if !c.checkCircuit() {
		return nil, fmt.Errorf("redis circuit breaker is open")
	}
	ownerID := fmt.Sprintf("%d-%d", time.Now().UnixNano(), time.Now().UnixMicro())
	lockKey := "lock:" + key
	ok, err := c.client.SetNX(ctx, lockKey, ownerID, ttl).Result()
	if err != nil {
		c.recordFailure()
		return nil, err
	}
	c.recordSuccess()
	if !ok {
		return nil, nil
	}
	return &LockGuard{Key: lockKey, OwnerID: ownerID}, nil
}

// ReleaseLock releases a lock safely — only the owner can release it.
func (c *RedisClient) ReleaseLock(ctx context.Context, guard *LockGuard) (bool, error) {
	if guard == nil {
		return false, nil
	}
	if !c.checkCircuit() {
		return false, fmt.Errorf("redis circuit breaker is open")
	}
	result, err := c.releaseLockScript.Run(ctx, c.client, []string{guard.Key}, guard.OwnerID).Int64()
	if err != nil {
		c.recordFailure()
		return false, err
	}
	c.recordSuccess()
	return result == 1, nil
}

func (c *RedisClient) Publish(ctx context.Context, channel string, message interface{}) error {
	if !c.checkCircuit() {
		return fmt.Errorf("redis circuit breaker is open")
	}
	data, err := json.Marshal(message)
	if err != nil {
		return err
	}
	if err := c.client.Publish(ctx, channel, data).Err(); err != nil {
		c.recordFailure()
		return err
	}
	c.recordSuccess()
	return nil
}

func (c *RedisClient) Subscribe(ctx context.Context, channel string) *redis.PubSub {
	return c.client.Subscribe(ctx, channel)
}

func (c *RedisClient) SetKYCGate(ctx context.Context, userID string, allowed bool, level int, ttl time.Duration) error {
	data := map[string]interface{}{"allowed": allowed, "level": level, "ts": time.Now().Unix()}
	return c.CacheJSON(ctx, "kyc:gate:"+userID, data, ttl)
}

func (c *RedisClient) GetKYCGate(ctx context.Context, userID string) (bool, int, error) {
	var data map[string]interface{}
	if err := c.GetCachedJSON(ctx, "kyc:gate:"+userID, &data); err != nil {
		return false, 0, err
	}
	allowed, _ := data["allowed"].(bool)
	level := int(data["level"].(float64))
	return allowed, level, nil
}

// InvalidatePattern invalidates all keys matching pattern and notifies subscribers.
func (c *RedisClient) InvalidatePattern(ctx context.Context, pattern string) (int64, error) {
	if !c.checkCircuit() {
		return 0, fmt.Errorf("redis circuit breaker is open")
	}
	result, err := c.invalidateScript.Run(ctx, c.client, []string{pattern}).Int64()
	if err != nil {
		c.recordFailure()
		return 0, err
	}
	c.recordSuccess()
	return result, nil
}

// PublishInvalidation publishes a cache invalidation event for cross-service coherence.
func (c *RedisClient) PublishInvalidation(ctx context.Context, entityType, entityID string) error {
	event := map[string]interface{}{
		"type":        "cache_invalidation",
		"entity_type": entityType,
		"entity_id":   entityID,
		"timestamp":   time.Now().Unix(),
	}
	return c.Publish(ctx, "__cache_invalidation__", event)
}

// WarmCache preloads commonly-accessed entries on startup.
func (c *RedisClient) WarmCache(ctx context.Context, entries []struct {
	Key   string
	Value interface{}
	TTL   time.Duration
}) (int64, error) {
	var loaded int64
	for _, e := range entries {
		if err := c.CacheJSON(ctx, e.Key, e.Value, e.TTL); err == nil {
			loaded++
		}
	}
	c.logger.Info("cache_warmup_complete", zap.Int64("loaded", loaded))
	return loaded, nil
}

func (c *RedisClient) PoolStats() *redis.PoolStats {
	if c.client == nil {
		return nil
	}
	return c.client.PoolStats()
}

func (c *RedisClient) Close() {
	if c.client != nil {
		c.client.Close()
	}
}
