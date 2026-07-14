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

	// MDM specific
	DedupThreshold       float64 `mapstructure:"DEDUP_THRESHOLD"` // 0.85
	MinQualityScore      int     `mapstructure:"MIN_QUALITY_SCORE"` // 70
	SyncBatchSize        int     `mapstructure:"SYNC_BATCH_SIZE"` // 100
	DataStewardRole      string  `mapstructure:"DATA_STEWARD_ROLE"`
	MaxMergeCandidates   int     `mapstructure:"MAX_MERGE_CANDIDATES"` // 1000

	LogLevel  string `mapstructure:"LOG_LEVEL"`
	LogFormat string `mapstructure:"LOG_FORMAT"`
}

func Load() (*Config, error) {
	c := &Config{
		Port:          getEnvInt("PORT", 8095),
		Env:           getEnv("ENV", "production"),
		ReadTimeout:   getEnvDuration("READ_TIMEOUT", 15*time.Second),
		WriteTimeout:  getEnvDuration("WRITE_TIMEOUT", 15*time.Second),
		ShutdownTimeout: getEnvDuration("SHUTDOWN_TIMEOUT", 30*time.Second),
		HealthCheckPath: getEnv("HEALTH_CHECK_PATH", "/health"),
		DBHost:     getEnv("DB_HOST", "localhost"),
		DBPort:     getEnvInt("DB_PORT", 5432),
		DBUser:     getEnv("DB_USER", "mdm_service"),
		DBPass:     getEnv("DB_PASS", ""),
		DBName:     getEnv("DB_NAME", "enterprise_mdm"),
		DBSSLMode:  getEnv("DB_SSL_MODE", "prefer"),
		DBMaxConns: getEnvInt("DB_MAX_CONNS", 20),
		DBMinConns: getEnvInt("DB_MIN_CONNS", 5),
		RedisAddr:     getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPass:     getEnv("REDIS_PASS", ""),
		RedisDB:       getEnvInt("REDIS_DB", 0),
		RedisMaxRetries: getEnvInt("REDIS_MAX_RETRIES", 3),
		DedupThreshold:       getEnvFloat("DEDUP_THRESHOLD", 0.85),
		MinQualityScore:      getEnvInt("MIN_QUALITY_SCORE", 70),
		SyncBatchSize:        getEnvInt("SYNC_BATCH_SIZE", 100),
		DataStewardRole:      getEnv("DATA_STEWARD_ROLE", "data_steward"),
		MaxMergeCandidates:   getEnvInt("MAX_MERGE_CANDIDATES", 1000),
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
