package main

import (
	"fmt"
	"github.com/unified-insurance/group-life-admin/internal/handlers"
	"github.com/unified-insurance/group-life-admin/internal/repository"
	"github.com/unified-insurance/group-life-admin/internal/service"
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
	log.Printf("Connected to PostgreSQL for group_life_admin")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS group_life_admin (
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
		port = "8095"
	}
	db, err := gorm.Open(sqlite.Open("grouplife.db"), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	repo := repository.NewGroupLifeRepository(db)
	if err := repo.AutoMigrate(); err != nil {
		log.Fatalf("Failed to run migrations: %v", err)
	}
	svc := service.NewGroupLifeService(repo)
	handler := handlers.NewGroupLifeHandler(svc)
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)
	addr := fmt.Sprintf(":%s", port)
	log.Printf("Group Life Admin starting on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
