package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"
)

// ── Minimal dependency-free Redis (RESP2) client ────────────────────────────
//
// The payment store and idempotency ledger must survive process restarts and
// serialize concurrent duplicate requests. go.mod carries no Redis driver and
// new dependencies are not permitted, so this file implements just enough of
// the RESP2 protocol (inline over a pooled single-connection-per-call dial) to
// support GET / SET (NX PX) / DEL / SCAN / EVAL against REDIS_URL.

type redisClient struct {
	addr     string
	password string
	db       int
	timeout  time.Duration
}

func newRedisClient(rawURL string) (*redisClient, error) {
	c := &redisClient{addr: "localhost:6379", timeout: 5 * time.Second}
	u := strings.TrimPrefix(rawURL, "redis://")
	u = strings.TrimPrefix(u, "rediss://")
	// strip auth
	if at := strings.LastIndex(u, "@"); at >= 0 {
		auth := u[:at]
		u = u[at+1:]
		if colon := strings.Index(auth, ":"); colon >= 0 {
			c.password = auth[colon+1:]
		} else {
			c.password = auth
		}
	}
	// strip path (db number)
	if slash := strings.Index(u, "/"); slash >= 0 {
		dbStr := strings.TrimPrefix(u[slash:], "/")
		u = u[:slash]
		if dbStr != "" {
			db, err := strconv.Atoi(strings.Split(dbStr, "?")[0])
			if err != nil {
				return nil, fmt.Errorf("invalid redis db in REDIS_URL: %q", dbStr)
			}
			c.db = db
		}
	}
	if u != "" {
		c.addr = u
	}
	if !strings.Contains(c.addr, ":") {
		c.addr += ":6379"
	}
	return c, nil
}

// do executes a single command on a fresh connection (per-call dial keeps the
// implementation free of pooling/concurrency hazards at gateway request rates).
func (c *redisClient) do(args ...string) (interface{}, error) {
	conn, err := net.DialTimeout("tcp", c.addr, c.timeout)
	if err != nil {
		return nil, fmt.Errorf("redis dial %s: %w", c.addr, err)
	}
	defer func() { _ = conn.Close() }()
	_ = conn.SetDeadline(time.Now().Add(c.timeout))
	r := bufio.NewReader(conn)

	if c.password != "" {
		if _, err := redisRoundTrip(conn, r, "AUTH", c.password); err != nil {
			return nil, fmt.Errorf("redis auth: %w", err)
		}
	}
	if c.db != 0 {
		if _, err := redisRoundTrip(conn, r, "SELECT", strconv.Itoa(c.db)); err != nil {
			return nil, fmt.Errorf("redis select: %w", err)
		}
	}
	return redisRoundTrip(conn, r, args...)
}

func redisRoundTrip(conn net.Conn, r *bufio.Reader, args ...string) (interface{}, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "*%d\r\n", len(args))
	for _, a := range args {
		fmt.Fprintf(&b, "$%d\r\n%s\r\n", len(a), a)
	}
	if _, err := conn.Write([]byte(b.String())); err != nil {
		return nil, err
	}
	return readRESP(r)
}

func readRESP(r *bufio.Reader) (interface{}, error) {
	line, err := r.ReadString('\n')
	if err != nil {
		return nil, err
	}
	if len(line) < 3 {
		return nil, errors.New("redis: malformed reply")
	}
	line = strings.TrimRight(line, "\r\n")
	switch line[0] {
	case '+':
		return line[1:], nil
	case '-':
		return nil, errors.New("redis: " + line[1:])
	case ':':
		return strconv.ParseInt(line[1:], 10, 64)
	case '$':
		n, err := strconv.Atoi(line[1:])
		if err != nil {
			return nil, err
		}
		if n < 0 {
			return nil, nil // nil bulk string
		}
		buf := make([]byte, n+2)
		if _, err := readFull(r, buf); err != nil {
			return nil, err
		}
		return string(buf[:n]), nil
	case '*':
		n, err := strconv.Atoi(line[1:])
		if err != nil {
			return nil, err
		}
		if n < 0 {
			return nil, nil
		}
		arr := make([]interface{}, 0, n)
		for i := 0; i < n; i++ {
			el, err := readRESP(r)
			if err != nil {
				return nil, err
			}
			arr = append(arr, el)
		}
		return arr, nil
	default:
		return nil, fmt.Errorf("redis: unexpected reply type %q", line[0])
	}
}

func readFull(r *bufio.Reader, buf []byte) (int, error) {
	total := 0
	for total < len(buf) {
		n, err := r.Read(buf[total:])
		total += n
		if err != nil {
			return total, err
		}
	}
	return total, nil
}

// ── Durable payment store + idempotency ledger ──────────────────────────────

const (
	idemKeyPrefix    = "pgw:idem:"
	paymentKeyPrefix = "pgw:payment:"
	confirmKeyPrefix = "pgw:confirmed:"
	refundKeyPrefix  = "pgw:refund:"
	// claimTTLMs bounds how long an in-flight initiation holds its reference
	// claim before a crashed request stops blocking retries.
	claimTTLMs = 120000
	// responseTTLSecs is how long the idempotent response is replayable.
	responseTTLSecs = 86400
)

// RedisPaymentStore is a durable, restart-safe payment store. All money
// movement paths fail CLOSED: any Redis error is surfaced to the caller as an
// error, never silently degraded to a process-local cache.
type RedisPaymentStore struct {
	r *redisClient
}

func NewRedisPaymentStore(rawURL string) (*RedisPaymentStore, error) {
	c, err := newRedisClient(rawURL)
	if err != nil {
		return nil, err
	}
	return &RedisPaymentStore{r: c}, nil
}

// Ping verifies the store is reachable.
func (s *RedisPaymentStore) Ping() error {
	_, err := s.r.do("PING")
	return err
}

// ClaimReference atomically claims a payment reference before any provider
// call (SET NX PX). won=true means this caller owns the reference and may
// proceed; won=false means a duplicate request is in flight or completed.
func (s *RedisPaymentStore) ClaimReference(ref string) (won bool, err error) {
	res, err := s.r.do("SET", idemKeyPrefix+ref, "processing", "PX", strconv.Itoa(claimTTLMs), "NX")
	if err != nil {
		return false, err
	}
	return res != nil, nil
}

// CompleteReference stores the final response for idempotent replay.
func (s *RedisPaymentStore) CompleteReference(ref, responseJSON string) error {
	_, err := s.r.do("SET", idemKeyPrefix+ref, responseJSON, "EX", strconv.Itoa(responseTTLSecs))
	return err
}

// ReleaseReference drops a processing claim after a failed provider call so
// the client may retry.
func (s *RedisPaymentStore) ReleaseReference(ref string) {
	_, _ = s.r.do("DEL", idemKeyPrefix+ref)
}

// GetIdempotentResponse returns the stored response JSON for a claimed
// reference ("processing" while in flight, response JSON once complete).
func (s *RedisPaymentStore) GetIdempotentResponse(ref string) (string, error) {
	res, err := s.r.do("GET", idemKeyPrefix+ref)
	if err != nil {
		return "", err
	}
	if res == nil {
		return "", nil
	}
	str, _ := res.(string)
	return str, nil
}

// SavePayment durably stores a payment record.
func (s *RedisPaymentStore) SavePayment(paymentJSON string) error {
	var probe struct {
		Reference string `json:"reference"`
	}
	if err := json.Unmarshal([]byte(paymentJSON), &probe); err != nil || probe.Reference == "" {
		return fmt.Errorf("cannot store payment without reference")
	}
	_, err := s.r.do("SET", paymentKeyPrefix+probe.Reference, paymentJSON)
	return err
}

// GetPayment returns the stored payment JSON, or "" if unknown.
func (s *RedisPaymentStore) GetPayment(ref string) (string, error) {
	res, err := s.r.do("GET", paymentKeyPrefix+ref)
	if err != nil {
		return "", err
	}
	if res == nil {
		return "", nil
	}
	str, _ := res.(string)
	return str, nil
}

// ListPayments scans stored payment records (admin/history views; bounded by
// scanLimit so a large keyspace cannot stall the gateway).
func (s *RedisPaymentStore) ListPayments(scanLimit int) ([]string, error) {
	var out []string
	cursor := "0"
	for {
		res, err := s.r.do("SCAN", cursor, "MATCH", paymentKeyPrefix+"*", "COUNT", "100")
		if err != nil {
			return nil, err
		}
		arr, ok := res.([]interface{})
		if !ok || len(arr) != 2 {
			return nil, errors.New("redis: unexpected SCAN reply")
		}
		cursor, _ = arr[0].(string)
		keys, _ := arr[1].([]interface{})
		for _, k := range keys {
			key, _ := k.(string)
			if key == "" {
				continue
			}
			v, err := s.r.do("GET", key)
			if err != nil {
				return nil, err
			}
			if str, ok := v.(string); ok {
				out = append(out, str)
			}
			if len(out) >= scanLimit {
				return out, nil
			}
		}
		if cursor == "0" {
			return out, nil
		}
	}
}

// ClaimConfirmation atomically records that a payment-confirmation side effect
// (ledger posting + event publication) is being/has been applied. The stored
// JSON tracks which legs completed so provider redeliveries only retry the
// legs that actually failed.
func (s *RedisPaymentStore) ClaimConfirmation(ref string) (state string, won bool, err error) {
	res, err := s.r.do("SET", confirmKeyPrefix+ref, `{"ledger_recorded":false,"event_published":false}`, "NX")
	if err != nil {
		return "", false, err
	}
	if res != nil {
		return "", true, nil
	}
	cur, err := s.r.do("GET", confirmKeyPrefix+ref)
	if err != nil {
		return "", false, err
	}
	str, _ := cur.(string)
	return str, false, nil
}

// UpdateConfirmationState persists progress of the confirmation side effects.
func (s *RedisPaymentStore) UpdateConfirmationState(ref, stateJSON string) error {
	_, err := s.r.do("SET", confirmKeyPrefix+ref, stateJSON)
	return err
}

// ClaimRefund atomically guards a refund against concurrent duplicates.
func (s *RedisPaymentStore) ClaimRefund(ref string) (bool, error) {
	res, err := s.r.do("SET", refundKeyPrefix+ref, "processing", "PX", strconv.Itoa(claimTTLMs), "NX")
	if err != nil {
		return false, err
	}
	return res != nil, nil
}

// ReleaseRefund drops an in-flight refund claim after a provider failure.
func (s *RedisPaymentStore) ReleaseRefund(ref string) {
	_, _ = s.r.do("DEL", refundKeyPrefix+ref)
}

// CompleteRefund marks a refund as durably applied (no expiry: a successful
// refund must never be replayed).
func (s *RedisPaymentStore) CompleteRefund(ref string) error {
	_, err := s.r.do("SET", refundKeyPrefix+ref, "refunded")
	return err
}

// casStatusScript atomically transitions a stored payment's status when its
// current status is one of the allowed predecessors (expected-state WHERE
// clause equivalent). Returns 1 = transitioned, 2 = guard blocked, 0 = missing.
const casStatusScript = `
local v = redis.call('GET', KEYS[1])
if not v then return 0 end
local p = cjson.decode(v)
for i = 3, #ARGV do
	if p.status == ARGV[i] then
		p.status = ARGV[1]
		if ARGV[2] ~= '' then p[ARGV[2]] = true end
		redis.call('SET', KEYS[1], cjson.encode(p))
		return 1
	end
end
return 2
`

// CASPaymentStatus performs a guarded status transition on a stored payment.
func (s *RedisPaymentStore) CASPaymentStatus(ref, newStatus string, allowedFrom ...string) (int64, error) {
	args := []string{"EVAL", casStatusScript, "1", paymentKeyPrefix + ref, newStatus, ""}
	args = append(args, allowedFrom...)
	res, err := s.r.do(args...)
	if err != nil {
		return 0, err
	}
	n, _ := res.(int64)
	return n, nil
}
