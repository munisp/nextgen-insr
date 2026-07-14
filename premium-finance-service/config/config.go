package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds all runtime configuration loaded from environment variables
type Config struct {
	Server ServerConfig
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
	Host           string
	Port           string
	Password       string
	DB             int
	MaxRetries     int
	PoolSize       int
	ReadTimeout    time.Duration
	WriteTimeout   time.Duration
}

// CORSConfig holds CORS settings
type CORSConfig struct {
	AllowedOrigins []string
	AllowedMethods []string
	AllowedHeaders []string
	AllowCredentials bool
	MaxAge         time.Duration
}

// LoggingConfig holds logging settings
type LoggingConfig struct {
	Level  string
	Format string
}

// FinanceConfig holds premium finance-specific settings
type FinanceConfig struct {
	MinPremiumAmount       float64
	DefaultInterestRate    float64
	LoyalCustomerRate      float64
	LoyalCustomerThreshold int
	MaxInstallmentMonths   int
	Frequencies            []string
	LateFeePercent         float64
	LateFeeGraceDays       int
	SuspensionThreshold    int
	TerminationThreshold   int
	EarlySettlementRebate  float64
	CreditScoreThresholds  map[string]int
	MaxLoanAmount          float64
	MinCreditScore         int
}

// NewConfig loads configuration from environment variables with sensible defaults
func NewConfig() *Config {
	creditThresholds := map[string]int{
		"excellent": 750, "good": 650, "fair": 550, "poor": 450, "very_poor": 0,
	}

	return &Config{
		Server: ServerConfig{
			Port:          envOr("PORT", "8130"),
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
			DBName:          envOr("DB_NAME", "premium_finance"),
			MaxIdleConns:    intOr("DB_MAX_IDLE_CONNS", 10),
			MaxOpenConns:    intOr("DB_MAX_OPEN_CONNS", 50),
			ConnMaxLifetime: durationEnvOrDefault("DB_CONN_MAX_LIFETIME", 10*time.Minute),
			SSLMode:         envOr("DB_SSL_MODE", "disable"),
		},
		Redis: RedisConfig{
			Host:           envOr("REDIS_HOST", "localhost"),
			Port:           envOr("REDIS_PORT", "6379"),
			Password:       envOr("REDIS_PASSWORD", ""),
			DB:             intOr("REDIS_DB", 0),
			MaxRetries:     intOr("REDIS_MAX_RETRIES", 3),
			PoolSize:       intOr("REDIS_POOL_SIZE", 10),
			ReadTimeout:    durationEnvOrDefault("REDIS_READ_TIMEOUT", 3*time.Second),
			WriteTimeout:   durationEnvOrDefault("REDIS_WRITE_TIMEOUT", 3*time.Second),
		},
		CORS: CORSConfig{
			AllowedOrigins: parseCSV(envOr("CORS_ALLOWED_ORIGINS", "*")),
			AllowedMethods: parseCSV(envOr("CORS_ALLOWED_METHODS", "GET,POST,PUT,DELETE,OPTIONS")),
			AllowedHeaders: parseCSV(envOr("CORS_ALLOWED_HEADERS", "Origin,Content-Type,Accept,Authorization,X-Request-ID")),
			AllowCredentials: boolOr("CORS_ALLOW_CREDENTIALS", false),
			MaxAge:           durationEnvOrDefault("CORS_MAX_AGE", 12*time.Hour),
		},
		Logging: LoggingConfig{
			Level:  envOr("LOG_LEVEL", "info"),
			Format: envOr("LOG_FORMAT", "json"),
		},
		Finance: FinanceConfig{
			MinPremiumAmount:       floatOr("MIN_PREMIUM_AMOUNT", 100000),
			DefaultInterestRate:    floatOr("DEFAULT_INTEREST_RATE", 0.025),
			LoyalCustomerRate:      floatOr("LOYAL_CUSTOMER_RATE", 0.020),
			LoyalCustomerThreshold: intOr("LOYAL_CUSTOMER_YEARS", 3),
			MaxInstallmentMonths:   intOr("MAX_INSTALLMENT_MONTHS", 12),
			LateFeePercent:         floatOr("LATE_FEE_PERCENT", 0.05),
			LateFeeGraceDays:       intOr("LATE_FEE_GRACE_DAYS", 7),
			SuspensionThreshold:    intOr("SUSPENSION_THRESHOLD", 2),
			TerminationThreshold:   intOr("TERMINATION_THRESHOLD", 3),
			EarlySettlementRebate:  floatOr("EARLY_SETTLEMENT_REBATE", 0.50),
			CreditScoreThresholds:  creditThresholds,
			MaxLoanAmount:          floatOr("MAX_LOAN_AMOUNT", 5000000),
			MinCreditScore:         intOr("MIN_CREDIT_SCORE", 350),
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
	for i := 0; i < len(s); i++ {
		if s[i] == ',' {
			result = append(result, s[:i])
			s = s[i+1:]
			i = -1
		}
	}
	if len(s) > 0 {
		result = append(result, s)
	}
	return result
}
