// dedupe.go — Q5 (2026-09-25). Redis SETNX dedupe (go-redis v9, same client
// as fraud-detection-go). The DB UNIQUE(parametric_events.event_key)
// constraint remains the ultimate guard when Redis is unavailable.
package main

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

type RedisDeduper struct{ cli *redis.Client }

func NewRedisDeduper(ctx context.Context, redisURL string) (*RedisDeduper, error) {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}
	cli := redis.NewClient(opt)
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := cli.Ping(pingCtx).Err(); err != nil {
		_ = cli.Close()
		return nil, err
	}
	return &RedisDeduper{cli: cli}, nil
}

// Acquire = SET key 1 NX EX ttl — true when this caller won the window.
func (r *RedisDeduper) Acquire(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	return r.cli.SetNX(ctx, key, 1, ttl).Result()
}

func (r *RedisDeduper) Close() error { return r.cli.Close() }
