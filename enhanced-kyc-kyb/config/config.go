package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port             string
	DBHost           string
	DBPort           string
	DBUser           string
	DBPassword       string
	DBName           string
	DBMaxConns       int32
	DBMinConns       int32
	DBMaxLifetime    time.Duration
	DBMaxIdleTime    time.Duration
	RedisAddr        string
	RedisPassword    string
	RedisDB          int
	NINAPIURL        string
	NINAPIKey        string
	BVNAPIURL        string
	BVNAPIKey        string
	NINRetryAttempts int
	BVNRetryAttempts int
	NINRetryDelay    time.Duration
	BVNRetryDelay    time.Duration
	KYCTTL           time.Duration
	KYBTTT           time.Duration
	AuditRetention   time.Duration
	JWTSecret        string
	// APIKey is the shared service-to-service credential required on all
	// protected endpoints (G2 audit 2026-02: replaces per-request bcrypt of
	// the JWT secret — that was both a CPU-exhaustion DoS and secret reuse).
	APIKey           string
	RateLimitNIN     int
	RateLimitBVN     int
	RateLimitWindow  time.Duration
	// PEPAPIURL: sanctions/PEP screening provider. When directors are
	// submitted and this is unset, KYB fails LOUD (no mock screening).
	PEPAPIURL string
	PEPAPIKey string
	// CACAPIURL / TINAPIURL: registry verification providers (CAC public
	// search / FIRS TIN). G1 fix-wave (2026-06): when an RC number or TIN is
	// submitted and the matching provider is unset, KYB fails LOUD (503) —
	// presence of a number string is NEVER treated as verification.
	CACAPIURL string
	CACAPIKey string
	TINAPIURL string
	TINAPIKey string
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
		JWTSecret:        getEnv("JWT_SECRET", ""),
		APIKey:           getEnv("KYC_API_KEY", ""),
		RateLimitNIN:     getEnvInt("RATE_LIMIT_NIN", 10),
		RateLimitBVN:     getEnvInt("RATE_LIMIT_BVN", 10),
		RateLimitWindow:  getEnvDuration("RATE_LIMIT_WINDOW", 1*time.Hour),
		PEPAPIURL:        getEnv("PEP_API_URL", ""),
		CACAPIURL:        getEnv("CAC_API_URL", ""),
		CACAPIKey:        getEnv("CAC_API_KEY", ""),
		TINAPIURL:        getEnv("TIN_API_URL", ""),
		TINAPIKey:        getEnv("TIN_API_KEY", ""),
		PEPAPIKey:        getEnv("PEP_API_KEY", ""),
	}
}

// DefaultJWTSecret is the historical insecure default. It must NEVER be
// accepted at boot (G2 audit 2026-02, finding #3: with the default, anyone
// could call every protected KYC endpoint).
const DefaultJWTSecret = "change-me-in-production"

// Validate enforces fail-closed startup: the service refuses to boot with a
// missing/default JWT secret or a missing/weak API key, in ANY environment.
// Honest error over silent insecurity.
func (c *Config) Validate() error {
	if c.JWTSecret == "" {
		return fmt.Errorf("JWT_SECRET is not set; refusing to start (no default credentials)")
	}
	if c.JWTSecret == DefaultJWTSecret {
		return fmt.Errorf("JWT_SECRET is the insecure default %q; refusing to start — set a strong secret", DefaultJWTSecret)
	}
	if len(c.JWTSecret) < 32 {
		return fmt.Errorf("JWT_SECRET is too short (%d chars); refusing to start — use at least 32 random chars", len(c.JWTSecret))
	}
	if c.APIKey == "" {
		return fmt.Errorf("KYC_API_KEY is not set; refusing to start (protected endpoints require a service API key)")
	}
	if len(c.APIKey) < 16 {
		return fmt.Errorf("KYC_API_KEY is too short (%d chars); refusing to start — use at least 16 random chars", len(c.APIKey))
	}
	if c.APIKey == c.JWTSecret {
		return fmt.Errorf("KYC_API_KEY must differ from JWT_SECRET (no shared-secret reuse); refusing to start")
	}
	return nil
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
