package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"database/sql"
	"github.com/segmentio/kafka-go"

	_ "github.com/lib/pq"
)

type SecurityEvent struct {
	IncidentID   string                 `json:"incident_id"`
	Timestamp    time.Time              `json:"timestamp"`
	SourceIP     string                 `json:"source_ip"`
	Method       string                 `json:"method"`
	URI          string                 `json:"uri"`
	UserAgent    string                 `json:"user_agent"`
	ThreatType   string                 `json:"threat_type"`
	Severity     string                 `json:"severity"`
	Action       string                 `json:"action"`
	RiskScore    float64                `json:"risk_score"`
	PolicyName   string                 `json:"policy_name"`
	RuleMatched  string                 `json:"rule_matched"`
	RequestBody  string                 `json:"request_body,omitempty"`
	ResponseCode int                    `json:"response_code"`
	Metadata     map[string]interface{} `json:"metadata"`
}

type WAFValidationRequest struct {
	Method      string            `json:"method"`
	URI         string            `json:"uri"`
	Headers     map[string]string `json:"headers"`
	Args        map[string]string `json:"args"`
	Body        string            `json:"body"`
	Policy      string            `json:"policy"`
	Mode        string            `json:"mode"`
	CustomRules []string          `json:"customRules"`
}

type WAFValidationResponse struct {
	Action     string  `json:"action"`
	Reason     string  `json:"reason"`
	IncidentID string  `json:"incident_id"`
	RiskScore  float64 `json:"risk_score"`
	RetryAfter int     `json:"retry_after,omitempty"`
}

type OpenAppSecKafkaBridge struct {
	kafkaWriter *kafka.Writer
	kafkaReader *kafka.Reader
	httpServer  *http.Server
	wg          sync.WaitGroup
	ctx         context.Context
	cancel      context.CancelFunc
}

func NewOpenAppSecKafkaBridge() *OpenAppSecKafkaBridge {
	ctx, cancel := context.WithCancel(context.Background())

	kafkaBrokers := getEnv("KAFKA_BROKERS", "kafka-0.kafka-headless:9092,kafka-1.kafka-headless:9092,kafka-2.kafka-headless:9092")

	writer := &kafka.Writer{
		Addr:         kafka.TCP(kafkaBrokers),
		Topic:        "54link.security.waf_events",
		Balancer:     &kafka.Hash{},
		RequiredAcks: kafka.RequireAll,
		Compression:  kafka.Snappy,
		BatchSize:    100,
		BatchTimeout: 10 * time.Millisecond,
	}

	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:        []string{kafkaBrokers},
		Topic:          "54link.security.waf_commands",
		GroupID:        "openappsec-bridge",
		MinBytes:       1,
		MaxBytes:       10e6,
		CommitInterval: time.Second,
		StartOffset:    kafka.LastOffset,
	})

	return &OpenAppSecKafkaBridge{
		kafkaWriter: writer,
		kafkaReader: reader,
		ctx:         ctx,
		cancel:      cancel,
	}
}

func (b *OpenAppSecKafkaBridge) Start() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/validate", b.handleValidation)
	mux.HandleFunc("/health", b.handleHealth)
	mux.HandleFunc("/metrics", b.handleMetrics)

	b.httpServer = &http.Server{
		Addr:         ":8080",
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	b.wg.Add(2)
	go b.runHTTPServer()
	go b.consumeKafkaCommands()

	log.Println("OpenAppSec Kafka Bridge started on :8080")
	return nil
}

func (b *OpenAppSecKafkaBridge) runHTTPServer() {
	defer b.wg.Done()
	if err := b.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Printf("HTTP server error: %v", err)
	}
}

func (b *OpenAppSecKafkaBridge) handleValidation(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req WAFValidationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	response := b.validateRequest(req)

	if response.Action == "block" || response.Action == "challenge" {
		event := SecurityEvent{
			IncidentID:   response.IncidentID,
			Timestamp:    time.Now(),
			SourceIP:     req.Headers["X-Real-IP"],
			Method:       req.Method,
			URI:          req.URI,
			UserAgent:    req.Headers["User-Agent"],
			ThreatType:   response.Reason,
			Severity:     b.calculateSeverity(response.RiskScore),
			Action:       response.Action,
			RiskScore:    response.RiskScore,
			PolicyName:   req.Policy,
			RuleMatched:  response.Reason,
			RequestBody:  req.Body,
			ResponseCode: b.getResponseCode(response.Action),
			Metadata: map[string]interface{}{
				"custom_rules": req.CustomRules,
				"mode":         req.Mode,
			},
		}

		if err := b.publishSecurityEvent(event); err != nil {
			log.Printf("Failed to publish security event: %v", err)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
}

func (b *OpenAppSecKafkaBridge) validateRequest(req WAFValidationRequest) WAFValidationResponse {
	incidentID := fmt.Sprintf("INC-%d", time.Now().UnixNano())

	if b.detectSQLInjection(req.URI, req.Body) {
		return WAFValidationResponse{
			Action:     "block",
			Reason:     "SQL Injection detected",
			IncidentID: incidentID,
			RiskScore:  0.95,
		}
	}

	if b.detectXSS(req.URI, req.Body) {
		return WAFValidationResponse{
			Action:     "block",
			Reason:     "Cross-Site Scripting (XSS) detected",
			IncidentID: incidentID,
			RiskScore:  0.90,
		}
	}

	if b.detectPathTraversal(req.URI) {
		return WAFValidationResponse{
			Action:     "block",
			Reason:     "Path Traversal attempt detected",
			IncidentID: incidentID,
			RiskScore:  0.85,
		}
	}

	if b.checkRateLimit(req.Headers["X-Real-IP"], req.URI) {
		return WAFValidationResponse{
			Action:     "challenge",
			Reason:     "Rate limit exceeded",
			IncidentID: incidentID,
			RiskScore:  0.50,
			RetryAfter: 60,
		}
	}

	return WAFValidationResponse{
		Action:     "allow",
		Reason:     "Request passed all security checks",
		IncidentID: incidentID,
		RiskScore:  0.05,
	}
}

func (b *OpenAppSecKafkaBridge) detectSQLInjection(uri, body string) bool {
	sqlKeywords := []string{"union", "select", "insert", "update", "delete", "drop", "create", "alter", "exec", "execute"}
	content := uri + " " + body
	for _, keyword := range sqlKeywords {
		if contains(content, keyword) {
			return true
		}
	}
	return false
}

func (b *OpenAppSecKafkaBridge) detectXSS(uri, body string) bool {
	xssPatterns := []string{"<script", "javascript:", "onerror=", "onload=", "eval(", "expression("}
	content := uri + " " + body
	for _, pattern := range xssPatterns {
		if contains(content, pattern) {
			return true
		}
	}
	return false
}

func (b *OpenAppSecKafkaBridge) detectPathTraversal(uri string) bool {
	traversalPatterns := []string{"../", "..\\", "%2e%2e%2f", "%2e%2e\\"}
	for _, pattern := range traversalPatterns {
		if contains(uri, pattern) {
			return true
		}
	}
	return false
}

func (b *OpenAppSecKafkaBridge) checkRateLimit(ip, uri string) bool {
	return false
}

func (b *OpenAppSecKafkaBridge) publishSecurityEvent(event SecurityEvent) error {
	eventJSON, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal event: %w", err)
	}

	msg := kafka.Message{
		Key:   []byte(event.IncidentID),
		Value: eventJSON,
		Time:  time.Now(),
	}

	return b.kafkaWriter.WriteMessages(b.ctx, msg)
}

func (b *OpenAppSecKafkaBridge) consumeKafkaCommands() {
	defer b.wg.Done()

	for {
		select {
		case <-b.ctx.Done():
			return
		default:
			msg, err := b.kafkaReader.ReadMessage(b.ctx)
			if err != nil {
				if err == context.Canceled {
					return
				}
				log.Printf("Error reading Kafka message: %v", err)
				continue
			}

			b.processCommand(msg.Value)
		}
	}
}

func (b *OpenAppSecKafkaBridge) processCommand(data []byte) {
	var command map[string]interface{}
	if err := json.Unmarshal(data, &command); err != nil {
		log.Printf("Failed to unmarshal command: %v", err)
		return
	}

	cmdType, ok := command["type"].(string)
	if !ok {
		log.Println("Command missing type field")
		return
	}

	switch cmdType {
	case "update_policy":
		log.Printf("Updating policy: %v", command["policy"])
	case "block_ip":
		log.Printf("Blocking IP: %v", command["ip"])
	case "reload_rules":
		log.Println("Reloading WAF rules")
	default:
		log.Printf("Unknown command type: %s", cmdType)
	}
}

func (b *OpenAppSecKafkaBridge) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil)})
}

func (b *OpenAppSecKafkaBridge) handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	_, _ = fmt.Fprintf(w, "# HELP openappsec_requests_total Total number of requests processed\n")
	_, _ = fmt.Fprintf(w, "# TYPE openappsec_requests_total counter\n")
	_, _ = fmt.Fprintf(w, "openappsec_requests_total 0\n")
}

func (b *OpenAppSecKafkaBridge) Stop() error {
	log.Println("Shutting down OpenAppSec Kafka Bridge...")

	b.cancel()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := b.httpServer.Shutdown(ctx); err != nil {
		log.Printf("HTTP server shutdown error: %v", err)
	}

	if err := b.kafkaWriter.Close(); err != nil {
		log.Printf("Kafka writer close error: %v", err)
	}

	if err := b.kafkaReader.Close(); err != nil {
		log.Printf("Kafka reader close error: %v", err)
	}

	b.wg.Wait()
	log.Println("OpenAppSec Kafka Bridge stopped")
	return nil
}

func (b *OpenAppSecKafkaBridge) calculateSeverity(riskScore float64) string {
	if riskScore >= 0.8 {
		return "critical"
	} else if riskScore >= 0.6 {
		return "high"
	} else if riskScore >= 0.4 {
		return "medium"
	}
	return "low"
}

func (b *OpenAppSecKafkaBridge) getResponseCode(action string) int {
	switch action {
	case "block":
		return 403
	case "challenge":
		return 429
	default:
		return 200
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > len(substr) &&
		(s[:len(substr)] == substr || contains(s[1:], substr)))
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

var db *sql.DB

func initDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgresql://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Printf("WARN: database connection failed: %v (running in degraded mode)", err)
		return
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	if err = db.Ping(); err != nil {
		log.Printf("WARN: database ping failed: %v (running in degraded mode)", err)
		db = nil
		return
	}
	log.Printf("Connected to PostgreSQL for openappsec_apisix_integration")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS openappsec_apisix_integration (
		id SERIAL PRIMARY KEY,
		data JSONB NOT NULL DEFAULT '{}',
		status VARCHAR(50) DEFAULT 'active',
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW(),
		tenant_id INTEGER DEFAULT 1
	)`)
	if err != nil {
		log.Printf("WARN: table creation failed: %v", err)
	}
}

func main() {
	initDB()
	if db != nil {
		defer func() { _ = db.Close() }()
	}
	bridge := NewOpenAppSecKafkaBridge()

	if err := bridge.Start(); err != nil {
		log.Fatalf("Failed to start bridge: %v", err)
	}

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	if err := bridge.Stop(); err != nil {
		log.Fatalf("Failed to stop bridge: %v", err)
	}
}
