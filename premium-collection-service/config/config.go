package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds all runtime configuration loaded from environment variables
type Config struct {
	Server   ServerConfig
	Postgres PostgresConfig
	Redis    RedisConfig
	CORS     CORSConfig
	Logging  LoggingConfig
	Finance  FinanceConfig
}

// ServerConfig holds HTTP server settings
type ServerConfig struct {
	Port          string
	Host          string
	ReadTimeout   time.Duration
	WriteTimeout  time.Duration
	ShutdownGrace time.Duration
}

// PostgresConfig holds PostgreSQL connection settings
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

// RedisConfig holds Redis connection settings
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

// CORSConfig holds CORS settings
type CORSConfig struct {
	AllowedOrigins   []string
	AllowedMethods   []string
	AllowedHeaders   []string
	AllowCredentials bool
	MaxAge           time.Duration
}

// LoggingConfig holds logging settings
type LoggingConfig struct {
	Level  string
	Format string
}

// FinanceConfig holds premium finance-specific settings
type FinanceConfig struct {
	DefaultFeeRateBankTransfer float64
	DefaultFeeRateCard         float64
	DefaultFeeRateMobileMoney  float64
	DefaultFeeRateAgentCash    float64
	DefaultFeeRateUSSD         float64
	SettlementPeriod           time.Duration
	DunningMaxAttempts         int
	DunningIntervalDays        int
	AutoDebitCheckInterval     time.Duration
	MinPaymentAmount           float64
	ReceiptValidityHours       int
	InstallmentMaxMonths       int
}

// NewConfig loads configuration from environment variables with sensible defaults
func NewConfig() *Config {
	return &Config{
		Server: ServerConfig{
			Port:          envOr("PORT", "8098"),
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
			DBName:          envOr("DB_NAME", "premium_collection"),
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
		Finance: FinanceConfig{
			DefaultFeeRateBankTransfer: floatOr("FEE_BANK_TRANSFER", 0.0),
			DefaultFeeRateCard:         floatOr("FEE_CARD", 0.015),
			DefaultFeeRateMobileMoney:  floatOr("FEE_MOBILE_MONEY", 0.01),
			DefaultFeeRateAgentCash:    floatOr("FEE_AGENT_CASH", 0.0),
			DefaultFeeRateUSSD:         floatOr("FEE_USSD", 0.005),
			SettlementPeriod:           durationEnvOrDefault("SETTLEMENT_PERIOD", 24*time.Hour),
			DunningMaxAttempts:         intOr("DUNNING_MAX_ATTEMPTS", 3),
			DunningIntervalDays:        intOr("DUNNING_INTERVAL_DAYS", 3),
			AutoDebitCheckInterval:     durationEnvOrDefault("AUTO_DEBIT_CHECK_INTERVAL", 1*time.Hour),
			MinPaymentAmount:           floatOr("MIN_PAYMENT_AMOUNT", 100.0),
			ReceiptValidityHours:       intOr("RECEIPT_VALIDITY_HOURS", 72),
			InstallmentMaxMonths:       intOr("INSTALLMENT_MAX_MONTHS", 12),
		},
	}
}

// DSN builds the PostgreSQL connection string
func (c *PostgresConfig) DSN() string {
	return fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		c.Host, c.Port, c.User, c.Password, c.DBName, c.SSLMode,
	)
}

// RedisAddr builds the Redis address string
func (c *RedisConfig) RedisAddr() string {
	return fmt.Sprintf("%s:%s", c.Host, c.Port)
}

// FeeRate returns the fee rate for the given payment method
func (c *FinanceConfig) FeeRate(method string) float64 {
	switch method {
	case "bank_transfer":
		return c.DefaultFeeRateBankTransfer
	case "card":
		return c.DefaultFeeRateCard
	case "mobile_money":
		return c.DefaultFeeRateMobileMoney
	case "agent_cash":
		return c.DefaultFeeRateAgentCash
	case "ussd":
		return c.DefaultFeeRateUSSD
	default:
		return c.DefaultFeeRateCard
	}
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
	for _, v := range splitCSV(s) {
		result = append(result, v)
	}
	return result
}

func splitCSV(s string) []string {
	var result []string
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
