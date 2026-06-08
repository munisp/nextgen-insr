package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"github.com/unified-insurance/pfa-integration/internal/handlers"
	"github.com/unified-insurance/pfa-integration/internal/repository"
	"github.com/unified-insurance/pfa-integration/internal/service"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8092"
	}
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "pfa.db"
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "host=localhost user=ngapp password=ngapp dbname=ngapp port=5432 sslmode=disable"
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	repo := repository.NewPFARepository(db)
	if err := repo.AutoMigrate(); err != nil {
		log.Fatalf("Failed to run migrations: %v", err)
	}

	svc := service.NewPFAService(repo)
	handler := handlers.NewPFAHandler(svc)

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	addr := fmt.Sprintf(":%s", port)
	log.Printf("PFA integration starting on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
