package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Server   ServerConfig
	Postgres PostgresConfig
	Redis    RedisConfig
	CORS     CORSConfig
	Logging  LoggingConfig
	Micro    MicroConfig
}

type ServerConfig struct {
	Port          string
	Host          string
	ReadTimeout   time.Duration
	WriteTimeout  time.Duration
	ShutdownGrace time.Duration
}

type PostgresConfig struct {
	URL                                string
	Host, Port, User, Password, DBName string
	MaxIdleConns, MaxOpenConns         int
	ConnMaxLifetime                    time.Duration
	SSLMode                            string
}

type RedisConfig struct {
	Host, Port, Password      string
	DB, MaxRetries, PoolSize  int
	ReadTimeout, WriteTimeout time.Duration
}

type CORSConfig struct {
	AllowedOrigins   []string
	AllowedMethods   []string
	AllowedHeaders   []string
	AllowCredentials bool
	MaxAge           time.Duration
}

type LoggingConfig struct{ Level, Format string }

type MicroConfig struct {
	DefaultPremium          float64
	MinPremium              float64
	MaxPremium              float64
	USDDPrefix              string
	USDDTimeout             time.Duration
	MNOProvider             string
	SettlementPeriod        time.Duration
	ParametricCheckInterval time.Duration
	AutoRenewGraceDays      int
	ClaimMaxDocuments       int
	ClaimSLAHours           int
	GroupMinMembers         int
	PayGoMinimumDays        int
}

func NewConfig() *Config {
	return &Config{
		Server: ServerConfig{
			Port: envOr("PORT", "8124"), Host: envOr("SERVER_HOST", "0.0.0.0"),
			ReadTimeout:   durationEnvOrDefault("SERVER_READ_TIMEOUT", 15*time.Second),
			WriteTimeout:  durationEnvOrDefault("SERVER_WRITE_TIMEOUT", 15*time.Second),
			ShutdownGrace: durationEnvOrDefault("SERVER_SHUTDOWN_GRACE", 30*time.Second),
		},
		Postgres: PostgresConfig{
			URL:  envOr("DATABASE_URL", ""),
			Host: envOr("DB_HOST", "localhost"), Port: envOr("DB_PORT", "5432"),
			User: envOr("DB_USER", "postgres"), Password: envOr("DB_PASSWORD", ""),
			DBName: envOr("DB_NAME", "microinsurance"), MaxIdleConns: intOr("DB_MAX_IDLE_CONNS", 10),
			MaxOpenConns:    intOr("DB_MAX_OPEN_CONNS", 50),
			ConnMaxLifetime: durationEnvOrDefault("DB_CONN_MAX_LIFETIME", 10*time.Minute),
			SSLMode:         envOr("DB_SSL_MODE", "disable"),
		},
		Redis: RedisConfig{
			Host: envOr("REDIS_HOST", "localhost"), Port: envOr("REDIS_PORT", "6379"),
			Password: envOr("REDIS_PASSWORD", ""), DB: intOr("REDIS_DB", 0),
			MaxRetries: intOr("REDIS_MAX_RETRIES", 3), PoolSize: intOr("REDIS_POOL_SIZE", 10),
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
		Logging: LoggingConfig{Level: envOr("LOG_LEVEL", "info"), Format: envOr("LOG_FORMAT", "json")},
		Micro: MicroConfig{
			DefaultPremium:          floatOr("DEFAULT_PREMIUM", 500),
			MinPremium:              floatOr("MIN_PREMIUM", 100),
			MaxPremium:              floatOr("MAX_PREMIUM", 5000),
			USDDPrefix:              envOr("USSD_PREFIX", "*200*"),
			USDDTimeout:             durationEnvOrDefault("USSD_TIMEOUT", 30*time.Second),
			MNOProvider:             envOr("MNO_PROVIDER", "mtn"),
			SettlementPeriod:        durationEnvOrDefault("SETTLEMENT_PERIOD", 24*time.Hour),
			ParametricCheckInterval: durationEnvOrDefault("PARAMETRIC_CHECK_INTERVAL", 1*time.Hour),
			AutoRenewGraceDays:      intOr("AUTO_RENEW_GRACE_DAYS", 7),
			ClaimMaxDocuments:       intOr("CLAIM_MAX_DOCUMENTS", 3),
			ClaimSLAHours:           intOr("CLAIM_SLA_HOURS", 48),
			GroupMinMembers:         intOr("GROUP_MIN_MEMBERS", 5),
			PayGoMinimumDays:        intOr("PAY_GO_MINIMUM_DAYS", 3),
		},
	}
}

func (c *PostgresConfig) DSN() string {
	if c.URL != "" {
		return c.URL
	}
	return fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		c.Host, c.Port, c.User, c.Password, c.DBName, c.SSLMode)
}
func (c *RedisConfig) RedisAddr() string { return fmt.Sprintf("%s:%s", c.Host, c.Port) }

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
	var r []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == ',' {
			r = append(r, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		r = append(r, s[start:])
	}
	return r
}
