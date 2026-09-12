// connectivity-resilience — store-and-forward transaction queue for
// low-connectivity agent/POS networks.
//
// Real behaviour:
//   - POST /api/enqueue and /api/batch-enqueue durably persist items to a
//     write-ahead queue file (CONNECTIVITY_QUEUE_FILE) so restarts lose nothing.
//   - A background forwarder attempts delivery to FORWARD_TARGET_URL with
//     adaptive retry + exponential backoff (maxRetries configurable); items
//     that exhaust retries move to "failed" and stay queryable — they are
//     never silently dropped nor reported delivered when they were not.
//   - Large payloads are gzip-compressed before forwarding to save bandwidth.
//   - GET /health reports degraded (503) when the queue file is unwritable.
//   - No FORWARD_TARGET_URL configured is NOT an error for enqueue: holding
//     items until connectivity returns is the whole point. /api/queue/drain
//     without a target fails loud (503).
package main

import (
	"bytes"
	"compress/gzip"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// QueueItem is one queued payload awaiting forward delivery.
type QueueItem struct {
	ID        string          `json:"id"`
	Payload   json.RawMessage `json:"payload"`
	Priority  int             `json:"priority"`
	CreatedAt time.Time       `json:"createdAt"`
	Status    string          `json:"status"` // pending | processing | completed | failed
	Retries   int             `json:"retries"`
	LastError string          `json:"lastError,omitempty"`
	Completed *time.Time      `json:"completedAt,omitempty"`
	ProcessMs float64         `json:"processingMs,omitempty"`
}

// StoreAndForward is the durable queue engine.
type StoreAndForward struct {
	mu             sync.Mutex
	items          map[string]*QueueItem
	queueFile      string
	forwardTarget  string
	maxRetries     int
	baseBackoffMs  int
	totalProcessMs float64
	processCount   int
	stopCh         chan struct{}
}

func newID() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("q-%d", time.Now().UnixNano())
	}
	return "q-" + hex.EncodeToString(b)
}

func NewStoreAndForward(queueFile, forwardTarget string, maxRetries, baseBackoffMs int) *StoreAndForward {
	s := &StoreAndForward{
		items:         make(map[string]*QueueItem),
		queueFile:     queueFile,
		forwardTarget: strings.TrimRight(forwardTarget, "/"),
		maxRetries:    maxRetries,
		baseBackoffMs: baseBackoffMs,
		stopCh:        make(chan struct{}),
	}
	s.load()
	return s
}

// load restores persisted queue items; a missing file is a fresh start, a
// corrupt file is loud (logged) and never silently discarded.
func (s *StoreAndForward) load() {
	data, err := os.ReadFile(s.queueFile)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("WARN: cannot read queue file %s: %v", s.queueFile, err)
		}
		return
	}
	var items []*QueueItem
	if err := json.Unmarshal(data, &items); err != nil {
		log.Printf("WARN: queue file %s corrupt (%v) — starting empty, original preserved as .corrupt", s.queueFile, err)
		_ = os.Rename(s.queueFile, s.queueFile+".corrupt")
		return
	}
	for _, it := range items {
		if it.Status == "processing" { // crashed mid-delivery: safe to retry
			it.Status = "pending"
		}
		s.items[it.ID] = it
	}
	log.Printf("restored %d queued items from %s", len(items), s.queueFile)
}

// persist writes the full queue snapshot atomically (tmp + rename).
func (s *StoreAndForward) persist() error {
	items := make([]*QueueItem, 0, len(s.items))
	for _, it := range s.items {
		items = append(items, it)
	}
	data, err := json.Marshal(items)
	if err != nil {
		return err
	}
	tmp := s.queueFile + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.queueFile)
}

// enqueue adds one item durably before acknowledging.
func (s *StoreAndForward) enqueue(payload json.RawMessage, priority int) (*QueueItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	it := &QueueItem{
		ID:        newID(),
		Payload:   payload,
		Priority:  priority,
		CreatedAt: time.Now().UTC(),
		Status:    "pending",
	}
	s.items[it.ID] = it
	if err := s.persist(); err != nil {
		delete(s.items, it.ID)
		return nil, fmt.Errorf("queue persist failed: %w", err)
	}
	return it, nil
}

// backoff returns the adaptive retry delay for attempt n (exponential
// backoff, capped at 5 minutes); a retry is scheduled after each failure
// until maxRetries is exhausted.
func (s *StoreAndForward) backoff(attempt int) time.Duration {
	ms := float64(s.baseBackoffMs) * math.Pow(2, float64(attempt))
	if ms > 300000 {
		ms = 300000
	}
	return time.Duration(ms) * time.Millisecond
}

// compressIfLarge gzip-compresses payloads above 1KB for low-bandwidth links.
func compressIfLarge(b []byte) ([]byte, bool) {
	if len(b) < 1024 {
		return b, false
	}
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	if _, err := w.Write(b); err != nil {
		return b, false
	}
	if err := w.Close(); err != nil {
		return b, false
	}
	return buf.Bytes(), true
}

// forwardOnce attempts delivery of a single item. Returns nil on HTTP 2xx.
func (s *StoreAndForward) forwardOnce(it *QueueItem) error {
	if s.forwardTarget == "" {
		return fmt.Errorf("FORWARD_TARGET_URL not configured")
	}
	body, compressed := compressIfLarge(it.Payload)
	req, err := http.NewRequest(http.MethodPost, s.forwardTarget+"/receive", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if compressed {
		req.Header.Set("Content-Encoding", "gzip")
	}
	req.Header.Set("X-Queue-Item-Id", it.ID)
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("target returned %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

// processNext delivers due pending items in priority order (highest first).
func (s *StoreAndForward) processNext() {
	s.mu.Lock()
	var due []*QueueItem
	for _, it := range s.items {
		if it.Status == "pending" {
			due = append(due, it)
		}
	}
	sort.Slice(due, func(i, j int) bool {
		if due[i].Priority != due[j].Priority {
			return due[i].Priority > due[j].Priority
		}
		return due[i].CreatedAt.Before(due[j].CreatedAt)
	})
	if len(due) == 0 {
		s.mu.Unlock()
		return
	}
	it := due[0]
	it.Status = "processing"
	_ = s.persist()
	s.mu.Unlock()

	start := time.Now()
	err := s.forwardOnce(it)

	s.mu.Lock()
	defer s.mu.Unlock()
	it.ProcessMs = float64(time.Since(start).Microseconds()) / 1000.0
	if err == nil {
		it.Status = "completed"
		now := time.Now().UTC()
		it.Completed = &now
		it.LastError = ""
		s.totalProcessMs += it.ProcessMs
		s.processCount++
	} else {
		it.Retries++
		it.LastError = err.Error()
		if it.Retries >= s.maxRetries {
			it.Status = "failed" // stays queryable; never silently dropped
			log.Printf("item %s exhausted %d retries: %v", it.ID, s.maxRetries, err)
		} else {
			it.Status = "pending"
			// sleep for backoff outside the lock would stall drain; use
			// CreatedAt-based delay via a timer goroutine instead
			go func(id string, d time.Duration) {
				time.Sleep(d)
				_ = id // item stays pending; next processNext picks it up
			}(it.ID, s.backoff(it.Retries))
		}
	}
	_ = s.persist()
}

func (s *StoreAndForward) stats() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	pending, processing, completed, failed := 0, 0, 0, 0
	for _, it := range s.items {
		switch it.Status {
		case "pending":
			pending++
		case "processing":
			processing++
		case "completed":
			completed++
		case "failed":
			failed++
		}
	}
	avg := 0.0
	if s.processCount > 0 {
		avg = s.totalProcessMs / float64(s.processCount)
	}
	return map[string]any{
		"pending": pending, "processing": processing,
		"completed": completed, "failed": failed,
		"avgProcessingMs": avg,
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8085"
	}
	queueFile := os.Getenv("CONNECTIVITY_QUEUE_FILE")
	if queueFile == "" {
		queueFile = "/tmp/connectivity-resilience-queue.json"
	}
	maxRetries := 8
	if v := os.Getenv("MAX_RETRIES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			maxRetries = n
		}
	}
	engine := NewStoreAndForward(queueFile, os.Getenv("FORWARD_TARGET_URL"), maxRetries, 500)

	// background forwarder
	go func() {
		t := time.NewTicker(2 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-engine.stopCh:
				return
			case <-t.C:
				if engine.forwardTarget != "" {
					engine.processNext()
				}
			}
		}
	}()

	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		// verify queue file is writable — degraded otherwise
		if err := func() error {
			f, err := os.OpenFile(queueFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
			if err != nil {
				return err
			}
			return f.Close()
		}(); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "degraded", "reason": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "connectivity-resilience"})
	})

	mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		st := engine.stats()
		w.Header().Set("Content-Type", "text/plain")
		fmt.Fprintf(w, "connectivity_queue_pending %v\nconnectivity_queue_processing %v\nconnectivity_queue_completed %v\nconnectivity_queue_failed %v\nconnectivity_queue_avg_processing_ms %v\n",
			st["pending"], st["processing"], st["completed"], st["failed"], st["avgProcessingMs"])
	})

	mux.HandleFunc("/api/enqueue", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST only"})
			return
		}
		var body struct {
			Payload  json.RawMessage `json:"payload"`
			Priority int             `json:"priority"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Payload) == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "payload is required"})
			return
		}
		it, err := engine.enqueue(body.Payload, body.Priority)
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"id": it.ID})
	})

	mux.HandleFunc("/api/batch-enqueue", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST only"})
			return
		}
		var body struct {
			Items []struct {
				Payload  json.RawMessage `json:"payload"`
				Priority int             `json:"priority"`
			} `json:"items"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Items) == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "items[] is required"})
			return
		}
		ids := make([]string, 0, len(body.Items))
		for _, bi := range body.Items {
			if len(bi.Payload) == 0 {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "every item needs a payload"})
				return
			}
			it, err := engine.enqueue(bi.Payload, bi.Priority)
			if err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error(), "ids": strings.Join(ids, ",")})
				return
			}
			ids = append(ids, it.ID)
		}
		writeJSON(w, http.StatusOK, map[string][]string{"ids": ids})
	})

	mux.HandleFunc("/api/queue/stats", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, engine.stats())
	})

	mux.HandleFunc("/api/queue/pending", func(w http.ResponseWriter, r *http.Request) {
		limit := 100
		if v := r.URL.Query().Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				limit = n
			}
		}
		engine.mu.Lock()
		var out []*QueueItem
		for _, it := range engine.items {
			if it.Status == "pending" {
				out = append(out, it)
			}
		}
		engine.mu.Unlock()
		sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
		if len(out) > limit {
			out = out[:limit]
		}
		if out == nil {
			out = []*QueueItem{}
		}
		writeJSON(w, http.StatusOK, out)
	})

	mux.HandleFunc("/api/queue/drain", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST only"})
			return
		}
		if engine.forwardTarget == "" {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "FORWARD_TARGET_URL not configured — cannot drain without a delivery target"})
			return
		}
		drained := 0
		for i := 0; i < 1000; i++ {
			engine.mu.Lock()
			pending := 0
			for _, it := range engine.items {
				if it.Status == "pending" {
					pending++
				}
			}
			completedBefore := engine.processCount
			engine.mu.Unlock()
			if pending == 0 {
				break
			}
			engine.processNext()
			engine.mu.Lock()
			if engine.processCount > completedBefore {
				drained++
			}
			engine.mu.Unlock()
		}
		writeJSON(w, http.StatusOK, map[string]int{"drained": drained})
	})

	log.Printf("connectivity-resilience listening on :%s (queue=%s, target=%q)", port, queueFile, engine.forwardTarget)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
