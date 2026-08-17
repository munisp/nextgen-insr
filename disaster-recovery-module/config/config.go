package config

import (
	"fmt"
	"os"
	"strconv"
	"time"

	"go.uber.org/zap"
)

// Config holds all configuration for the disaster recovery service
type Config struct {
	// Server
	Port            int           `mapstructure:"PORT"`
	Env             string        `mapstructure:"ENV"`
	ReadTimeout     time.Duration `mapstructure:"READ_TIMEOUT"`
	WriteTimeout    time.Duration `mapstructure:"WRITE_TIMEOUT"`
	ShutdownTimeout time.Duration `mapstructure:"SHUTDOWN_TIMEOUT"`
	HealthCheckPath string        `mapstructure:"HEALTH_CHECK_PATH"`

	// PostgreSQL
	DBHost     string `mapstructure:"DB_HOST"`
	DBPort     int    `mapstructure:"DB_PORT"`
	DBUser     string `mapstructure:"DB_USER"`
	DBPass     string `mapstructure:"DB_PASS"`
	DBName     string `mapstructure:"DB_NAME"`
	DBSSLMode  string `mapstructure:"DB_SSL_MODE"`
	DBMaxConns int    `mapstructure:"DB_MAX_CONNS"`
	DBMinConns int    `mapstructure:"DB_MIN_CONNS"`

	// Redis
	RedisAddr       string `mapstructure:"REDIS_ADDR"`
	RedisPass       string `mapstructure:"REDIS_PASS"`
	RedisDB         int    `mapstructure:"REDIS_DB"`
	RedisMaxRetries int    `mapstructure:"REDIS_MAX_RETRIES"`

	// DR Specific
	RTOTarget             time.Duration `mapstructure:"RTO_TARGET"`
	RPOTarget             time.Duration `mapstructure:"RPO_TARGET"`
	PrimaryDC             string        `mapstructure:"PRIMARY_DC"`
	SecondaryDC           string        `mapstructure:"SECONDARY_DC"`
	FailoverAutoThreshold int           `mapstructure:"FAILOVER_AUTO_THRESHOLD"`
	DRDrillIntervalMonths int           `mapstructure:"DR_DRILL_INTERVAL_MONTHS"`
	NAICOMNotifyThreshold time.Duration `mapstructure:"NAICOM_NOTIFY_THRESHOLD"`
	BackupInterval        time.Duration `mapstructure:"BACKUP_INTERVAL"`

	// Logging
	LogLevel  string `mapstructure:"LOG_LEVEL"`
	LogFormat string `mapstructure:"LOG_FORMAT"`

	// Temporal (if used)
	TemporalHostPort string `mapstructure:"TEMPORAL_HOST_PORT"`
}

// Load reads configuration from environment variables with defaults
func Load() (*Config, error) {
	c := &Config{
		Port:            getEnvInt("PORT", 8090),
		Env:             getEnv("ENV", "production"),
		ReadTimeout:     getEnvDuration("READ_TIMEOUT", 15*time.Second),
		WriteTimeout:    getEnvDuration("WRITE_TIMEOUT", 15*time.Second),
		ShutdownTimeout: getEnvDuration("SHUTDOWN_TIMEOUT", 30*time.Second),
		HealthCheckPath: getEnv("HEALTH_CHECK_PATH", "/health"),

		DBHost:     getEnv("DB_HOST", "localhost"),
		DBPort:     getEnvInt("DB_PORT", 5432),
		DBUser:     getEnv("DB_USER", "dr_service"),
		DBPass:     getEnv("DB_PASS", ""),
		DBName:     getEnv("DB_NAME", "disaster_recovery"),
		DBSSLMode:  getEnv("DB_SSL_MODE", "prefer"),
		DBMaxConns: getEnvInt("DB_MAX_CONNS", 20),
		DBMinConns: getEnvInt("DB_MIN_CONNS", 5),

		RedisAddr:       getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPass:       getEnv("REDIS_PASS", ""),
		RedisDB:         getEnvInt("REDIS_DB", 0),
		RedisMaxRetries: getEnvInt("REDIS_MAX_RETRIES", 3),

		RTOTarget:             getEnvDuration("RTO_TARGET", 4*time.Hour),
		RPOTarget:             getEnvDuration("RPO_TARGET", 1*time.Hour),
		PrimaryDC:             getEnv("PRIMARY_DC", "Lagos-1"),
		SecondaryDC:           getEnv("SECONDARY_DC", "Abuja-1"),
		FailoverAutoThreshold: getEnvInt("FAILOVER_AUTO_THRESHOLD", 30),
		DRDrillIntervalMonths: getEnvInt("DR_DRILL_INTERVAL_MONTHS", 3),
		NAICOMNotifyThreshold: getEnvDuration("NAICOM_NOTIFY_THRESHOLD", 2*time.Hour),
		BackupInterval:        getEnvDuration("BACKUP_INTERVAL", 1*time.Hour),

		LogLevel:  getEnv("LOG_LEVEL", "info"),
		LogFormat: getEnv("LOG_FORMAT", "json"),

		TemporalHostPort: getEnv("TEMPORAL_HOST_PORT", "localhost:7233"),
	}

	if c.DBPass == "" {
		zap.L().Warn("DB_PASS not set, service may fail to connect")
	}

	return c, nil
}

func (c *Config) DSN() string {
	return fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		c.DBHost, c.DBPort, c.DBUser, c.DBPass, c.DBName, c.DBSSLMode,
	)
}

func getEnv(key, defaultVal string) string {
	if val, ok := os.LookupEnv(key); ok {
		return val
	}
	return defaultVal
}

func getEnvInt(key string, defaultVal int) int {
	if val, ok := os.LookupEnv(key); ok {
		if v, err := strconv.Atoi(val); err == nil {
			return v
		}
	}
	return defaultVal
}

func getEnvDuration(key string, defaultVal time.Duration) time.Duration {
	if val, ok := os.LookupEnv(key); ok {
		if d, err := time.ParseDuration(val); err == nil {
			return d
		}
	}
	return defaultVal
}
