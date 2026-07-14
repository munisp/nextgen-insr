package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port               string
	DBHost             string
	DBPort             string
	DBUser             string
	DBPassword         string
	DBName             string
	DBMaxConns         int32
	DBMinConns         int32
	DBMaxLifetime      time.Duration
	DBMaxIdleTime      time.Duration
	RedisAddr          string
	RedisPassword      string
	RedisDB            int
	NINAPIURL          string
	NINAPIKey          string
	BVNAPIURL          string
	BVNAPIKey          string
	NINRetryAttempts   int
	BVNRetryAttempts   int
	NINRetryDelay      time.Duration
	BVNRetryDelay      time.Duration
	KYCTTL             time.Duration
	KYBTTT             time.Duration
	AuditRetention     time.Duration
	JWTSecret          string
	RateLimitNIN       int
	RateLimitBVN       int
	RateLimitWindow    time.Duration
}

func Load() *Config {
	return &Config{
		Port:             getEnv("PORT", "8121"),
		DBHost:           getEnv("DB_HOST", "localhost"),
		DBPort:           getEnv("DB_PORT", "5432"),
		DBUser:           getEnv("DB_USER", "kyc_user"),
		DBPassword:       getEnv("DB_PASSWORD", ""),
		DBName:           getEnv("DB_NAME", "enhanced_kyc"),
		DBMaxConns:       int32(getEnvInt("DB_MAX_CONNS", 25)),
		DBMinConns:       int32(getEnvInt("DB_MIN_CONNS", 5)),
		DBMaxLifetime:    getEnvDuration("DB_MAX_LIFETIME", 30*time.Minute),
		DBMaxIdleTime:    getEnvDuration("DB_MAX_IDLE_TIME", 15*time.Minute),
		RedisAddr:        getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPassword:    getEnv("REDIS_PASSWORD", ""),
		RedisDB:          getEnvInt("REDIS_DB", 0),
		NINAPIURL:        getEnv("NIN_API_URL", "http://localhost:9001/api/v1/nin/verify"),
		NINAPIKey:        getEnv("NIN_API_KEY", ""),
		BVNAPIURL:        getEnv("BVN_API_URL", "http://localhost:9001/api/v1/bvn/verify"),
		BVNAPIKey:        getEnv("BVN_API_KEY", ""),
		NINRetryAttempts: getEnvInt("NIN_RETRY_ATTEMPTS", 3),
		BVNRetryAttempts: getEnvInt("BVN_RETRY_ATTEMPTS", 3),
		NINRetryDelay:    getEnvDuration("NIN_RETRY_DELAY", 1*time.Second),
		BVNRetryDelay:    getEnvDuration("BVN_RETRY_DELAY", 1*time.Second),
		KYCTTL:           getEnvDuration("KYC_TTL", 2*365*24*time.Hour),
		KYBTTT:           getEnvDuration("KYB_TTL", 1*365*24*time.Hour),
		AuditRetention:   getEnvDuration("AUDIT_RETENTION", 7*365*24*time.Hour),
		JWTSecret:        getEnv("JWT_SECRET", "change-me-in-production"),
		RateLimitNIN:     getEnvInt("RATE_LIMIT_NIN", 10),
		RateLimitBVN:     getEnvInt("RATE_LIMIT_BVN", 10),
		RateLimitWindow:  getEnvDuration("RATE_LIMIT_WINDOW", 1*time.Hour),
	}
}

func (c *Config) DSN() string {
	return fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		c.DBHost, c.DBPort, c.DBUser, c.DBPassword, c.DBName,
	)
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}
