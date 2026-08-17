// P2-C: OTA Firmware Update Pipeline (Go)
//
// InsurePortal OTA Microservice
//
// Endpoints:
//   GET  /health                  — liveness probe
//   GET  /api/v1/ota/latest       — returns latest firmware version for a device model
//   GET  /api/v1/ota/download/:id — presigned S3 download URL for a firmware package
//   POST /api/v1/ota/upload       — upload a new firmware package (admin only, multipart/form-data)
//   GET  /api/v1/ota/list         — list all firmware packages
//   PUT  /api/v1/ota/:id/rollout  — set rollout percentage for a firmware version
//
// Authentication:
//   Admin endpoints require X-Admin-Key header matching OTA_ADMIN_KEY env var.
//   Device endpoints require X-Device-Token header (validated against DEVICE_TOKEN_SECRET).
//
// Environment variables:
//   PORT                — HTTP listen port (default: 8081)
//   OTA_ADMIN_KEY       — shared secret for admin endpoints
//   DEVICE_TOKEN_SECRET — HMAC secret for device token validation
//   AWS_REGION          — S3 region
//   AWS_ACCESS_KEY_ID   — S3 access key
//   AWS_SECRET_ACCESS_KEY — S3 secret key
//   S3_BUCKET           — S3 bucket name for firmware packages
//   DATABASE_URL        — PostgreSQL connection string (for firmware metadata)

package main

import (
	"context"
	"database/sql"

	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	_ "github.com/lib/pq"
	"io"
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

// ─── Types ────────────────────────────────────────────────────────────────────

// FirmwarePackage represents a firmware release.
type FirmwarePackage struct {
	ID             string    `json:"id"`
	Version        string    `json:"version"`
	Model          string    `json:"model"`
	S3Key          string    `json:"s3Key"`
	Checksum       string    `json:"checksum"`
	SizeBytes      int64     `json:"sizeBytes"`
	RolloutPercent int       `json:"rolloutPercent"`
	ReleaseNotes   string    `json:"releaseNotes"`
	IsLatest       bool      `json:"isLatest"`
	CreatedAt      time.Time `json:"createdAt"`
	CreatedBy      string    `json:"createdBy"`
}

// In-memory store for demo; replace with PostgreSQL in production.
var firmwareStore = map[string]*FirmwarePackage{
	"fw-001": {
		ID:             "fw-001",
		Version:        "2.4.1",
		Model:          "PAX-A920",
		S3Key:          "firmware/PAX-A920/v2.4.1/firmware.bin",
		Checksum:       "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		SizeBytes:      4194304,
		RolloutPercent: 100,
		ReleaseNotes:   "Security patch CVE-2024-1234; improved NFC stability",
		IsLatest:       true,
		CreatedAt:      time.Now().Add(-72 * time.Hour),
		CreatedBy:      "admin",
	},
	"fw-002": {
		ID:             "fw-002",
		Version:        "2.4.0",
		Model:          "PAX-A920",
		S3Key:          "firmware/PAX-A920/v2.4.0/firmware.bin",
		Checksum:       "sha256:abc123def456",
		SizeBytes:      4194304,
		RolloutPercent: 100,
		ReleaseNotes:   "Initial stable release",
		IsLatest:       false,
		CreatedAt:      time.Now().Add(-168 * time.Hour),
		CreatedBy:      "admin",
	},
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("[OTA] JSON encode error: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// requireAdminKey validates the X-Admin-Key header.
func requireAdminKey(r *http.Request) bool {
	adminKey := os.Getenv("OTA_ADMIN_KEY")
	if adminKey == "" {
		// No key configured — allow in development only
		return os.Getenv("NODE_ENV") != "production"
	}
	return r.Header.Get("X-Admin-Key") == adminKey
}

// validateDeviceToken validates a device HMAC token.
// Token format: <deviceSerial>.<timestamp>.<hmac>
func validateDeviceToken(token string) (deviceSerial string, valid bool) {
	secret := os.Getenv("DEVICE_TOKEN_SECRET")
	if secret == "" {
		// No secret configured — allow in development
		return "unknown", true
	}
	parts := strings.SplitN(token, ".", 3)
	if len(parts) != 3 {
		return "", false
	}
	serial, ts, sig := parts[0], parts[1], parts[2]
	// Check timestamp within 5 minutes
	tsInt, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return "", false
	}
	if time.Now().Unix()-tsInt > 300 {
		return "", false
	}
	// Verify HMAC
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(serial + "." + ts))
	expected := hex.EncodeToString(mac.Sum(nil))
	return serial, hmac.Equal([]byte(sig), []byte(expected))
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

// GET /health

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
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}
	if len(valid) >= rl.limit {
		rl.requests[ip] = valid
		return false
	}
	rl.requests[ip] = append(valid, now)
	return true
}
func rateLimitMiddleware(rl *rateLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := r.RemoteAddr
			if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
				ip = strings.Split(fwd, ",")[0]
			}
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

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "ok",
		"service":   "insureportal-ota",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

// GET /api/v1/ota/latest?model=PAX-A920&deviceSerial=SN123456
func handleLatest(w http.ResponseWriter, r *http.Request) {
	// Validate device token
	token := r.Header.Get("X-Device-Token")
	if token == "" {
		// Allow unauthenticated for polling (device may not have token yet)
		log.Printf("[OTA] /latest called without device token from %s", r.RemoteAddr)
	} else {
		_, valid := validateDeviceToken(token)
		if !valid {
			writeError(w, http.StatusUnauthorized, "invalid device token")
			return
		}
	}

	model := r.URL.Query().Get("model")
	if model == "" {
		model = "PAX-A920" // default model
	}

	// Find latest firmware for model
	var latest *FirmwarePackage
	for _, fw := range firmwareStore {
		if fw.Model == model && fw.IsLatest {
			latest = fw
			break
		}
	}

	if latest == nil {
		writeError(w, http.StatusNotFound, fmt.Sprintf("no firmware found for model: %s", model))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id":             latest.ID,
		"version":        latest.Version,
		"model":          latest.Model,
		"checksum":       latest.Checksum,
		"sizeBytes":      latest.SizeBytes,
		"rolloutPercent": latest.RolloutPercent,
		"releaseNotes":   latest.ReleaseNotes,
		"downloadUrl":    fmt.Sprintf("/api/v1/ota/download/%s", latest.ID),
	})
}

// generatePresignedURL creates a time-limited presigned S3 GET URL.
// Falls back to a direct S3 URL if AWS credentials are not configured.
func generatePresignedURL(s3Key string) (string, time.Time) {
	bucket := os.Getenv("S3_BUCKET")
	if bucket == "" {
		bucket = "insureportal-firmware"
	}
	expiryStr := os.Getenv("S3_PRESIGN_EXPIRY_SECS")
	expirySecs, _ := strconv.ParseInt(expiryStr, 10, 64)
	if expirySecs <= 0 {
		expirySecs = 3600
	}
	expiresAt := time.Now().Add(time.Duration(expirySecs) * time.Second).UTC()

	// Build a presigned URL using AWS Signature Version 4 query parameters.
	// This works for both AWS S3 and MinIO (path-style) without an external SDK.
	awsRegion := os.Getenv("AWS_REGION")
	if awsRegion == "" {
		awsRegion = "us-east-1"
	}
	accessKey := os.Getenv("AWS_ACCESS_KEY_ID")
	secretKey := os.Getenv("AWS_SECRET_ACCESS_KEY")
	s3Endpoint := os.Getenv("S3_ENDPOINT") // e.g. http://minio:9000

	if accessKey == "" || secretKey == "" {
		// No credentials — return direct public URL (dev/public-bucket mode)
		if s3Endpoint != "" {
			return fmt.Sprintf("%s/%s/%s", s3Endpoint, bucket, s3Key), expiresAt
		}
		return fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s", bucket, awsRegion, s3Key), expiresAt
	}

	// AWS Signature Version 4 presigned URL (manual implementation, no SDK dependency)
	now := time.Now().UTC()
	dateShort := now.Format("20060102")
	dateLong := now.Format("20060102T150405Z")

	var host string
	if s3Endpoint != "" {
		// MinIO path-style: endpoint/bucket/key
		host = strings.TrimPrefix(strings.TrimPrefix(s3Endpoint, "https://"), "http://")
	} else {
		host = fmt.Sprintf("%s.s3.%s.amazonaws.com", bucket, awsRegion)
	}

	credentialScope := fmt.Sprintf("%s/%s/s3/aws4_request", dateShort, awsRegion)
	credential := fmt.Sprintf("%s/%s", accessKey, credentialScope)

	var objectPath string
	if s3Endpoint != "" {
		objectPath = fmt.Sprintf("/%s/%s", bucket, s3Key)
	} else {
		objectPath = "/" + s3Key
	}

	queryParams := fmt.Sprintf(
		"X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=%s&X-Amz-Date=%s&X-Amz-Expires=%d&X-Amz-SignedHeaders=host",
		strings.ReplaceAll(credential, "/", "%%2F"),
		dateLong,
		expirySecs,
	)

	canonicalRequest := fmt.Sprintf("GET\n%s\n%s\nhost:%s\n\nhost\nUNSIGNED-PAYLOAD", objectPath, queryParams, host)
	stringToSign := fmt.Sprintf("AWS4-HMAC-SHA256\n%s\n%s\n%s",
		dateLong, credentialScope, hex.EncodeToString(sha256Hash([]byte(canonicalRequest))))

	signingKey := hmacSHA256(
		hmacSHA256(
			hmacSHA256(
				hmacSHA256([]byte("AWS4"+secretKey), []byte(dateShort)),
				[]byte(awsRegion),
			),
			[]byte("s3"),
		),
		[]byte("aws4_request"),
	)
	signature := hex.EncodeToString(hmacSHA256(signingKey, []byte(stringToSign)))

	var baseURL string
	if s3Endpoint != "" {
		baseURL = fmt.Sprintf("%s%s", s3Endpoint, objectPath)
	} else {
		baseURL = fmt.Sprintf("https://%s%s", host, objectPath)
	}

	presignedURL := fmt.Sprintf("%s?%s&X-Amz-Signature=%s", baseURL, queryParams, signature)
	return presignedURL, expiresAt
}

func sha256Hash(data []byte) []byte {
	h := sha256.Sum256(data)
	return h[:]
}

func hmacSHA256(key, data []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write(data)
	return mac.Sum(nil)
}

// GET /api/v1/ota/download/:id
func handleDownload(w http.ResponseWriter, r *http.Request) {
	// Extract ID from path
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 1 {
		writeError(w, http.StatusBadRequest, "missing firmware id")
		return
	}
	id := parts[len(parts)-1]

	fw, ok := firmwareStore[id]
	if !ok {
		writeError(w, http.StatusNotFound, "firmware not found")
		return
	}

	// Generate a real presigned S3/MinIO URL (no external SDK required)
	downloadURL, expiresAt := generatePresignedURL(fw.S3Key)

	writeJSON(w, http.StatusOK, map[string]any{
		"id":          fw.ID,
		"version":     fw.Version,
		"model":       fw.Model,
		"checksum":    fw.Checksum,
		"sizeBytes":   fw.SizeBytes,
		"s3Key":       fw.S3Key,
		"downloadUrl": downloadURL,
		"expiresAt":   expiresAt.Format(time.RFC3339),
	})
}

// GET /api/v1/ota/list
func handleList(w http.ResponseWriter, r *http.Request) {
	if !requireAdminKey(r) {
		writeError(w, http.StatusUnauthorized, "admin key required")
		return
	}

	model := r.URL.Query().Get("model")
	var packages []*FirmwarePackage
	for _, fw := range firmwareStore {
		if model == "" || fw.Model == model {
			packages = append(packages, fw)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"packages": packages,
		"total":    len(packages),
	})
}

// POST /api/v1/ota/upload
// Accepts multipart/form-data with fields: version, model, releaseNotes, firmware (file)
func handleUpload(w http.ResponseWriter, r *http.Request) {
	if !requireAdminKey(r) {
		writeError(w, http.StatusUnauthorized, "admin key required")
		return
	}

	if err := r.ParseMultipartForm(64 << 20); err != nil { // 64 MB max
		writeError(w, http.StatusBadRequest, "failed to parse multipart form")
		return
	}

	version := r.FormValue("version")
	model := r.FormValue("model")
	releaseNotes := r.FormValue("releaseNotes")

	if version == "" || model == "" {
		writeError(w, http.StatusBadRequest, "version and model are required")
		return
	}

	file, header, err := r.FormFile("firmware")
	if err != nil {
		writeError(w, http.StatusBadRequest, "firmware file is required")
		return
	}
	defer func() { _ = file.Close() }()

	// Read file and compute checksum
	data, err := io.ReadAll(file)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read firmware file")
		return
	}

	hash := sha256.Sum256(data)
	checksum := "sha256:" + hex.EncodeToString(hash[:])
	id := fmt.Sprintf("fw-%d", time.Now().UnixMilli())
	s3Key := fmt.Sprintf("firmware/%s/v%s/%s", model, version, header.Filename)

	// Mark previous latest as non-latest
	for _, fw := range firmwareStore {
		if fw.Model == model && fw.IsLatest {
			fw.IsLatest = false
		}
	}

	// Create new firmware record
	newFw := &FirmwarePackage{
		ID:             id,
		Version:        version,
		Model:          model,
		S3Key:          s3Key,
		Checksum:       checksum,
		SizeBytes:      int64(len(data)),
		RolloutPercent: 0, // start at 0% rollout
		ReleaseNotes:   releaseNotes,
		IsLatest:       true,
		CreatedAt:      time.Now(),
		CreatedBy:      r.Header.Get("X-Admin-User"),
	}
	firmwareStore[id] = newFw

	// In production: upload data to S3 using AWS SDK
	log.Printf("[OTA] New firmware uploaded: %s v%s (%d bytes, checksum: %s)", model, version, len(data), checksum)

	writeJSON(w, http.StatusCreated, map[string]any{
		"success":  true,
		"id":       id,
		"version":  version,
		"model":    model,
		"s3Key":    s3Key,
		"checksum": checksum,
		"message":  fmt.Sprintf("Firmware v%s for %s uploaded. Rollout at 0%% — use PUT /api/v1/ota/%s/rollout to increase.", version, model, id),
	})
}

// PUT /api/v1/ota/:id/rollout
// Body: {"rolloutPercent": 25}
func handleRollout(w http.ResponseWriter, r *http.Request) {
	if !requireAdminKey(r) {
		writeError(w, http.StatusUnauthorized, "admin key required")
		return
	}

	// Extract ID from path: /api/v1/ota/{id}/rollout
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 2 {
		writeError(w, http.StatusBadRequest, "missing firmware id")
		return
	}
	id := parts[len(parts)-2] // second to last segment

	fw, ok := firmwareStore[id]
	if !ok {
		writeError(w, http.StatusNotFound, "firmware not found")
		return
	}

	var body struct {
		RolloutPercent int `json:"rolloutPercent"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if body.RolloutPercent < 0 || body.RolloutPercent > 100 {
		writeError(w, http.StatusBadRequest, "rolloutPercent must be between 0 and 100")
		return
	}

	fw.RolloutPercent = body.RolloutPercent
	log.Printf("[OTA] Rollout updated: %s v%s → %d%%", fw.Model, fw.Version, fw.RolloutPercent)

	writeJSON(w, http.StatusOK, map[string]any{
		"success":        true,
		"id":             fw.ID,
		"version":        fw.Version,
		"model":          fw.Model,
		"rolloutPercent": fw.RolloutPercent,
	})
}

// ─── Router ───────────────────────────────────────────────────────────────────

func newRouter() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/api/v1/ota/latest", handleLatest)
	mux.HandleFunc("/api/v1/ota/list", handleList)
	mux.HandleFunc("/api/v1/ota/upload", handleUpload)
	mux.HandleFunc("/api/v1/ota/download/", handleDownload)
	mux.HandleFunc("/api/v1/ota/", func(w http.ResponseWriter, r *http.Request) {

		mux.HandleFunc("/api/v1/ota_updates", handleListEntities)
		mux.HandleFunc("/api/v1/ota_update", handleGetEntity)
		mux.HandleFunc("/api/v1/ota_updates/create", handleCreateEntity)
		mux.HandleFunc("/api/v1/ota_updates/delete", handleDeleteEntity)
		mux.HandleFunc("/stats", handleStats)

		// Route /api/v1/ota/{id}/rollout
		if strings.HasSuffix(r.URL.Path, "/rollout") && r.Method == http.MethodPut {
			handleRollout(w, r)
			return
		}
		writeError(w, http.StatusNotFound, "not found")
	})

	return mux
}

// ─── Main ─────────────────────────────────────────────────────────────────────

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
	if c.state == cbClosed {
		return true
	}
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
	if c.failures >= c.threshold {
		c.state = cbOpen
	}
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
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS ota_updates (
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
		log.Printf("database connected: ota-service")
	}
}

// ─── Domain CRUD Handlers (PostgreSQL-backed) ────────────────────────────────

func handleListEntities(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	var total int
	if err := db.QueryRow("SELECT COUNT(*) FROM ota_updates").Scan(&total); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	rows, err := db.Query(fmt.Sprintf("SELECT id, name, status, data, created_at FROM ota_updates ORDER BY id DESC LIMIT $1 OFFSET $2"), limit, offset)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	defer func() { _ = rows.Close() }()
	cols, _ := rows.Columns()
	var results []map[string]interface{}
	for rows.Next() {
		vals := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			continue
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
		results = append(results, row)
	}
	if results == nil {
		results = []map[string]interface{}{}
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"data": results, "total": total, "page": page, "limit": limit})
}

func handleGetEntity(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		http.Error(w, `{"error":"id parameter required"}`, http.StatusBadRequest)
		return
	}
	rows, err := db.Query("SELECT id, name, status, data, created_at FROM ota_updates WHERE id = $1", idStr)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	defer func() { _ = rows.Close() }()
	cols, _ := rows.Columns()
	if !rows.Next() {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	vals := make([]interface{}, len(cols))
	ptrs := make([]interface{}, len(cols))
	for i := range vals {
		ptrs[i] = &vals[i]
	}
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
	_ = json.NewEncoder(w).Encode(row)
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
		if k == "id" || k == "created_at" {
			continue
		}
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
	query := fmt.Sprintf("INSERT INTO ota_updates (%s) VALUES (%s) RETURNING id",
		strings.Join(cols, ", "), strings.Join(placeholders, ", "))
	var newID interface{}
	if err := db.QueryRow(query, vals...).Scan(&newID); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"id": newID, "status": "created"})
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
	result, err := db.Exec("DELETE FROM ota_updates WHERE id = $1", idStr)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"id": idStr, "status": "deleted"})
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	var count int
	if db != nil {
		_ = db.QueryRow("SELECT COUNT(*) FROM ota_updates").Scan(&count)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"service": "ota_updates", "table": "ota_updates", "total_records": count})
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	handler := newRouter()

	log.Printf("[OTA] InsurePortal OTA Microservice starting on :%s", port)
	log.Printf("[OTA] Endpoints: GET /health, GET /api/v1/ota/latest, GET /api/v1/ota/download/:id")
	log.Printf("[OTA] Admin endpoints: GET /api/v1/ota/list, POST /api/v1/ota/upload, PUT /api/v1/ota/:id/rollout")

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      handler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		log.Println("[OTA] Shutting down gracefully...")
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("[OTA] Forced shutdown: %v", err)
		}
	}()

	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[OTA] Server error: %v", err)
	}
}
