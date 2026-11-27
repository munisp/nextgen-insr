package database

import (
	"fmt"
	"log"
	"os"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type Config struct {
	Host     string
	Port     string
	User     string
	Password string
	DBName   string
	SSLMode  string
}

func ConfigFromEnv(prefix string) Config {
	return Config{
		Host:     envOr(prefix+"_DB_HOST", "localhost"),
		Port:     envOr(prefix+"_DB_PORT", "5432"),
		User:     envOr(prefix+"_DB_USER", "insuretech"),
		Password: envOr(prefix+"_DB_PASSWORD", os.Getenv("POSTGRES_PASSWORD")),
		DBName:   envOr(prefix+"_DB_NAME", "insuretech"),
		SSLMode:  envOr(prefix+"_DB_SSLMODE", "disable"),
	}
}

func NewPostgresDB(cfg Config) (*gorm.DB, error) {
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		cfg.Host, cfg.Port, cfg.User, cfg.Password, cfg.DBName, cfg.SSLMode)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to postgres: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(25)
	sqlDB.SetMaxIdleConns(5)
	sqlDB.SetConnMaxLifetime(5 * time.Minute)

	log.Printf("[database] connected to %s:%s/%s", cfg.Host, cfg.Port, cfg.DBName)
	return db, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
