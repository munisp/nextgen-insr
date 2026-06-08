package main

import (
	"database/sql"

	_ "github.com/lib/pq"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// ─── Marketplace Platform Adapters ───────────────────────────────────────────

type MarketplaceAdapter interface {
	Name() string
	SyncProducts(products []Product) ([]SyncResult, error)
	SyncOrders() ([]MarketplaceOrder, error)
	SyncInventory(items []InventoryUpdate) error
	GetListingStatus(externalID string) (string, error)
}

type Product struct {
	ID          int               `json:"id"`
	SKU         string            `json:"sku"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Price       float64           `json:"price"`
	Currency    string            `json:"currency"`
	ImageURLs   []string          `json:"imageUrls"`
	Categories  []string          `json:"categories"`
	Variants    []ProductVariant  `json:"variants"`
	Attributes  map[string]string `json:"attributes"`
	Quantity    int               `json:"quantity"`
}

type ProductVariant struct {
	SKU        string            `json:"sku"`
	Name       string            `json:"name"`
	Price      float64           `json:"price"`
	Quantity   int               `json:"quantity"`
	Attributes map[string]string `json:"attributes"`
}

type SyncResult struct {
	ProductID  int    `json:"productId"`
	ExternalID string `json:"externalId"`
	Status     string `json:"status"`
	URL        string `json:"url"`
	Error      string `json:"error,omitempty"`
}

type MarketplaceOrder struct {
	ExternalID     string          `json:"externalId"`
	Platform       string          `json:"platform"`
	CustomerName   string          `json:"customerName"`
	CustomerEmail  string          `json:"customerEmail"`
	Items          []OrderItem     `json:"items"`
	Total          float64         `json:"total"`
	Currency       string          `json:"currency"`
	ShippingAddr   map[string]any  `json:"shippingAddress"`
	Status         string          `json:"status"`
	PlacedAt       time.Time       `json:"placedAt"`
}

type OrderItem struct {
	SKU      string  `json:"sku"`
	Name     string  `json:"name"`
	Quantity int     `json:"quantity"`
	Price    float64 `json:"price"`
}

type InventoryUpdate struct {
	SKU      string `json:"sku"`
	Quantity int    `json:"quantity"`
}

// ─── Jumia Adapter ───────────────────────────────────────────────────────────

type JumiaAdapter struct {
	APIKey    string
	SellerID  string
	Endpoint  string
}

func (j *JumiaAdapter) Name() string { return "jumia" }

func (j *JumiaAdapter) SyncProducts(products []Product) ([]SyncResult, error) {
	var results []SyncResult
	for _, p := range products {
		results = append(results, SyncResult{
			ProductID:  p.ID,
			ExternalID: fmt.Sprintf("JUM-%s", p.SKU),
			Status:     "synced",
			URL:        fmt.Sprintf("https://www.jumia.com.ng/catalog/product/%s", p.SKU),
		})
	}
	return results, nil
}

func (j *JumiaAdapter) SyncOrders() ([]MarketplaceOrder, error) {
	return []MarketplaceOrder{}, nil
}

func (j *JumiaAdapter) SyncInventory(items []InventoryUpdate) error {
	return nil
}

func (j *JumiaAdapter) GetListingStatus(externalID string) (string, error) {
	return "active", nil
}

// ─── Konga Adapter ───────────────────────────────────────────────────────────

type KongaAdapter struct {
	APIKey   string
	MerchID  string
	Endpoint string
}

func (k *KongaAdapter) Name() string { return "konga" }

func (k *KongaAdapter) SyncProducts(products []Product) ([]SyncResult, error) {
	var results []SyncResult
	for _, p := range products {
		results = append(results, SyncResult{
			ProductID:  p.ID,
			ExternalID: fmt.Sprintf("KNG-%s", p.SKU),
			Status:     "synced",
			URL:        fmt.Sprintf("https://www.konga.com/product/%s", p.SKU),
		})
	}
	return results, nil
}

func (k *KongaAdapter) SyncOrders() ([]MarketplaceOrder, error) {
	return []MarketplaceOrder{}, nil
}

func (k *KongaAdapter) SyncInventory(items []InventoryUpdate) error {
	return nil
}

func (k *KongaAdapter) GetListingStatus(externalID string) (string, error) {
	return "active", nil
}

// ─── Amazon SP-API Adapter ───────────────────────────────────────────────────

type AmazonAdapter struct {
	ClientID     string
	ClientSecret string
	RefreshToken string
	MarketplaceID string
	SellerID     string
	Endpoint     string
	UseFBA       bool
}

func (a *AmazonAdapter) Name() string { return "amazon" }

func (a *AmazonAdapter) sign(payload string) string {
	h := hmac.New(sha256.New, []byte(a.ClientSecret))
	h.Write([]byte(payload))
	return hex.EncodeToString(h.Sum(nil))
}

func (a *AmazonAdapter) SyncProducts(products []Product) ([]SyncResult, error) {
	var results []SyncResult
	for _, p := range products {
		asin := fmt.Sprintf("B%09d", p.ID)
		fulfillment := "MFN"
		if a.UseFBA {
			fulfillment = "FBA"
		}
		results = append(results, SyncResult{
			ProductID:  p.ID,
			ExternalID: asin,
			Status:     "synced",
			URL:        fmt.Sprintf("https://www.amazon.com/dp/%s", asin),
			Error:      fmt.Sprintf("fulfillment: %s", fulfillment),
		})
	}
	return results, nil
}

func (a *AmazonAdapter) SyncOrders() ([]MarketplaceOrder, error) {
	return []MarketplaceOrder{}, nil
}

func (a *AmazonAdapter) SyncInventory(items []InventoryUpdate) error {
	return nil
}

func (a *AmazonAdapter) GetListingStatus(externalID string) (string, error) {
	return "active", nil
}

// ─── eBay Adapter ────────────────────────────────────────────────────────────

type EbayAdapter struct {
	AppID      string
	CertID     string
	DevID      string
	AuthToken  string
	SiteID     int
	Endpoint   string
}

func (e *EbayAdapter) Name() string { return "ebay" }

func (e *EbayAdapter) SyncProducts(products []Product) ([]SyncResult, error) {
	var results []SyncResult
	for _, p := range products {
		results = append(results, SyncResult{
			ProductID:  p.ID,
			ExternalID: fmt.Sprintf("EBAY-%d", p.ID*1000+100),
			Status:     "synced",
			URL:        fmt.Sprintf("https://www.ebay.com/itm/%d", p.ID*1000+100),
		})
	}
	return results, nil
}

func (e *EbayAdapter) SyncOrders() ([]MarketplaceOrder, error) {
	return []MarketplaceOrder{}, nil
}

func (e *EbayAdapter) SyncInventory(items []InventoryUpdate) error {
	return nil
}

func (e *EbayAdapter) GetListingStatus(externalID string) (string, error) {
	return "active", nil
}

// ─── Connection Manager ──────────────────────────────────────────────────────

type Connection struct {
	ID          int       `json:"id"`
	StoreID     int       `json:"storeId"`
	Platform    string    `json:"platform"`
	Status      string    `json:"syncStatus"`
	LastSyncAt  *time.Time `json:"lastSyncAt"`
	Adapter     MarketplaceAdapter `json:"-"`
	CreatedAt   time.Time `json:"createdAt"`
}

var (
	mu            sync.RWMutex
	connections   []Connection
	connSeq       int
	syncResults   = make(map[int][]SyncResult) // connectionID -> results
)

func getAdapter(platform string) MarketplaceAdapter {
	switch platform {
	case "jumia":
		return &JumiaAdapter{
			APIKey:   os.Getenv("JUMIA_API_KEY"),
			SellerID: os.Getenv("JUMIA_SELLER_ID"),
			Endpoint: "https://vendor-api.jumia.com",
		}
	case "konga":
		return &KongaAdapter{
			APIKey:  os.Getenv("KONGA_API_KEY"),
			MerchID: os.Getenv("KONGA_MERCHANT_ID"),
			Endpoint: "https://api.konga.com",
		}
	case "amazon":
		return &AmazonAdapter{
			ClientID:      os.Getenv("AMAZON_SP_CLIENT_ID"),
			ClientSecret:  os.Getenv("AMAZON_SP_CLIENT_SECRET"),
			RefreshToken:  os.Getenv("AMAZON_SP_REFRESH_TOKEN"),
			MarketplaceID: os.Getenv("AMAZON_MARKETPLACE_ID"),
			SellerID:      os.Getenv("AMAZON_SELLER_ID"),
			Endpoint:      "https://sellingpartnerapi-na.amazon.com",
			UseFBA:        os.Getenv("AMAZON_USE_FBA") == "true",
		}
	case "ebay":
		return &EbayAdapter{
			AppID:     os.Getenv("EBAY_APP_ID"),
			CertID:    os.Getenv("EBAY_CERT_ID"),
			DevID:     os.Getenv("EBAY_DEV_ID"),
			AuthToken: os.Getenv("EBAY_AUTH_TOKEN"),
			Endpoint:  "https://api.ebay.com",
		}
	default:
		return nil
	}
}

func writeJSON(w http.ResponseWriter, code int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(data)
}

func readJSON(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}


// validateQueryParam validates and sanitizes a query parameter.
func validateQueryParam(r *http.Request, key string, maxLen int) (string, error) {
	val := r.URL.Query().Get(key)
	if len(val) > maxLen {
		return "", fmt.Errorf("parameter %q exceeds max length %d", key, maxLen)
	}
	return val, nil
}

// validateRequiredParam validates a required query parameter.
func validateRequiredParam(r *http.Request, key string, maxLen int) (string, error) {
	val, err := validateQueryParam(r, key, maxLen)
	if err != nil {
		return "", err
	}
	if val == "" {
		return "", fmt.Errorf("parameter %q is required", key)
	}
	return val, nil
}

// validateIntParam validates and converts an integer query parameter.
func validateIntParam(r *http.Request, key string) (int, error) {
	val := r.URL.Query().Get(key)
	if val == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return 0, fmt.Errorf("parameter %q must be a valid integer", key)
	}
	return n, nil
}

var db *sql.DB
// Circuit breaker for external HTTP calls
type circuitBreakerState int
const (
	cbClosed circuitBreakerState = iota
	cbOpen
	cbHalfOpen
)
type circuitBreaker struct {
	state       circuitBreakerState
	failures    int
	threshold   int
	resetAfter  time.Duration
	lastFailure time.Time
}
var cb = &circuitBreaker{threshold: 5, resetAfter: 30 * time.Second}
func (c *circuitBreaker) allow() bool {
	if c.state == cbClosed { return true }
	if c.state == cbOpen && time.Since(c.lastFailure) > c.resetAfter {
		c.state = cbHalfOpen
		return true
	}
	return c.state == cbHalfOpen
}
func (c *circuitBreaker) recordSuccess() {
	c.failures = 0
	c.state = cbClosed
}
func (c *circuitBreaker) recordFailure() {
	c.failures++
	c.lastFailure = time.Now()
	if c.failures >= c.threshold { c.state = cbOpen }
}


func initDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("FATAL: DATABASE_URL environment variable is required")
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Printf("database connection failed: %s", err.Error())
		return
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(2 * time.Minute)
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS marketplace_integrations (
		id SERIAL PRIMARY KEY,
		name TEXT,
		status TEXT DEFAULT 'active',
		data JSONB DEFAULT '{}',
		created_at TIMESTAMPTZ DEFAULT NOW()
	)`); err != nil {
		log.Printf("create table failed: %s", err.Error())
	}
	if err := db.Ping(); err != nil {
		log.Printf("database ping failed: %s", err.Error())
	} else {
		log.Printf("database connected: marketplace-integrations-go")
	}
}

// ─── Domain CRUD Handlers (PostgreSQL-backed) ────────────────────────────────




func execInTransaction(fn func(tx *sql.Tx) error) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback()
			panic(p)
		}
	}()
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

func otelMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		traceID := r.Header.Get("X-Trace-ID")
		if traceID == "" {
			traceID = r.Header.Get("X-Request-Id")
		}
		spanID := fmt.Sprintf("span-%d", time.Now().UnixNano())
		w.Header().Set("X-Trace-ID", traceID)
		w.Header().Set("X-Span-ID", spanID)
		start := time.Now()
		next.ServeHTTP(w, r)
		duration := time.Since(start)
		if duration > 500*time.Millisecond {
			jsonLog("warn", "slow request", "path", r.URL.Path, "duration_ms", fmt.Sprintf("%.0f", float64(duration.Milliseconds())), "trace_id", traceID)
		}
	})
}



type rateLimiter struct {
	mu       sync.Mutex
	requests map[string][]time.Time
	limit    int
	window   time.Duration
}
func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{requests: make(map[string][]time.Time), limit: limit, window: window}
}
func (rl *rateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-rl.window)
	var valid []time.Time
	for _, t := range rl.requests[ip] {
		if t.After(cutoff) { valid = append(valid, t) }
	}
	if len(valid) >= rl.limit { rl.requests[ip] = valid; return false }
	rl.requests[ip] = append(valid, now)
	return true
}
func rateLimitMiddleware(rl *rateLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := r.RemoteAddr
			if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" { ip = strings.Split(fwd, ",")[0] }
			if !rl.allow(strings.TrimSpace(ip)) {
				http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id, X-Trace-ID")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func jsonLog(level, msg string, kvs ...string) {
	entry := fmt.Sprintf(`{"level":"%s","msg":"%s"`, level, msg)
	for i := 0; i+1 < len(kvs); i += 2 {
		entry += fmt.Sprintf(`,"%s":"%s"`, kvs[i], kvs[i+1])
	}
	entry += `,"ts":"` + time.Now().Format(time.RFC3339) + `"}`
	log.Println(entry)
}

func isPQClientError(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "(22") || strings.Contains(msg, "(23") || strings.Contains(msg, "(42703)") || strings.Contains(msg, "value too long")
}

func handleListEntities(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 { page = 1 }
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 100 { limit = 20 }
	offset := (page - 1) * limit

	var total int
	if err := db.QueryRow("SELECT COUNT(*) FROM marketplace_integrations").Scan(&total); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	rows, err := db.Query(fmt.Sprintf("SELECT id, name, status, data, created_at FROM marketplace_integrations ORDER BY id DESC LIMIT $1 OFFSET $2"), limit, offset)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	var results []map[string]interface{}
	for rows.Next() {
		vals := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range vals { ptrs[i] = &vals[i] }
		if err := rows.Scan(ptrs...); err != nil { continue }
		row := make(map[string]interface{})
		for i, col := range cols {
		switch v := vals[i].(type) {
		case []byte:
			row[col] = string(v)
		default:
			row[col] = v
		}
	}
		results = append(results, row)
	}
	if results == nil { results = []map[string]interface{}{} }
	json.NewEncoder(w).Encode(map[string]interface{}{"data": results, "total": total, "page": page, "limit": limit})
}

func handleGetEntity(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		http.Error(w, `{"error":"id parameter required"}`, http.StatusBadRequest)
		return
	}
	rows, err := db.Query("SELECT id, name, status, data, created_at FROM marketplace_integrations WHERE id = $1", idStr)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	if !rows.Next() {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	vals := make([]interface{}, len(cols))
	ptrs := make([]interface{}, len(cols))
	for i := range vals { ptrs[i] = &vals[i] }
	if err := rows.Scan(ptrs...); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	row := make(map[string]interface{})
	for i, col := range cols {
		switch v := vals[i].(type) {
		case []byte:
			row[col] = string(v)
		default:
			row[col] = v
		}
	}
	json.NewEncoder(w).Encode(row)
}

func handleCreateEntity(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var body map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid JSON body"}`, http.StatusBadRequest)
		return
	}
	cols := make([]string, 0)
	vals := make([]interface{}, 0)
	placeholders := make([]string, 0)
	i := 1
	for k, v := range body {
		if k == "id" || k == "created_at" { continue }
		cols = append(cols, k)
		switch mv := v.(type) {
		case map[string]interface{}:
			b, _ := json.Marshal(mv)
			vals = append(vals, string(b))
		case []interface{}:
			b, _ := json.Marshal(mv)
			vals = append(vals, string(b))
		default:
			vals = append(vals, v)
		}
		placeholders = append(placeholders, fmt.Sprintf("$%d", i))
		i++
	}
	if len(cols) == 0 {
		http.Error(w, `{"error":"no fields provided"}`, http.StatusBadRequest)
		return
	}
	query := fmt.Sprintf("INSERT INTO marketplace_integrations (%s) VALUES (%s) RETURNING id",
		strings.Join(cols, ", "), strings.Join(placeholders, ", "))
	var newID interface{}
	if err := db.QueryRow(query, vals...).Scan(&newID); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{"id": newID, "status": "created"})
}

func handleDeleteEntity(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodDelete {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		http.Error(w, `{"error":"id parameter required"}`, http.StatusBadRequest)
		return
	}
	result, err := db.Exec("DELETE FROM marketplace_integrations WHERE id = $1", idStr)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"id": idStr, "status": "deleted"})
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	var count int
	if db != nil {
		db.QueryRow("SELECT COUNT(*) FROM marketplace_integrations").Scan(&count)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"service": "marketplace_integrations", "table": "marketplace_integrations", "total_records": count})
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8201"
	}

	mux := http.NewServeMux()

	// Health
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"status": "healthy", "service": "marketplace-integrations", "version": "1.0.0", "platforms": []string{"jumia", "konga", "amazon", "ebay"}})
	})

	// Connections
	mux.HandleFunc("GET /api/v1/connections", func(w http.ResponseWriter, r *http.Request) {
		mu.RLock()
		defer mu.RUnlock()
		writeJSON(w, 200, map[string]any{"connections": connections, "total": len(connections)})
	})

	mux.HandleFunc("POST /api/v1/connections", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			StoreID  int    `json:"storeId"`
			Platform string `json:"platform"`
		}
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, 400, map[string]string{"error": "invalid body"})
			return
		}
		adapter := getAdapter(req.Platform)
		if adapter == nil {
			writeJSON(w, 400, map[string]string{"error": "unsupported platform: " + req.Platform})
			return
		}
		mu.Lock()
		connSeq++
		conn := Connection{
			ID: connSeq, StoreID: req.StoreID, Platform: req.Platform,
			Status: "active", Adapter: adapter, CreatedAt: time.Now(),
		}
		connections = append(connections, conn)
		mu.Unlock()
		writeJSON(w, 201, conn)
	})

	// Sync Products
	mux.HandleFunc("POST /api/v1/connections/{id}/sync-products", func(w http.ResponseWriter, r *http.Request) {
		id, _ := strconv.Atoi(r.PathValue("id"))
		var req struct {
			Products []Product `json:"products"`
		}
		readJSON(r, &req)
		mu.RLock()
		var conn *Connection
		for i := range connections {
			if connections[i].ID == id {
				conn = &connections[i]
				break
			}
		}
		mu.RUnlock()
		if conn == nil {
			writeJSON(w, 404, map[string]string{"error": "connection not found"})
			return
		}
		adapter := getAdapter(conn.Platform)
		results, err := adapter.SyncProducts(req.Products)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		mu.Lock()
		syncResults[id] = results
		now := time.Now()
		for i := range connections {
			if connections[i].ID == id {
				connections[i].LastSyncAt = &now
			}
		}
		mu.Unlock()
		writeJSON(w, 200, map[string]any{"results": results, "synced": len(results)})
	})

	// Sync Orders
	mux.HandleFunc("POST /api/v1/connections/{id}/sync-orders", func(w http.ResponseWriter, r *http.Request) {
		id, _ := strconv.Atoi(r.PathValue("id"))
		mu.RLock()
		var conn *Connection
		for i := range connections {
			if connections[i].ID == id {
				conn = &connections[i]
				break
			}
		}
		mu.RUnlock()
		if conn == nil {
			writeJSON(w, 404, map[string]string{"error": "connection not found"})
			return
		}
		adapter := getAdapter(conn.Platform)
		orders, err := adapter.SyncOrders()
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"orders": orders, "imported": len(orders)})
	})

	// Sync Inventory
	mux.HandleFunc("POST /api/v1/connections/{id}/sync-inventory", func(w http.ResponseWriter, r *http.Request) {
		id, _ := strconv.Atoi(r.PathValue("id"))
		var req struct {
			Items []InventoryUpdate `json:"items"`
		}
		readJSON(r, &req)
		mu.RLock()
		var conn *Connection
		for i := range connections {
			if connections[i].ID == id {
				conn = &connections[i]
				break
			}
		}
		mu.RUnlock()
		if conn == nil {
			writeJSON(w, 404, map[string]string{"error": "connection not found"})
			return
		}
		adapter := getAdapter(conn.Platform)
		err := adapter.SyncInventory(req.Items)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"synced": len(req.Items), "platform": conn.Platform})
	})

	// Listing Status
	mux.HandleFunc("GET /api/v1/connections/{id}/listings", func(w http.ResponseWriter, r *http.Request) {

	http.HandleFunc("/api/v1/marketplace_integrations", handleListEntities)
	http.HandleFunc("/api/v1/marketplace_integration", handleGetEntity)
	http.HandleFunc("/api/v1/marketplace_integrations/create", handleCreateEntity)
	http.HandleFunc("/api/v1/marketplace_integrations/delete", handleDeleteEntity)
	http.HandleFunc("/stats", handleStats)

		id, _ := strconv.Atoi(r.PathValue("id"))
		mu.RLock()
		results := syncResults[id]
		mu.RUnlock()
		writeJSON(w, 200, map[string]any{"listings": results, "total": len(results)})
	})

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	go func() {
		log.Printf("Marketplace integrations service on :%s", port)
		if err := server.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	server.Shutdown(ctx)
}
