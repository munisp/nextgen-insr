// Package postgresql provides query optimization utilities
// Inspired by OpenAI's PostgreSQL scaling learnings
package postgresql

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"
)

// QueryOptimizer provides query analysis and optimization
type QueryOptimizer struct {
	metrics     map[string]*QueryStats
	mu          sync.RWMutex
	slowQueryMs int64
	maxJoins    int
}

// QueryStats tracks statistics for a query pattern
type QueryStats struct {
	QueryHash      string
	QueryPattern   string
	ExecutionCount int64
	TotalTimeMs    int64
	AvgTimeMs      int64
	MaxTimeMs      int64
	MinTimeMs      int64
	LastExecuted   time.Time
	IsProblematic  bool
	Warnings       []string
}

// QueryAnalysis contains the analysis results for a query
type QueryAnalysis struct {
	QueryHash   string
	JoinCount   int
	HasSubquery bool
	HasWildcard bool
	HasOrderBy  bool
	HasLimit    bool
	HasIndex    bool
	Warnings    []string
	Suggestions []string
	RiskLevel   string // "low", "medium", "high", "critical"
}

// NewQueryOptimizer creates a new query optimizer
func NewQueryOptimizer() *QueryOptimizer {
	return &QueryOptimizer{
		metrics:     make(map[string]*QueryStats),
		slowQueryMs: 100, // 100ms threshold (OpenAI targets <100ms)
		maxJoins:    4,   // OpenAI warns against 12-table joins
	}
}

// AnalyzeQuery analyzes a SQL query for potential issues
// Based on OpenAI's learnings about problematic query patterns
func (o *QueryOptimizer) AnalyzeQuery(query string) *QueryAnalysis {
	analysis := &QueryAnalysis{
		QueryHash:   hashQuery(query),
		Warnings:    make([]string, 0),
		Suggestions: make([]string, 0),
		RiskLevel:   "low",
	}

	normalizedQuery := strings.ToUpper(strings.TrimSpace(query))

	// Count JOINs - OpenAI had issues with 12-table joins
	joinPattern := regexp.MustCompile(`\bJOIN\b`)
	joins := joinPattern.FindAllString(normalizedQuery, -1)
	analysis.JoinCount = len(joins)

	if analysis.JoinCount > o.maxJoins {
		analysis.Warnings = append(analysis.Warnings,
			fmt.Sprintf("Query has %d JOINs (max recommended: %d). Consider breaking into smaller queries.",
				analysis.JoinCount, o.maxJoins))
		analysis.Suggestions = append(analysis.Suggestions,
			"Move complex join logic to application layer")
		analysis.RiskLevel = "high"
	} else if analysis.JoinCount > 2 {
		analysis.RiskLevel = "medium"
	}

	// Check for subqueries
	if strings.Contains(normalizedQuery, "SELECT") && strings.Count(normalizedQuery, "SELECT") > 1 {
		analysis.HasSubquery = true
		analysis.Warnings = append(analysis.Warnings,
			"Query contains subqueries which may impact performance")
		analysis.Suggestions = append(analysis.Suggestions,
			"Consider using CTEs or breaking into separate queries")
	}

	// Check for SELECT *
	if regexp.MustCompile(`SELECT\s+\*`).MatchString(normalizedQuery) {
		analysis.HasWildcard = true
		analysis.Warnings = append(analysis.Warnings,
			"SELECT * retrieves all columns, which may be inefficient")
		analysis.Suggestions = append(analysis.Suggestions,
			"Specify only required columns")
	}

	// Check for ORDER BY without LIMIT
	analysis.HasOrderBy = strings.Contains(normalizedQuery, "ORDER BY")
	analysis.HasLimit = strings.Contains(normalizedQuery, "LIMIT")

	if analysis.HasOrderBy && !analysis.HasLimit {
		analysis.Warnings = append(analysis.Warnings,
			"ORDER BY without LIMIT may cause full table scan")
		analysis.Suggestions = append(analysis.Suggestions,
			"Add LIMIT clause to prevent unbounded result sets")
	}

	// Check for missing WHERE clause on UPDATE/DELETE
	if (strings.HasPrefix(normalizedQuery, "UPDATE") || strings.HasPrefix(normalizedQuery, "DELETE")) &&
		!strings.Contains(normalizedQuery, "WHERE") {
		analysis.Warnings = append(analysis.Warnings,
			"UPDATE/DELETE without WHERE clause affects all rows")
		analysis.RiskLevel = "critical"
	}

	// Check for LIKE with leading wildcard
	if regexp.MustCompile(`LIKE\s+['"]%`).MatchString(normalizedQuery) {
		analysis.Warnings = append(analysis.Warnings,
			"LIKE with leading wildcard prevents index usage")
		analysis.Suggestions = append(analysis.Suggestions,
			"Consider full-text search or restructure query")
	}

	// Check for NOT IN with subquery
	if regexp.MustCompile(`NOT\s+IN\s*\(`).MatchString(normalizedQuery) {
		analysis.Warnings = append(analysis.Warnings,
			"NOT IN with subquery can be slow, consider NOT EXISTS")
	}

	// Check for functions on indexed columns
	if regexp.MustCompile(`(LOWER|UPPER|COALESCE|DATE|EXTRACT)\s*\(`).MatchString(normalizedQuery) {
		analysis.Warnings = append(analysis.Warnings,
			"Functions on columns may prevent index usage")
		analysis.Suggestions = append(analysis.Suggestions,
			"Consider functional indexes or restructure query")
	}

	return analysis
}

// RecordExecution records query execution metrics
func (o *QueryOptimizer) RecordExecution(query string, durationMs int64) {
	hash := hashQuery(query)

	o.mu.Lock()
	defer o.mu.Unlock()

	stats, exists := o.metrics[hash]
	if !exists {
		stats = &QueryStats{
			QueryHash:    hash,
			QueryPattern: normalizeQuery(query),
			MinTimeMs:    durationMs,
		}
		o.metrics[hash] = stats
	}

	stats.ExecutionCount++
	stats.TotalTimeMs += durationMs
	stats.AvgTimeMs = stats.TotalTimeMs / stats.ExecutionCount
	stats.LastExecuted = time.Now()

	if durationMs > stats.MaxTimeMs {
		stats.MaxTimeMs = durationMs
	}
	if durationMs < stats.MinTimeMs {
		stats.MinTimeMs = durationMs
	}

	// Mark as problematic if consistently slow
	if stats.AvgTimeMs > o.slowQueryMs {
		stats.IsProblematic = true
		stats.Warnings = append(stats.Warnings,
			fmt.Sprintf("Average execution time (%dms) exceeds threshold (%dms)",
				stats.AvgTimeMs, o.slowQueryMs))
	}
}

// GetSlowQueries returns queries that exceed the slow query threshold
func (o *QueryOptimizer) GetSlowQueries() []*QueryStats {
	o.mu.RLock()
	defer o.mu.RUnlock()

	var slowQueries []*QueryStats
	for _, stats := range o.metrics {
		if stats.IsProblematic {
			slowQueries = append(slowQueries, stats)
		}
	}
	return slowQueries
}

// GetQueryStats returns statistics for a specific query
func (o *QueryOptimizer) GetQueryStats(query string) *QueryStats {
	hash := hashQuery(query)

	o.mu.RLock()
	defer o.mu.RUnlock()

	return o.metrics[hash]
}

// hashQuery creates a hash of the query for tracking
func hashQuery(query string) string {
	normalized := normalizeQuery(query)
	hash := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(hash[:8])
}

// normalizeQuery normalizes a query by removing literals
func normalizeQuery(query string) string {
	// Remove string literals
	query = regexp.MustCompile(`'[^']*'`).ReplaceAllString(query, "?")
	// Remove numeric literals
	query = regexp.MustCompile(`\b\d+\b`).ReplaceAllString(query, "?")
	// Normalize whitespace
	query = regexp.MustCompile(`\s+`).ReplaceAllString(query, " ")
	return strings.TrimSpace(query)
}

// QueryTimeout wraps a query with timeout handling
// OpenAI recommends idle_in_transaction_session_timeout
type QueryTimeout struct {
	DefaultTimeout time.Duration
	MaxTimeout     time.Duration
}

// NewQueryTimeout creates a new query timeout handler
func NewQueryTimeout() *QueryTimeout {
	return &QueryTimeout{
		DefaultTimeout: 30 * time.Second,
		MaxTimeout:     60 * time.Second,
	}
}

// WithTimeout executes a query with timeout
func (qt *QueryTimeout) WithTimeout(ctx context.Context, db *sql.DB, query string, args ...interface{}) (*sql.Rows, error) {
	ctx, cancel := context.WithTimeout(ctx, qt.DefaultTimeout)
	defer cancel()

	return db.QueryContext(ctx, query, args...)
}

// WithTimeoutExec executes a write query with timeout
func (qt *QueryTimeout) WithTimeoutExec(ctx context.Context, db *sql.DB, query string, args ...interface{}) (sql.Result, error) {
	ctx, cancel := context.WithTimeout(ctx, qt.DefaultTimeout)
	defer cancel()

	return db.ExecContext(ctx, query, args...)
}

// LazyWriter implements lazy writes to smooth traffic spikes
// Inspired by OpenAI's approach to reduce write pressure
type LazyWriter struct {
	db          *sql.DB
	writeQueue  chan *WriteOperation
	batchSize   int
	flushPeriod time.Duration
	ctx         context.Context
	cancel      context.CancelFunc
	wg          sync.WaitGroup
}

// WriteOperation represents a deferred write operation
type WriteOperation struct {
	Query     string
	Args      []interface{}
	Callback  func(sql.Result, error)
	Priority  int
	CreatedAt time.Time
}

// NewLazyWriter creates a new lazy writer for non-critical updates
func NewLazyWriter(db *sql.DB, batchSize int, flushPeriod time.Duration) *LazyWriter {
	ctx, cancel := context.WithCancel(context.Background())

	lw := &LazyWriter{
		db:          db,
		writeQueue:  make(chan *WriteOperation, 10000),
		batchSize:   batchSize,
		flushPeriod: flushPeriod,
		ctx:         ctx,
		cancel:      cancel,
	}

	lw.wg.Add(1)
	go lw.processWrites()

	return lw
}

// QueueWrite queues a write operation for lazy execution
func (lw *LazyWriter) QueueWrite(query string, args []interface{}, callback func(sql.Result, error)) {
	op := &WriteOperation{
		Query:     query,
		Args:      args,
		Callback:  callback,
		CreatedAt: time.Now(),
	}

	select {
	case lw.writeQueue <- op:
	default:
		// Queue full, execute immediately
		result, err := lw.db.Exec(query, args...)
		if callback != nil {
			callback(result, err)
		}
	}
}

// processWrites processes queued writes in batches
func (lw *LazyWriter) processWrites() {
	defer lw.wg.Done()

	ticker := time.NewTicker(lw.flushPeriod)
	defer ticker.Stop()

	batch := make([]*WriteOperation, 0, lw.batchSize)

	flush := func() {
		if len(batch) == 0 {
			return
		}

		tx, err := lw.db.BeginTx(lw.ctx, nil)
		if err != nil {
			for _, op := range batch {
				if op.Callback != nil {
					op.Callback(nil, err)
				}
			}
			batch = batch[:0]
			return
		}

		for _, op := range batch {
			result, err := tx.Exec(op.Query, op.Args...)
			if op.Callback != nil {
				op.Callback(result, err)
			}
		}

		if err := tx.Commit(); err != nil {
			_ = tx.Rollback()
		}

		batch = batch[:0]
	}

	for {
		select {
		case <-lw.ctx.Done():
			flush()
			return
		case <-ticker.C:
			flush()
		case op := <-lw.writeQueue:
			batch = append(batch, op)
			if len(batch) >= lw.batchSize {
				flush()
			}
		}
	}
}

// Close closes the lazy writer and flushes remaining writes
func (lw *LazyWriter) Close() error {
	lw.cancel()
	lw.wg.Wait()
	return nil
}

// RateLimiter implements rate limiting for batch operations
// OpenAI enforces strict rate limits for backfills
type RateLimiter struct {
	rate   int // Operations per second
	burst  int // Maximum burst size
	tokens chan struct{}
	ctx    context.Context
	cancel context.CancelFunc
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter(rate, burst int) *RateLimiter {
	ctx, cancel := context.WithCancel(context.Background())

	rl := &RateLimiter{
		rate:   rate,
		burst:  burst,
		tokens: make(chan struct{}, burst),
		ctx:    ctx,
		cancel: cancel,
	}

	// Fill initial tokens
	for i := 0; i < burst; i++ {
		rl.tokens <- struct{}{}
	}

	// Start token refill goroutine
	go rl.refillTokens()

	return rl
}

// refillTokens adds tokens at the specified rate
func (rl *RateLimiter) refillTokens() {
	ticker := time.NewTicker(time.Second / time.Duration(rl.rate))
	defer ticker.Stop()

	for {
		select {
		case <-rl.ctx.Done():
			return
		case <-ticker.C:
			select {
			case rl.tokens <- struct{}{}:
			default:
				// Bucket full
			}
		}
	}
}

// Wait waits for a token to become available
func (rl *RateLimiter) Wait(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-rl.ctx.Done():
		return fmt.Errorf("rate limiter closed")
	case <-rl.tokens:
		return nil
	}
}

// Close closes the rate limiter
func (rl *RateLimiter) Close() {
	rl.cancel()
}

// BatchProcessor processes batch operations with rate limiting
type BatchProcessor struct {
	db          *sql.DB
	rateLimiter *RateLimiter
	batchSize   int
}

// NewBatchProcessor creates a new batch processor
func NewBatchProcessor(db *sql.DB, opsPerSecond, batchSize int) *BatchProcessor {
	return &BatchProcessor{
		db:          db,
		rateLimiter: NewRateLimiter(opsPerSecond, opsPerSecond*2),
		batchSize:   batchSize,
	}
}

// ProcessBatch processes a batch of operations with rate limiting
func (bp *BatchProcessor) ProcessBatch(ctx context.Context, operations []func() error) error {
	for i, op := range operations {
		// Rate limit
		if err := bp.rateLimiter.Wait(ctx); err != nil {
			return fmt.Errorf("rate limit wait failed at operation %d: %w", i, err)
		}

		// Execute operation
		if err := op(); err != nil {
			return fmt.Errorf("operation %d failed: %w", i, err)
		}
	}
	return nil
}

// Close closes the batch processor
func (bp *BatchProcessor) Close() {
	bp.rateLimiter.Close()
}
