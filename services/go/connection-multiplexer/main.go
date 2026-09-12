// connection-multiplexer — coalesces concurrent identical upstream requests
// and multiplexes them over a bounded connection pool, so thousands of
// agents on poor links do not each open their own upstream connection.
//
// Real behaviour:
//   - RequestCoalescer: identical in-flight GET requests (same method+path+
//     body hash) share one upstream round trip ("singleflight"); every
//     waiter receives the real response or the real error.
//   - Priority queue: incoming requests are dequeued critical > high >
//     normal > low before acquiring a pooled connection slot.
//   - Connection pooling: a fixed-size pool of upstream connections
//     (http.Transport with bounded MaxConnsPerHost); when the pool is
//     exhausted, requests wait in the priority queue — they are never
//     answered with fabricated data.
//   - UPSTREAM_URL must be configured; /health is degraded (503) without it
//     and /proxy/* fails loud (502/504) on upstream errors.
package main

import (
	"bytes"
	"container/heap"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"
)

// ── priority levels ─────────────────────────────────────────────────────────

const (
	priorityCritical = 0 // critical: fraud blocks, auth
	priorityHigh     = 1 // high: payments
	priorityNormal   = 2 // normal: reads
	priorityLow      = 3 // low: analytics, prefetch
)

func parsePriority(s string) int {
	switch s {
	case "critical":
		return priorityCritical
	case "high":
		return priorityHigh
	case "low":
		return priorityLow
	default:
		return priorityNormal
	}
}

// ── priority queue ──────────────────────────────────────────────────────────

type queuedRequest struct {
	priority int
	seq      uint64
}

type priorityQueue []*queuedRequest

func (q priorityQueue) Len() int { return len(q) }
func (q priorityQueue) Less(i, j int) bool {
	if q[i].priority != q[j].priority {
		return q[i].priority < q[j].priority
	}
	return q[i].seq < q[j].seq
}
func (q priorityQueue) Swap(i, j int) { q[i], q[j] = q[j], q[i] }
func (q *priorityQueue) Push(x any)   { *q = append(*q, x.(*queuedRequest)) }
func (q *priorityQueue) Pop() any {
	old := *q
	n := len(old)
	it := old[n-1]
	*q = old[:n-1]
	return it
}

// ── connection pool semaphore fed by the priority queue ────────────────────

type connPool struct {
	mu    sync.Mutex
	cond  *sync.Cond
	inUse int
	max   int
	queue priorityQueue
	seq   uint64
}

func newConnPool(max int) *connPool {
	p := &connPool{max: max}
	p.cond = sync.NewCond(&p.mu)
	return p
}

// acquire blocks until a connection slot is granted in priority order
// (head of the priority heap first, FIFO within a priority).
func (p *connPool) acquire(priority int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.inUse < p.max && len(p.queue) == 0 {
		p.inUse++
		return
	}
	qr := &queuedRequest{priority: priority, seq: p.seq}
	p.seq++
	heap.Push(&p.queue, qr)
	for {
		if len(p.queue) > 0 && p.queue[0] == qr && p.inUse < p.max {
			heap.Pop(&p.queue)
			p.inUse++
			return
		}
		p.cond.Wait()
	}
}

func (p *connPool) release() {
	p.mu.Lock()
	p.inUse--
	p.cond.Broadcast()
	p.mu.Unlock()
}

// ── request coalescer (singleflight) ────────────────────────────────────────

type coalesceResult struct {
	status int
	header http.Header
	body   []byte
	err    error
}

type inFlight struct {
	done   chan struct{}
	result coalesceResult
}

// RequestCoalescer deduplicates identical in-flight upstream calls.
type RequestCoalescer struct {
	mu     sync.Mutex
	calls  map[string]*inFlight
	hits   uint64
	misses uint64
}

func NewRequestCoalescer() *RequestCoalescer {
	return &RequestCoalescer{calls: make(map[string]*inFlight)}
}

// coalesce executes fn once per key while it is in flight; concurrent
// callers with the same key share the outcome.
func (rc *RequestCoalescer) coalesce(key string, fn func() coalesceResult) coalesceResult {
	rc.mu.Lock()
	if c, ok := rc.calls[key]; ok {
		rc.hits++
		rc.mu.Unlock()
		<-c.done
		return c.result
	}
	c := &inFlight{done: make(chan struct{})}
	rc.calls[key] = c
	rc.misses++
	rc.mu.Unlock()

	c.result = fn()

	rc.mu.Lock()
	delete(rc.calls, key)
	close(c.done)
	rc.mu.Unlock()
	return c.result
}

func (rc *RequestCoalescer) stats() (uint64, uint64) {
	rc.mu.Lock()
	defer rc.mu.Unlock()
	return rc.hits, rc.misses
}

// ── proxy server ────────────────────────────────────────────────────────────

var (
	upstream   string
	pool       *connPool
	coalescer  = NewRequestCoalescer()
	httpClient *http.Client
)

func coalesceKey(r *http.Request, body []byte) string {
	h := sha256.Sum256(append([]byte(r.Method+" "+r.URL.String()+"\x00"), body...))
	return hex.EncodeToString(h[:])
}

func doUpstream(r *http.Request, body []byte) coalesceResult {
	req, err := http.NewRequest(r.Method, upstream+r.URL.RequestURI(), bytes.NewReader(body))
	if err != nil {
		return coalesceResult{err: err}
	}
	for k, vs := range r.Header {
		if k == "Host" || k == "Content-Length" || k == "Connection" {
			continue
		}
		for _, v := range vs {
			req.Header.Add(k, v)
		}
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return coalesceResult{err: err}
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return coalesceResult{err: err}
	}
	return coalesceResult{status: resp.StatusCode, header: resp.Header.Clone(), body: b}
}

func proxyHandler(w http.ResponseWriter, r *http.Request) {
	if upstream == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		fmt.Fprint(w, `{"error":"UPSTREAM_URL not configured"}`)
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 32<<20))
	priority := parsePriority(r.Header.Get("X-Priority"))

	pool.acquire(priority)
	defer pool.release()

	// Only idempotent reads are coalesced; mutations always execute.
	var res coalesceResult
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		res = coalescer.coalesce(coalesceKey(r, body), func() coalesceResult {
			return doUpstream(r, body)
		})
	} else {
		res = doUpstream(r, body)
	}

	if res.err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		fmt.Fprintf(w, `{"error":%q}`, "upstream error: "+res.err.Error())
		return
	}
	for k, vs := range res.header {
		if k == "Content-Length" || k == "Connection" || k == "Transfer-Encoding" {
			continue
		}
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(res.status)
	_, _ = w.Write(res.body)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8096"
	}
	upstream = os.Getenv("UPSTREAM_URL")
	maxConns := 32
	if v := os.Getenv("MAX_UPSTREAM_CONNECTIONS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			maxConns = n
		}
	}
	pool = newConnPool(maxConns)
	httpClient = &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			MaxConnsPerHost:     maxConns,
			MaxIdleConnsPerHost: maxConns,
		},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if upstream == "" {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "degraded", "reason": "UPSTREAM_URL not configured"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "connection-multiplexer"})
	})
	mux.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
		hits, misses := coalescer.stats()
		pool.mu.Lock()
		inUse, waiting := pool.inUse, len(pool.queue)
		pool.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{
			"coalescedHits": hits, "upstreamFetches": misses,
			"connectionsInUse": inUse, "queuedRequests": waiting,
			"maxConnections": maxConns,
		})
	})
	mux.HandleFunc("/", proxyHandler)

	log.Printf("connection-multiplexer listening on :%s (upstream=%q, pool=%d)", port, upstream, maxConns)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
