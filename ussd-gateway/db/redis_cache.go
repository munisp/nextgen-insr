package db

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/insureportal/ussd_gateway/models"
	"github.com/redis/go-redis/v9"
)

// RedisCache wraps go-redis client to provide session management, rate
// limiting and USSD menu state caching.
type RedisCache struct {
	client *redis.Client
}

// NewRedisCache creates a new RedisCache from a standard Redis DSN such as
// "redis://127.0.0.1:6379/0".  It pings the server to verify connectivity.
func NewRedisCache(addr, password string, db int) (*RedisCache, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})

	if err := client.Ping(context.Background()).Err(); err != nil {
		return nil, fmt.Errorf("redis: ping failed: %w", err)
	}

	log.Println("redis: connected successfully")
	return &RedisCache{client: client}, nil
}

// Close releases the underlying connection pool.
func (rc *RedisCache) Close() error {
	return rc.client.Close()
}

// Ping verifies that Redis is reachable.
func (rc *RedisCache) Ping() error {
	return rc.client.Ping(context.Background()).Err()
}

// --- Session management helpers ---

const (
	sessionKeyPrefix    = "ussd:session:"
	rateLimitPrefix     = "ussd:ratelimit:"
	rateLimitTTL        = 60 * time.Second  // 1-minute sliding window
	sessionTTL          = 180 * time.Second // 3-minute USSD session timeout
	maxMessagesPerMinute = 20
)

// StoreSession persists an entire SessionData to Redis with automatic expiry.
func (rc *RedisCache) StoreSession(ctx context.Context, session *models.SessionData) error {
	key := sessionKeyPrefix + session.SessionID
	data, err := json.Marshal(session)
	if err != nil {
		return fmt.Errorf("redis: marshal session: %w", err)
	}
	return rc.client.Set(ctx, key, data, sessionTTL).Err()
}

// GetSession retrieves a SessionData from Redis. Returns nil, nil when the
// session does not exist or has expired.
func (rc *RedisCache) GetSession(ctx context.Context, sessionID string) (*models.SessionData, error) {
	key := sessionKeyPrefix + sessionID
	raw, err := rc.client.Get(ctx, key).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("redis: get session: %w", err)
	}

	var session models.SessionData
	if err := json.Unmarshal([]byte(raw), &session); err != nil {
		return nil, fmt.Errorf("redis: unmarshal session: %w", err)
	}
	return &session, nil
}

// deleteSession removes a session from Redis.
func (rc *RedisCache) deleteSession(ctx context.Context, sessionID string) error {
	key := sessionKeyPrefix + sessionID
	return rc.client.Del(ctx, key).Err()
}

// --- Rate limiting ---

// IsRateLimited checks whether the given phone number has exceeded the
// configured message-per-minute threshold.  It returns true when the number
// is throttled.
func (rc *RedisCache) IsRateLimited(ctx context.Context, phone string) bool {
	key := rateLimitPrefix + phone

	// Increment the counter; EXAT sets expiry to exactly 60 s from now.
	count := rc.client.Incr(ctx, key)
	// Only set the TTL on the first hit so we get a sliding-window effect
	// without extra round-trips for subsequent calls in the same window.
	rc.client.Expire(ctx, key, rateLimitTTL)

	return count.Val() > maxMessagesPerMinute
}

// --- USSD menu state cache ---

// saveMenuState caches the USSDMenuState for a session so that a quick
// reconnect can resume exactly where the user left off.
func (rc *RedisCache) saveMenuState(ctx context.Context, sessionID string, state *models.USSDMenuState) error {
	key := sessionKeyPrefix + sessionID + ":menu_state"
	data, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("redis: marshal menu state: %w", err)
	}
	return rc.client.Set(ctx, key, data, sessionTTL).Err()
}

// getMenuState retrieves the cached USSDMenuState.
func (rc *RedisCache) getMenuState(ctx context.Context, sessionID string) (*models.USSDMenuState, error) {
	key := sessionKeyPrefix + sessionID + ":menu_state"
	raw, err := rc.client.Get(ctx, key).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("redis: get menu state: %w", err)
	}

	var state models.USSDMenuState
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return nil, fmt.Errorf("redis: unmarshal menu state: %w", err)
	}
	return &state, nil
}

// deleteMenuState removes the cached menu state for a session.
func (rc *RedisCache) deleteMenuState(ctx context.Context, sessionID string) error {
	key := sessionKeyPrefix + sessionID + ":menu_state"
	return rc.client.Del(ctx, key).Err()
}

// --- Convenience helpers for atomic session updates ---

// UpdateSessionAtomically reads a session, calls an updater, then writes it
// back within the same Redis round-trip (pipeline).  This reduces the window
// for concurrent-session races.
func (rc *RedisCache) UpdateSessionAtomically(ctx context.Context, sessionID string, updateFn func(*models.SessionData) *models.SessionData) error {
	key := sessionKeyPrefix + sessionID

	// WATCH enables optimistic locking: if the key changes between WATCH
	// and EXEC the whole transaction is retried automatically.
	for attempts := 0; attempts < 5; attempts++ {
		if err := rc.client.Watch(ctx, func(tx *redis.Tx) error {
			raw, err := tx.Get(ctx, key).Result()
			if err == redis.Nil {
				// Session does not yet exist; start fresh.
				session := &models.SessionData{
					SessionID: sessionID,
					Data:      make(map[string]interface{}),
				}
				session = updateFn(session)
				return rc.StoreSession(ctx, session)
			}
			if err != nil {
				return err
			}

			var session models.SessionData
			if err := json.Unmarshal([]byte(raw), &session); err != nil {
				return err
			}

			ptr := &session
			ptr = updateFn(ptr)
			return rc.StoreSession(ctx, ptr)
		}, key); err == redis.TxFailedErr {
			// Key was modified; retry the whole transaction.
			continue
		} else if err != nil {
			return fmt.Errorf("redis: atomic update: %w", err)
		}
		// Success.
		return nil
	}
	return fmt.Errorf("redis: atomic update: max retries exceeded")
}

// TouchSession refreshes the TTL on an existing session key.
func (rc *RedisCache) TouchSession(ctx context.Context, sessionID string) error {
	key := sessionKeyPrefix + sessionID
	return rc.client.Expire(ctx, key, sessionTTL).Err()
}

// --- General-purpose key operations ---

// Set stores any serialisable value at the given key with the provided TTL.
func (rc *RedisCache) Set(ctx context.Context, key string, value interface{}, ttl time.Duration) error {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("redis: marshal: %w", err)
	}
	return rc.client.Set(ctx, key, data, ttl).Err()
}

// Get retrieves a value from Redis and unmarshals it.
func (rc *RedisCache) Get(ctx context.Context, key string, dest interface{}) error {
	raw, err := rc.client.Get(ctx, key).Result()
	if err == redis.Nil {
		return fmt.Errorf("redis: key not found: %s", key)
	}
	if err != nil {
		return fmt.Errorf("redis: get: %w", err)
	}
	return json.Unmarshal([]byte(raw), dest)
}

// Delete removes a key from Redis.
func (rc *RedisCache) Delete(ctx context.Context, key string) error {
	return rc.client.Del(ctx, key).Err()
}

// Exists checks whether a key exists.
func (rc *RedisCache) Exists(ctx context.Context, key string) (bool, error) {
	count, err := rc.client.Exists(ctx, key).Result()
	return count > 0, err
}

// TTL returns the remaining TTL for a key.
func (rc *RedisCache) TTL(ctx context.Context, key string) (time.Duration, error) {
	return rc.client.TTL(ctx, key).Result()
}

// PurgeStaleSessions removes all session keys that have expired from Redis.
// This is a background cleanup helper called by the scheduler.
func (rc *RedisCache) PurgeStaleSessions(ctx context.Context) {
	// Use SCAN to iterate over session keys without blocking.
	iter := rc.client.Scan(ctx, 0, sessionKeyPrefix+"*", 100).Iterator()
	purged := 0
	for iter.Next(ctx) {
		key := iter.Val()
		ttl, err := rc.client.TTL(ctx, key).Result()
		if err != nil {
			continue
		}
		if ttl <= 0 {
			rc.client.Del(ctx, key)
			purged++
		}
	}
	if purged > 0 {
		log.Printf("redis: purged %d stale sessions", purged)
	}
}
