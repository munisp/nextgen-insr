package main

import (
	"github.com/unified-insurance/bancassurance-integration/internal/handlers"
	"github.com/unified-insurance/bancassurance-integration/internal/repository"
	"github.com/unified-insurance/bancassurance-integration/internal/service"
	"fmt"
	"log"
	"net/http"
	"os"

	"gorm.io/driver/sqlite"
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
	log.Printf("Connected to PostgreSQL for bancassurance_integration")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS bancassurance_integration (
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
		port = "8091"
	}
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "bancassurance.db"
	}

	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	repo := repository.NewBancassuranceRepository(db)
	if err := repo.AutoMigrate(); err != nil {
		log.Fatalf("Failed to run migrations: %v", err)
	}

	svc := service.NewBancassuranceService(repo)
	handler := handlers.NewBancassuranceHandler(svc)

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	addr := fmt.Sprintf(":%s", port)
	log.Printf("Bancassurance integration starting on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
