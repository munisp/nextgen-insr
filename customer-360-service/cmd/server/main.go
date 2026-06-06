package main

import (
	"context"
	"customer-360-service/internal/handlers"
	"customer-360-service/internal/models"
	"customer-360-service/internal/service"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gorilla/mux"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"database/sql"

	_ "github.com/lib/pq"
)

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
	log.Printf("Connected to PostgreSQL for customer_360_service")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS customer_360_service (
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
		defer db.Close()
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8130"
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "host=localhost user=ngapp password=ngapp dbname=ngapp port=5432 sslmode=disable"
	}

	var db *gorm.DB
	var err error
	db, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Printf("WARNING: Failed to connect to database: %v (running in degraded mode)", err)
	} else {
		db.AutoMigrate(&models.Customer{}, &models.CustomerInteraction{})
	}

	config := &service.Customer360Config{
		KafkaBrokers:     []string{envOrDefault("KAFKA_BROKERS", "localhost:9092")},
		RedisAddr:        envOrDefault("REDIS_ADDR", "localhost:6379"),
		RedisPassword:    os.Getenv("REDIS_PASSWORD"),
		DaprPort:         3500,
		KeycloakURL:      envOrDefault("KEYCLOAK_URL", "http://localhost:8080"),
		KeycloakRealm:    envOrDefault("KEYCLOAK_REALM", "insurance"),
		KeycloakClientID: envOrDefault("KEYCLOAK_CLIENT_ID", "customer-360"),
		KeycloakSecret:   os.Getenv("KEYCLOAK_CLIENT_SECRET"),
		SparkMaster:      envOrDefault("SPARK_MASTER", "local[*]"),
		DeltaTablePath:   envOrDefault("DELTA_TABLE_PATH", "/tmp/delta"),
	}

	svc, err := service.NewCustomer360Service(db, config)
	if err != nil {
		log.Printf("WARNING: Failed to create full service: %v (middleware unavailable)", err)
	}

	r := mux.NewRouter()

	r.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		status := "healthy"
		if db == nil {
			status = "degraded"
		}
		json.NewEncoder(w).Encode(map[string]string{
			"status":  status,
			"service": "customer-360-service",
		})
	}).Methods("GET")

	r.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
	}).Methods("GET")

	if svc != nil {
		handler := handlers.NewCustomer360Handler(svc)
		handler.RegisterRoutes(r)
	} else {
		api := r.PathPrefix("/api/v1/customer-360").Subrouter()
		api.PathPrefix("/").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error": map[string]interface{}{
					"code":    503,
					"message": "service running in degraded mode - middleware unavailable",
				},
			})
		})
	}

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	go func() {
		log.Printf("Customer 360 Service starting on port %s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if svc != nil {
		svc.Close()
	}
	srv.Shutdown(ctx)
}

func envOrDefault(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}
