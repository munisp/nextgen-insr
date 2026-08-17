package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds all runtime configuration
type Config struct {
	Server   ServerConfig
	Postgres PostgresConfig
	Redis    RedisConfig
	CORS     CORSConfig
	Logging  LoggingConfig
	Bank     BankConfig
}

type ServerConfig struct {
	Port          string
	Host          string
	ReadTimeout   time.Duration
	WriteTimeout  time.Duration
	ShutdownGrace time.Duration
}

type PostgresConfig struct {
	Host            string
	Port            string
	User            string
	Password        string
	DBName          string
	MaxIdleConns    int
	MaxOpenConns    int
	ConnMaxLifetime time.Duration
	SSLMode         string
}

type RedisConfig struct {
	Host         string
	Port         string
	Password     string
	DB           int
	MaxRetries   int
	PoolSize     int
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
}

type CORSConfig struct {
	AllowedOrigins   []string
	AllowedMethods   []string
	AllowedHeaders   []string
	AllowCredentials bool
	MaxAge           time.Duration
}

type LoggingConfig struct {
	Level  string
	Format string
}

// BankConfig holds bank integration specific settings
type BankConfig struct {
	MaxTransferAmount float64
	MinTransferAmount float64
	DefaultFeePercent float64
	SettlementPeriod  time.Duration
	NameEnquiryTTL    time.Duration
	VerificationTTL   time.Duration
	NIPMaxAmount      float64
	NIBSSMaxAmount    float64
	SupportedBanks    []string
	CallbackTimeout   time.Duration
	RetryAttempts     int
	RetryDelay        time.Duration
}

// NewConfig loads configuration from environment variables
func NewConfig() *Config {
	return &Config{
		Server: ServerConfig{
			Port:          envOr("PORT", "8108"),
			Host:          envOr("SERVER_HOST", "0.0.0.0"),
			ReadTimeout:   durationEnvOrDefault("SERVER_READ_TIMEOUT", 15*time.Second),
			WriteTimeout:  durationEnvOrDefault("SERVER_WRITE_TIMEOUT", 15*time.Second),
			ShutdownGrace: durationEnvOrDefault("SERVER_SHUTDOWN_GRACE", 30*time.Second),
		},
		Postgres: PostgresConfig{
			Host:            envOr("DB_HOST", "localhost"),
			Port:            envOr("DB_PORT", "5432"),
			User:            envOr("DB_USER", "postgres"),
			Password:        envOr("DB_PASSWORD", ""),
			DBName:          envOr("DB_NAME", "nigerian_bank_integrations"),
			MaxIdleConns:    intOr("DB_MAX_IDLE_CONNS", 10),
			MaxOpenConns:    intOr("DB_MAX_OPEN_CONNS", 50),
			ConnMaxLifetime: durationEnvOrDefault("DB_CONN_MAX_LIFETIME", 10*time.Minute),
			SSLMode:         envOr("DB_SSL_MODE", "disable"),
		},
		Redis: RedisConfig{
			Host:         envOr("REDIS_HOST", "localhost"),
			Port:         envOr("REDIS_PORT", "6379"),
			Password:     envOr("REDIS_PASSWORD", ""),
			DB:           intOr("REDIS_DB", 0),
			MaxRetries:   intOr("REDIS_MAX_RETRIES", 3),
			PoolSize:     intOr("REDIS_POOL_SIZE", 10),
			ReadTimeout:  durationEnvOrDefault("REDIS_READ_TIMEOUT", 3*time.Second),
			WriteTimeout: durationEnvOrDefault("REDIS_WRITE_TIMEOUT", 3*time.Second),
		},
		CORS: CORSConfig{
			AllowedOrigins:   parseCSV(envOr("CORS_ALLOWED_ORIGINS", "*")),
			AllowedMethods:   parseCSV(envOr("CORS_ALLOWED_METHODS", "GET,POST,PUT,DELETE,OPTIONS")),
			AllowedHeaders:   parseCSV(envOr("CORS_ALLOWED_HEADERS", "Origin,Content-Type,Accept,Authorization,X-Request-ID")),
			AllowCredentials: boolOr("CORS_ALLOW_CREDENTIALS", false),
			MaxAge:           durationEnvOrDefault("CORS_MAX_AGE", 12*time.Hour),
		},
		Logging: LoggingConfig{
			Level:  envOr("LOG_LEVEL", "info"),
			Format: envOr("LOG_FORMAT", "json"),
		},
		Bank: BankConfig{
			MaxTransferAmount: floatOr("MAX_TRANSFER_AMOUNT", 10000000),
			MinTransferAmount: floatOr("MIN_TRANSFER_AMOUNT", 1),
			DefaultFeePercent: floatOr("DEFAULT_FEE_PERCENT", 0.0),
			SettlementPeriod:  durationEnvOrDefault("SETTLEMENT_PERIOD", 24*time.Hour),
			NameEnquiryTTL:    durationEnvOrDefault("NAME_ENQUIRY_TTL", 15*time.Minute),
			VerificationTTL:   durationEnvOrDefault("VERIFICATION_TTL", 15*time.Minute),
			NIPMaxAmount:      floatOr("NIP_MAX_AMOUNT", 10000000),
			NIBSSMaxAmount:    floatOr("NIBSS_MAX_AMOUNT", 5000000),
			CallbackTimeout:   durationEnvOrDefault("CALLBACK_TIMEOUT", 30*time.Second),
			RetryAttempts:     intOr("RETRY_ATTEMPTS", 3),
			RetryDelay:        durationEnvOrDefault("RETRY_DELAY", 5*time.Second),
		},
	}
}

func (c *PostgresConfig) DSN() string {
	return fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		c.Host, c.Port, c.User, c.Password, c.DBName, c.SSLMode)
}

func (c *RedisConfig) RedisAddr() string {
	return fmt.Sprintf("%s:%s", c.Host, c.Port)
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func durationEnvOrDefault(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}

func intOr(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}

func floatOr(key string, fallback float64) float64 {
	if v := os.Getenv(key); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return fallback
}

func boolOr(key string, fallback bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return fallback
}

func parseCSV(s string) []string {
	if s == "" {
		return nil
	}
	result := make([]string, 0)
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == ',' {
			result = append(result, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		result = append(result, s[start:])
	}
	return result
}
