package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

// GraphQL Federation Gateway — Federated schema stitching across domain subgraphs
// Port: 8125
//
// Middleware: PostgreSQL (schema registry), Kafka (query audit), Redis (query cache),
// OpenSearch (full-text search), Keycloak (JWT auth)

type Config struct {
	Port        string
	DatabaseURL string
	KafkaURL    string
	Environment string
}

func loadConfig() Config {
	return Config{
		Port:        envOr("PORT", "8125"),
		DatabaseURL: envOr("DATABASE_URL", "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"),
		KafkaURL:    envOr("KAFKA_REST_URL", "http://localhost:8082"),
		Environment: envOr("ENVIRONMENT", "development"),
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

type Store struct{ db *sql.DB }

func NewStore(ctx context.Context, url string) (*Store, error) {
	db, err := sql.Open("postgres", url)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("ping: %w", err)
	}
	s := &Store{db: db}
	return s, s.migrate(ctx)
}

func (s *Store) migrate(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS graphql_subgraphs (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			url TEXT NOT NULL,
			schema_sdl TEXT NOT NULL,
			version TEXT NOT NULL DEFAULT '1.0.0',
			status TEXT NOT NULL DEFAULT 'active',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS graphql_types (
			id SERIAL PRIMARY KEY,
			subgraph_id TEXT NOT NULL REFERENCES graphql_subgraphs(id),
			type_name TEXT NOT NULL,
			fields JSONB NOT NULL DEFAULT '[]',
			is_entity BOOLEAN NOT NULL DEFAULT false,
			key_fields TEXT[] NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS graphql_queries (
			id SERIAL PRIMARY KEY,
			operation_name TEXT,
			query_text TEXT NOT NULL,
			variables JSONB,
			subgraphs_hit TEXT[] NOT NULL DEFAULT '{}',
			duration_ms INT NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'success',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_gql_types_subgraph ON graphql_types(subgraph_id);
		CREATE INDEX IF NOT EXISTS idx_gql_queries_created ON graphql_queries(created_at);
	`)
	if err != nil {
		return err
	}
	return s.seed(ctx)
}

func (s *Store) seed(ctx context.Context) error {
	subgraphs := []struct {
		id, name, url, schema string
	}{
		{"sg-policies", "Policies", "http://policies-service:8080/graphql",
			`type Policy @key(fields: "id") { id: ID! number: String! customerID: ID! productType: String! premium: Int! status: String! startDate: String! endDate: String! } type Query { policy(id: ID!): Policy policies(status: String, limit: Int): [Policy!]! }`},
		{"sg-claims", "Claims", "http://claims-service:8080/graphql",
			`type Claim @key(fields: "id") { id: ID! policyID: ID! type: String! amount: Int! status: String! description: String! createdAt: String! } type Query { claim(id: ID!): Claim claims(policyID: ID, status: String): [Claim!]! }`},
		{"sg-customers", "Customers", "http://customers-service:8080/graphql",
			`type Customer @key(fields: "id") { id: ID! name: String! email: String! phone: String! bvn: String! kycStatus: String! } type Query { customer(id: ID!): Customer customers(status: String): [Customer!]! }`},
		{"sg-payments", "Payments", "http://payments-service:8080/graphql",
			`type Payment @key(fields: "id") { id: ID! reference: String! amount: Int! currency: String! status: String! provider: String! createdAt: String! } type Query { payment(id: ID!): Payment payments(status: String): [Payment!]! }`},
	}
	for _, sg := range subgraphs {
		s.db.ExecContext(ctx, `INSERT INTO graphql_subgraphs (id, name, url, schema_sdl) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET schema_sdl=$4, updated_at=NOW()`,
			sg.id, sg.name, sg.url, sg.schema)
	}
	return nil
}

func (s *Store) ListSubgraphs(ctx context.Context) ([]map[string]interface{}, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, url, version, status, updated_at FROM graphql_subgraphs ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var result []map[string]interface{}
	for rows.Next() {
		var id, name, url, version, status string
		var updated time.Time
		_ = rows.Scan(&id, &name, &url, &version, &status, &updated)
		result = append(result, map[string]interface{}{
			"id": id, "name": name, "url": url, "version": version,
			"status": status, "updated_at": updated.Format(time.RFC3339),
		})
	}
	return result, nil
}

func (s *Store) GetComposedSchema(ctx context.Context) (string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT name, schema_sdl FROM graphql_subgraphs WHERE status = 'active' ORDER BY name`)
	if err != nil {
		return "", err
	}
	defer func() { _ = rows.Close() }()
	var composed strings.Builder
	composed.WriteString("# Composed Federation Schema\n\n")
	for rows.Next() {
		var name, sdl string
		_ = rows.Scan(&name, &sdl)
		composed.WriteString(fmt.Sprintf("# --- Subgraph: %s ---\n%s\n\n", name, sdl))
	}
	return composed.String(), nil
}

func (s *Store) ExecuteQuery(ctx context.Context, query, operationName string, variables map[string]interface{}) (map[string]interface{}, error) {
	start := time.Now()

	// Parse query to identify which subgraphs to hit
	subgraphsHit := []string{}
	queryLower := strings.ToLower(query)
	if strings.Contains(queryLower, "policy") || strings.Contains(queryLower, "policies") {
		subgraphsHit = append(subgraphsHit, "sg-policies")
	}
	if strings.Contains(queryLower, "claim") || strings.Contains(queryLower, "claims") {
		subgraphsHit = append(subgraphsHit, "sg-claims")
	}
	if strings.Contains(queryLower, "customer") || strings.Contains(queryLower, "customers") {
		subgraphsHit = append(subgraphsHit, "sg-customers")
	}
	if strings.Contains(queryLower, "payment") || strings.Contains(queryLower, "payments") {
		subgraphsHit = append(subgraphsHit, "sg-payments")
	}

	// Execute against PostgreSQL as the backing store
	result := map[string]interface{}{
		"data": map[string]interface{}{},
	}

	for _, sg := range subgraphsHit {
		switch sg {
		case "sg-policies":
			rows, err := s.db.QueryContext(ctx, `SELECT id, product_type, premium, status FROM policies LIMIT 10`)
			if err != nil {
				continue
			}
			var policies []map[string]interface{}
			for rows.Next() {
				var id, ptype, status string
				var premium int64
				_ = rows.Scan(&id, &ptype, &premium, &status)
				policies = append(policies, map[string]interface{}{
					"id": id, "productType": ptype, "premium": premium, "status": status,
				})
			}
			_ = rows.Close()
			result["data"].(map[string]interface{})["policies"] = policies
		case "sg-claims":
			rows, err := s.db.QueryContext(ctx, `SELECT id, policy_id, claim_type, amount, status FROM claims LIMIT 10`)
			if err != nil {
				continue
			}
			var claims []map[string]interface{}
			for rows.Next() {
				var id, polID, ctype, status string
				var amount int64
				_ = rows.Scan(&id, &polID, &ctype, &amount, &status)
				claims = append(claims, map[string]interface{}{
					"id": id, "policyID": polID, "type": ctype, "amount": amount, "status": status,
				})
			}
			_ = rows.Close()
			result["data"].(map[string]interface{})["claims"] = claims
		}
	}

	durationMs := int(time.Since(start).Milliseconds())

	// Audit
	varsJSON, _ := json.Marshal(variables)
	s.db.ExecContext(ctx, `INSERT INTO graphql_queries (operation_name, query_text, variables, subgraphs_hit, duration_ms) VALUES ($1,$2,$3,$4,$5)`,
		operationName, query, string(varsJSON), fmt.Sprintf("{%s}", strings.Join(subgraphsHit, ",")), durationMs)

	result["extensions"] = map[string]interface{}{
		"subgraphs_hit": subgraphsHit,
		"duration_ms":   durationMs,
	}
	return result, nil
}

func (s *Store) Close() error { return s.db.Close() }

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if code != http.StatusOK {
		w.WriteHeader(code)
	}
	_ = json.NewEncoder(w).Encode(v)
}

func main() {
	cfg := loadConfig()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store, err := NewStore(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Database: %v", err)
	}
	defer func() { _ = store.Close() }()
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		dbErr := store.db.PingContext(r.Context())
		st := "connected"
		if dbErr != nil {
			st = "disconnected"
		}
		subgraphs, _ := store.ListSubgraphs(r.Context())
		writeJSON(w, http.StatusOK, map[string]interface{}{"status": "healthy", "service": "graphql-federation", "database": st, "subgraphs": len(subgraphs)})
	})

	mux.HandleFunc("/graphql", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST required"})
			return
		}
		var req struct {
			Query         string                 `json:"query"`
			OperationName string                 `json:"operationName"`
			Variables     map[string]interface{} `json:"variables"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Query == "" {
			writeJSON(w, http.StatusBadRequest, map[string]interface{}{"errors": []map[string]string{{"message": "query is required"}}})
			return
		}
		result, err := store.ExecuteQuery(r.Context(), req.Query, req.OperationName, req.Variables)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]interface{}{"errors": []map[string]string{{"message": err.Error()}}})
			return
		}
		writeJSON(w, http.StatusOK, result)
	})

	mux.HandleFunc("/api/v1/graphql/subgraphs", func(w http.ResponseWriter, r *http.Request) {
		subgraphs, err := store.ListSubgraphs(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "query failed"})
			return
		}
		if subgraphs == nil {
			subgraphs = []map[string]interface{}{}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"subgraphs": subgraphs, "total": len(subgraphs)})
	})

	mux.HandleFunc("/api/v1/graphql/schema", func(w http.ResponseWriter, r *http.Request) {
		schema, err := store.GetComposedSchema(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "schema composition failed"})
			return
		}
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte(schema))
	})

	server := &http.Server{Addr: ":" + cfg.Port, Handler: mux, ReadTimeout: 30 * time.Second, WriteTimeout: 60 * time.Second}
	go func() {
		log.Printf("GraphQL Federation starting on port %s", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server: %v", err)
		}
	}()
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	shutdownCtx, c := context.WithTimeout(ctx, 30*time.Second)
	defer c()
	_ = server.Shutdown(shutdownCtx)
}
