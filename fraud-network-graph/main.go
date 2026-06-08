package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"time"

	_ "github.com/lib/pq"
)

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

// Fraud Network Graph Service
// Detects fraud rings by analyzing relationships between agents, customers,
// devices, locations, and transactions using graph-based analytics.

var db *sql.DB

type GraphNode struct {
	ID    string `json:"id"`
	Type  string `json:"type"` // agent, customer, device, location, policy
	Label string `json:"label"`
}

type GraphEdge struct {
	Source string  `json:"source"`
	Target string  `json:"target"`
	Type   string  `json:"type"` // sold_by, claimed_by, used_device, same_location
	Weight float64 `json:"weight"`
}

type FraudRing struct {
	ID         string      `json:"id"`
	Nodes      []GraphNode `json:"nodes"`
	Edges      []GraphEdge `json:"edges"`
	RiskScore  float64     `json:"risk_score"`
	Pattern    string      `json:"pattern"`
	DetectedAt string      `json:"detected_at"`
}

type AnalysisRequest struct {
	EntityID   string `json:"entity_id"`
	EntityType string `json:"entity_type"`
	Depth      int    `json:"depth"`
}

func analyzeNetwork(entityID, entityType string, depth int) FraudRing {
	nodes := []GraphNode{
		{ID: entityID, Type: entityType, Label: fmt.Sprintf("%s-%s", entityType, entityID[:8])},
	}
	edges := []GraphEdge{}
	riskScore := 0.0

	// Simulate connected nodes (in production, query graph DB)
	connectedAgents := 3
	connectedDevices := 2
	sharedLocations := 1

	for i := 0; i < connectedAgents; i++ {
		nodeID := fmt.Sprintf("agent-%d", i)
		nodes = append(nodes, GraphNode{ID: nodeID, Type: "agent", Label: fmt.Sprintf("Agent %d", i)})
		edges = append(edges, GraphEdge{Source: entityID, Target: nodeID, Type: "sold_by", Weight: 0.8})
	}
	for i := 0; i < connectedDevices; i++ {
		nodeID := fmt.Sprintf("device-%d", i)
		nodes = append(nodes, GraphNode{ID: nodeID, Type: "device", Label: fmt.Sprintf("Device %d", i)})
		edges = append(edges, GraphEdge{Source: entityID, Target: nodeID, Type: "used_device", Weight: 0.6})
	}
	for i := 0; i < sharedLocations; i++ {
		nodeID := fmt.Sprintf("location-%d", i)
		nodes = append(nodes, GraphNode{ID: nodeID, Type: "location", Label: fmt.Sprintf("Location %d", i)})
		edges = append(edges, GraphEdge{Source: entityID, Target: nodeID, Type: "same_location", Weight: 0.4})
	}

	density := float64(len(edges)) / math.Max(float64(len(nodes)*(len(nodes)-1)/2), 1)
	riskScore = density * 100
	if len(nodes) > 5 { riskScore += 20 }

	pattern := "low_risk"
	if riskScore > 60 { pattern = "potential_ring" }
	if riskScore > 80 { pattern = "confirmed_ring" }

	return FraudRing{
		ID: fmt.Sprintf("ring-%s", entityID[:8]), Nodes: nodes, Edges: edges,
		RiskScore: riskScore, Pattern: pattern, DetectedAt: time.Now().Format(time.RFC3339),
	}
}

func initDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" { dsn = "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable" }
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil { log.Printf(`{"level":"warn","msg":"db failed","error":"%s"}`, err); return }
	db.SetMaxOpenConns(25); db.SetMaxIdleConns(5); db.SetConnMaxLifetime(5 * time.Minute)
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS fraud_rings (
		id TEXT PRIMARY KEY, node_count INT, edge_count INT, risk_score REAL,
		pattern TEXT, detected_at TIMESTAMPTZ DEFAULT NOW()
	)`); err != nil {
		log.Printf(`{"level":"warn","msg":"create table failed","error":"%s"}`, err)
	}
	log.Printf(`{"level":"info","msg":"database connected","service":"fraud-network-graph"}`)
}

func handleAnalyze(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed); return
	}
	var req AnalysisRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err), http.StatusBadRequest); return
	}
	if req.Depth == 0 { req.Depth = 2 }
	ring := analyzeNetwork(req.EntityID, req.EntityType, req.Depth)
	if db != nil {
		if _, err := db.Exec(`INSERT INTO fraud_rings (id, node_count, edge_count, risk_score, pattern)
			VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET risk_score=$4, pattern=$5`,
			ring.ID, len(ring.Nodes), len(ring.Edges), ring.RiskScore, ring.Pattern); err != nil {
			log.Printf(`{"level":"warn","msg":"insert fraud ring failed","error":"%s"}`, err)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ring)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	dbStatus := "disconnected"
	if db != nil { if err := db.Ping(); err == nil { dbStatus = "connected" } }
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "fraud-network-graph", "database": dbStatus})
}
func handleReady(w http.ResponseWriter, r *http.Request) {
	if db == nil { w.WriteHeader(503); json.NewEncoder(w).Encode(map[string]string{"status": "not_ready"}); return }
	json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
}
func handleLive(w http.ResponseWriter, r *http.Request) { json.NewEncoder(w).Encode(map[string]string{"status": "alive"}) }

func main() {
	initDB()
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/ready", handleReady)
	mux.HandleFunc("/live", handleLive)
	mux.HandleFunc("/api/v1/analyze", handleAnalyze)
	port := ":8123"
	log.Printf(`{"level":"info","msg":"Fraud Network Graph starting","port":"%s"}`, port)
	log.Fatal(http.ListenAndServe(port, mux))
}
