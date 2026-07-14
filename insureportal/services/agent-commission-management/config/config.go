package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port          int           `mapstructure:"PORT"`
	Env           string        `mapstructure:"ENV"`
	ReadTimeout   time.Duration `mapstructure:"READ_TIMEOUT"`
	WriteTimeout  time.Duration `mapstructure:"WRITE_TIMEOUT"`
	ShutdownTimeout time.Duration `mapstructure:"SHUTDOWN_TIMEOUT"`
	HealthCheckPath string      `mapstructure:"HEALTH_CHECK_PATH"`

	DBHost     string `mapstructure:"DB_HOST"`
	DBPort     int    `mapstructure:"DB_PORT"`
	DBUser     string `mapstructure:"DB_USER"`
	DBPass     string `mapstructure:"DB_PASS"`
	DBName     string `mapstructure:"DB_NAME"`
	DBSSLMode  string `mapstructure:"DB_SSL_MODE"`
	DBMaxConns int    `mapstructure:"DB_MAX_CONNS"`
	DBMinConns int    `mapstructure:"DB_MIN_CONNS"`

	RedisAddr     string `mapstructure:"REDIS_ADDR"`
	RedisPass     string `mapstructure:"REDIS_PASS"`
	RedisDB       int    `mapstructure:"REDIS_DB"`
	RedisMaxRetries int   `mapstructure:"REDIS_MAX_RETRIES"`

	// Commission
	DefaultCommissionRate float64 `mapstructure:"DEFAULT_COMMISSION_RATE"` // percentage
	PaymentThreshold    float64 `mapstructure:"PAYMENT_THRESHOLD"` // min amount to trigger payment
	PaymentCycleDays    int     `mapstructure:"PAYMENT_CYCLE_DAYS"`
	ClawbackPeriodDays  int     `mapstructure:"CLAWBACK_PERIOD_DAYS"`
	CommissionSplit     float64 `mapstructure:"COMMISSION_SPLIT"` // broker vs agent split

	// Reporting
	ReportingBatchSize int `mapstructure:"REPORTING_BATCH_SIZE"`
	MaxRecordsPerReport int `mapstructure:"MAX_RECORDS_PER_REPORT"`

	LogLevel  string `mapstructure:"LOG_LEVEL"`
	LogFormat string `mapstructure:"LOG_FORMAT"`
}

func Load() (*Config, error) {
	c := &Config{
		Port:          getEnvInt("PORT", 8130),
		Env:           getEnv("ENV", "production"),
		ReadTimeout:   getEnvDuration("READ_TIMEOUT", 15*time.Second),
		WriteTimeout:  getEnvDuration("WRITE_TIMEOUT", 15*time.Second),
		ShutdownTimeout: getEnvDuration("SHUTDOWN_TIMEOUT", 30*time.Second),
		HealthCheckPath: getEnv("HEALTH_CHECK_PATH", "/health"),
		DBHost:     getEnv("DB_HOST", "localhost"),
		DBPort:     getEnvInt("DB_PORT", 5432),
		DBUser:     getEnv("DB_USER", "commission_service"),
		DBPass:     getEnv("DB_PASS", ""),
		DBName:     getEnv("DB_NAME", "agent_commission"),
		DBSSLMode:  getEnv("DB_SSL_MODE", "prefer"),
		DBMaxConns: getEnvInt("DB_MAX_CONNS", 20),
		DBMinConns: getEnvInt("DB_MIN_CONNS", 5),
		RedisAddr:     getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPass:     getEnv("REDIS_PASS", ""),
		RedisDB:       getEnvInt("REDIS_DB", 0),
		RedisMaxRetries: getEnvInt("REDIS_MAX_RETRIES", 3),
		DefaultCommissionRate: getEnvFloat("DEFAULT_COMMISSION_RATE", 15.0),
		PaymentThreshold:    getEnvFloat("PAYMENT_THRESHOLD", 5000.0),
		PaymentCycleDays:    getEnvInt("PAYMENT_CYCLE_DAYS", 30),
		ClawbackPeriodDays:  getEnvInt("CLAWBACK_PERIOD_DAYS", 90),
		CommissionSplit:     getEnvFloat("COMMISSION_SPLIT", 0.7),
		ReportingBatchSize:  getEnvInt("REPORTING_BATCH_SIZE", 100),
		MaxRecordsPerReport: getEnvInt("MAX_RECORDS_PER_REPORT", 10000),
		LogLevel:  getEnv("LOG_LEVEL", "info"),
		LogFormat: getEnv("LOG_FORMAT", "json"),
	}
	return c, nil
}

func (c *Config) DSN() string {
	return fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		c.DBHost, c.DBPort, c.DBUser, c.DBPass, c.DBName, c.DBSSLMode)
}

func getEnv(key, d string) string {
	if val, ok := os.LookupEnv(key); ok { return val }
	return d
}
func getEnvInt(key string, d int) int {
	if val, ok := os.LookupEnv(key); ok {
		if v, err := strconv.Atoi(val); err == nil { return v }
	}
	return d
}
func getEnvFloat(key string, d float64) float64 {
	if val, ok := os.LookupEnv(key); ok {
		if v, err := strconv.ParseFloat(val, 64); err == nil { return v }
	}
	return d
}
func getEnvDuration(key string, d time.Duration) time.Duration {
	if val, ok := os.LookupEnv(key); ok {
		if v, err := time.ParseDuration(val); err == nil { return v }
	}
	return d
}
