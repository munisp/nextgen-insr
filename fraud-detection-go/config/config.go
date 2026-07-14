package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// ServerConfig holds HTTP server settings.
type ServerConfig struct {
	Port         int           `json:"port"`
	ReadTimeout  time.Duration `json:"read_timeout"`
	WriteTimeout time.Duration `json:"write_timeout"`
	IdleTimeout  time.Duration `json:"idle_timeout"`
	Environment  string        `json:"environment"`
}

// DatabaseConfig holds PostgreSQL connection settings.
type DatabaseConfig struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	User     string `json:"user"`
	Password string `json:"password"`
	DBName   string `json:"dbname"`
	SSLMode  string `json:"sslmode"`

	MaxOpenConns int           `json:"max_open_conns"`
	MaxIdleConns int           `json:"max_idle_conns"`
	ConnMaxLife  time.Duration `json:"conn_max_life"`
}

// RedisConfig holds Redis connection settings.
type RedisConfig struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Password string `json:"password"`
	DB       int    `json:"db"`

	MaxRetries int           `json:"max_retries"`
	PoolSize   int           `json:"pool_size"`
	MinConns   int           `json:"min_conns"`
	DialTimeout time.Duration `json:"dial_timeout"`
	ReadTimeout time.Duration `json:"read_timeout"`
	WriteTimeout time.Duration `json:"write_timeout"`
}

// FraudConfig holds fraud detection business rule thresholds.
type FraudConfig struct {
	STRThreshold      float64       `json:"str_threshold"`
	BlockScore        float64       `json:"block_score"`
	ReviewScore       float64       `json:"review_score"`
	VelocityWindow    time.Duration `json:"velocity_window"`
	VelocityThreshold int           `json:"velocity_threshold"`
	BlockTTL          time.Duration `json:"block_ttl"`
}

// Config holds all configuration sections.
type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	Redis    RedisConfig
	Fraud    FraudConfig
}

// loadEnv retrieves an environment variable or returns the default value.
func loadEnv(key, defaultVal string) string {
	val, ok := os.LookupEnv(key)
	if !ok || val == "" {
		return defaultVal
	}
	return val
}

// loadEnvInt parses an integer from an env var or returns the default.
func loadEnvInt(key string, defaultVal int) int {
	str := loadEnv(key, strconv.Itoa(defaultVal))
	val, err := strconv.Atoi(str)
	if err != nil {
		return defaultVal
	}
	return val
}

// loadEnvDuration parses a duration string from an env var or returns the default.
func loadEnvDuration(key string, defaultVal time.Duration) time.Duration {
	str := loadEnv(key, defaultVal.String())
	val, err := time.ParseDuration(str)
	if err != nil {
		return defaultVal
	}
	return val
}

// Load reads all configuration from environment variables with sensible defaults.
func Load() Config {
	return Config{
		Server: ServerConfig{
			Port:         loadEnvInt("SERVER_PORT", 8109),
			ReadTimeout:  loadEnvDuration("SERVER_READ_TIMEOUT", 5*time.Second),
			WriteTimeout: loadEnvDuration("SERVER_WRITE_TIMEOUT", 10*time.Second),
			IdleTimeout:  loadEnvDuration("SERVER_IDLE_TIMEOUT", 60*time.Second),
			Environment:  loadEnv("SERVER_ENV", "development"),
		},
		Database: DatabaseConfig{
			Host:           loadEnv("DB_HOST", "localhost"),
			Port:           loadEnvInt("DB_PORT", 5432),
			User:           loadEnv("DB_USER", "postgres"),
			Password:       loadEnv("DB_PASSWORD", ""),
			DBName:         loadEnv("DB_NAME", "fraud_detection"),
			SSLMode:        loadEnv("DB_SSLMODE", "disable"),
			MaxOpenConns:   loadEnvInt("DB_MAX_OPEN_CONNS", 25),
			MaxIdleConns:   loadEnvInt("DB_MAX_IDLE_CONNS", 5),
			ConnMaxLife:    loadEnvDuration("DB_CONN_MAX_LIFE", 10*time.Minute),
		},
		Redis: RedisConfig{
			Host:          loadEnv("REDIS_HOST", "localhost"),
			Port:          loadEnvInt("REDIS_PORT", 6379),
			Password:      loadEnv("REDIS_PASSWORD", ""),
			DB:            loadEnvInt("REDIS_DB", 0),
			MaxRetries:    loadEnvInt("REDIS_MAX_RETRIES", 3),
			PoolSize:      loadEnvInt("REDIS_POOL_SIZE", 10),
			MinConns:      loadEnvInt("REDIS_MIN_CONNS", 0),
			DialTimeout:   loadEnvDuration("REDIS_DIAL_TIMEOUT", 5*time.Second),
			ReadTimeout:   loadEnvDuration("REDIS_READ_TIMEOUT", 3*time.Second),
			WriteTimeout:  loadEnvDuration("REDIS_WRITE_TIMEOUT", 3*time.Second),
		},
		Fraud: FraudConfig{
			STRThreshold:      float64(loadEnvInt("FRAUD_STR_THRESHOLD", 5000000)),
			BlockScore:        float64(loadEnvInt("FRAUD_BLOCK_SCORE", 80)),
			ReviewScore:       float64(loadEnvInt("FRAUD_REVIEW_SCORE", 60)),
			VelocityWindow:    loadEnvDuration("FRAUD_VELOCITY_WINDOW", 1*time.Hour),
			VelocityThreshold: loadEnvInt("FRAUD_VELOCITY_THRESHOLD", 20),
			BlockTTL:          loadEnvDuration("FRAUD_BLOCK_TTL", 24*time.Hour),
		},
	}
}

// Validate checks that required configuration values are present.
func (c Config) Validate() error {
	if c.Database.Password == "" {
		return fmt.Errorf("DB_PASSWORD is required")
	}
	if c.Database.Host == "" {
		return fmt.Errorf("DB_HOST is required")
	}
	if c.Fraud.STRThreshold <= 0 {
		return fmt.Errorf("FRAUD_STR_THRESHOLD must be positive")
	}
	if c.Fraud.BlockScore <= c.Fraud.ReviewScore {
		return fmt.Errorf("FRAUD_BLOCK_SCORE (%.0f) must be greater than FRAUD_REVIEW_SCORE (%.0f)",
			c.Fraud.BlockScore, c.Fraud.ReviewScore)
	}
	return nil
}

// ConnectionString builds the PostgreSQL DSN from individual fields.
func (c DatabaseConfig) ConnectionString() string {
	return fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		c.Host, c.Port, c.User, c.Password, c.DBName, c.SSLMode,
	)
}

// Address returns the Redis host:port address.
func (c RedisConfig) Address() string {
	return fmt.Sprintf("%s:%d", c.Host, c.Port)
}

// DSN builds the Redis connection string (for libraries that need it).
func (c RedisConfig) DSN() string {
	parts := []string{
		fmt.Sprintf("redis://%s:%d/%d", c.Host, c.Port, c.DB),
	}
	if c.Password != "" {
		parts = append(parts, fmt.Sprintf("password=%s", c.Password))
	}
	return strings.Join(parts, "?")
}
