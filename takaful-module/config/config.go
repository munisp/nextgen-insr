package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds all configuration for the Takaful service
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

	// Takaful specific
	WakalaFeePercent     float64 `mapstructure:"WAKALA_FEE_PERCENT"`
	ParticipantShare     float64 `mapstructure:"PARTICIPANT_SHARE"`
	MinContribution      float64 `mapstructure:"MIN_CONTRIBUTION"`
	ShariahBoardApproval bool    `mapstructure:"SHARIAH_BOARD_APPROVAL"`
	MaxTabarruPercent    float64 `mapstructure:"MAX_TABARRU_PERCENT"`

	// Zakat
	ZakatRate           float64 `mapstructure:"ZAKAT_RATE"`
	ZakatNisabThreshold float64 `mapstructure:"ZAKAT_NISAB_THRESHOLD"`
	ZakatYearStart      string  `mapstructure:"ZAKAT_YEAR_START"`

	// Logging
	LogLevel  string `mapstructure:"LOG_LEVEL"`
	LogFormat string `mapstructure:"LOG_FORMAT"`
}

// Load reads configuration from environment variables with defaults
func Load() (*Config, error) {
	c := &Config{
		Port:            getEnvInt("PORT", 8128),
		Env:             getEnv("ENV", "production"),
		ReadTimeout:     getEnvDuration("READ_TIMEOUT", 15*time.Second),
		WriteTimeout:    getEnvDuration("WRITE_TIMEOUT", 15*time.Second),
		ShutdownTimeout: getEnvDuration("SHUTDOWN_TIMEOUT", 30*time.Second),
		HealthCheckPath: getEnv("HEALTH_CHECK_PATH", "/health"),

		DBHost:     getEnv("DB_HOST", "localhost"),
		DBPort:     getEnvInt("DB_PORT", 5432),
		DBUser:     getEnv("DB_USER", "takaful_service"),
		DBPass:     getEnv("DB_PASS", ""),
		DBName:     getEnv("DB_NAME", "takaful"),
		DBSSLMode:  getEnv("DB_SSL_MODE", "prefer"),
		DBMaxConns: getEnvInt("DB_MAX_CONNS", 20),
		DBMinConns: getEnvInt("DB_MIN_CONNS", 5),

		RedisAddr:       getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPass:       getEnv("REDIS_PASS", ""),
		RedisDB:         getEnvInt("REDIS_DB", 0),
		RedisMaxRetries: getEnvInt("REDIS_MAX_RETRIES", 3),

		WakalaFeePercent:     getEnvFloat("WAKALA_FEE_PERCENT", 30.0),
		ParticipantShare:     getEnvFloat("PARTICIPANT_SHARE", 70.0),
		MinContribution:      getEnvFloat("MIN_CONTRIBUTION", 1000.0),
		ShariahBoardApproval: true,
		MaxTabarruPercent:    getEnvFloat("MAX_TABARRU_PERCENT", 100.0),

		ZakatRate:           getEnvFloat("ZAKAT_RATE", 0.025),
		ZakatNisabThreshold: getEnvFloat("ZAKAT_NISAB_THRESHOLD", 85.0), // in grams of gold
		ZakatYearStart:      getEnv("ZAKAT_YEAR_START", "01-01"),

		LogLevel:  getEnv("LOG_LEVEL", "info"),
		LogFormat: getEnv("LOG_FORMAT", "json"),
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

func getEnvFloat(key string, defaultVal float64) float64 {
	if val, ok := os.LookupEnv(key); ok {
		if v, err := strconv.ParseFloat(val, 64); err == nil {
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
