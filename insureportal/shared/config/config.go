package config

import (
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

// ServiceConfig holds common service configuration
type ServiceConfig struct {
	// Service identification
	ServiceName    string
	ServiceVersion string
	Environment    string

	// Server configuration
	HTTPPort     int
	GRPCPort     int
	MetricsPort  int
	HealthPort   int

	// Database configuration
	DatabaseURL      string
	DatabaseHost     string
	DatabasePort     int
	DatabaseName     string
	DatabaseUser     string
	DatabasePassword string
	DatabaseSSLMode  string
	DatabaseMaxConns int
	DatabaseMinConns int

	// Redis configuration
	RedisURL      string
	RedisHost     string
	RedisPort     int
	RedisPassword string
	RedisDB       int

	// Kafka configuration
	KafkaBrokers       []string
	KafkaConsumerGroup string
	KafkaClientID      string

	// Dapr configuration
	DaprHTTPPort  int
	DaprGRPCPort  int
	DaprPubSubName string
	DaprStateStore string

	// Keycloak configuration
	KeycloakURL      string
	KeycloakRealm    string
	KeycloakClientID string
	KeycloakSecret   string

	// Observability
	JaegerEndpoint    string
	PrometheusEnabled bool
	LogLevel          string
	LogFormat         string

	// Security
	EncryptionKey     string
	JWTSecret         string
	APIKeyHeader      string
	CORSAllowedOrigins []string

	// Timeouts
	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
	IdleTimeout     time.Duration
	ShutdownTimeout time.Duration
}

// LoadConfig loads configuration from environment variables
func LoadConfig(serviceName string) (*ServiceConfig, error) {
	cfg := &ServiceConfig{
		ServiceName:    serviceName,
		ServiceVersion: getEnv("SERVICE_VERSION", "1.0.0"),
		Environment:    getEnv("ENVIRONMENT", "development"),

		// Server defaults
		HTTPPort:    getEnvInt("HTTP_PORT", 8080),
		GRPCPort:    getEnvInt("GRPC_PORT", 9090),
		MetricsPort: getEnvInt("METRICS_PORT", 9091),
		HealthPort:  getEnvInt("HEALTH_PORT", 8081),

		// Database
		DatabaseURL:      getEnv("DATABASE_URL", ""),
		DatabaseHost:     getEnv("DATABASE_HOST", "localhost"),
		DatabasePort:     getEnvInt("DATABASE_PORT", 5432),
		DatabaseName:     getEnv("DATABASE_NAME", serviceName),
		DatabaseUser:     getEnv("DATABASE_USER", "postgres"),
		DatabasePassword: getEnv("DATABASE_PASSWORD", ""),
		DatabaseSSLMode:  getEnv("DATABASE_SSL_MODE", "disable"),
		DatabaseMaxConns: getEnvInt("DATABASE_MAX_CONNS", 25),
		DatabaseMinConns: getEnvInt("DATABASE_MIN_CONNS", 5),

		// Redis
		RedisURL:      getEnv("REDIS_URL", ""),
		RedisHost:     getEnv("REDIS_HOST", "localhost"),
		RedisPort:     getEnvInt("REDIS_PORT", 6379),
		RedisPassword: getEnv("REDIS_PASSWORD", ""),
		RedisDB:       getEnvInt("REDIS_DB", 0),

		// Kafka
		KafkaBrokers:       requireEnvSlice("KAFKA_BROKERS"),
		KafkaConsumerGroup: getEnv("KAFKA_CONSUMER_GROUP", serviceName),
		KafkaClientID:      getEnv("KAFKA_CLIENT_ID", serviceName),

		// Dapr
		DaprHTTPPort:   getEnvInt("DAPR_HTTP_PORT", 3500),
		DaprGRPCPort:   getEnvInt("DAPR_GRPC_PORT", 50001),
		DaprPubSubName: getEnv("DAPR_PUBSUB_NAME", "pubsub"),
		DaprStateStore: getEnv("DAPR_STATE_STORE", "statestore"),

		// Keycloak
		KeycloakURL:      getEnv("KEYCLOAK_URL", "http://localhost:8080"),
		KeycloakRealm:    getEnv("KEYCLOAK_REALM", "insurance"),
		KeycloakClientID: getEnv("KEYCLOAK_CLIENT_ID", serviceName),
		KeycloakSecret:   getEnv("KEYCLOAK_CLIENT_SECRET", ""),

		// Observability
		JaegerEndpoint:    getEnv("JAEGER_ENDPOINT", "http://localhost:14268/api/traces"),
		PrometheusEnabled: getEnvBool("PROMETHEUS_ENABLED", true),
		LogLevel:          getEnv("LOG_LEVEL", "info"),
		LogFormat:         getEnv("LOG_FORMAT", "json"),

		// Security
		EncryptionKey:      getEnv("ENCRYPTION_KEY", ""),
		JWTSecret:          getEnv("JWT_SECRET", ""),
		APIKeyHeader:       getEnv("API_KEY_HEADER", "X-API-Key"),
		CORSAllowedOrigins: getEnvSlice("CORS_ALLOWED_ORIGINS", []string{"*"}),

		// Timeouts
		ReadTimeout:     getEnvDuration("READ_TIMEOUT", 30*time.Second),
		WriteTimeout:    getEnvDuration("WRITE_TIMEOUT", 30*time.Second),
		IdleTimeout:     getEnvDuration("IDLE_TIMEOUT", 120*time.Second),
		ShutdownTimeout: getEnvDuration("SHUTDOWN_TIMEOUT", 30*time.Second),
	}

	// Build database URL if not provided
	if cfg.DatabaseURL == "" && cfg.DatabaseHost != "" {
		cfg.DatabaseURL = fmt.Sprintf(
			"postgres://%s:%s@%s:%d/%s?sslmode=%s",
			cfg.DatabaseUser,
			cfg.DatabasePassword,
			cfg.DatabaseHost,
			cfg.DatabasePort,
			cfg.DatabaseName,
			cfg.DatabaseSSLMode,
		)
	}

	// Build Redis URL if not provided
	if cfg.RedisURL == "" && cfg.RedisHost != "" {
		if cfg.RedisPassword != "" {
			cfg.RedisURL = fmt.Sprintf("redis://:%s@%s:%d/%d", cfg.RedisPassword, cfg.RedisHost, cfg.RedisPort, cfg.RedisDB)
		} else {
			cfg.RedisURL = fmt.Sprintf("redis://%s:%d/%d", cfg.RedisHost, cfg.RedisPort, cfg.RedisDB)
		}
	}

	return cfg, nil
}

// Validate validates the configuration
func (c *ServiceConfig) Validate() error {
	if c.ServiceName == "" {
		return fmt.Errorf("service name is required")
	}
	if c.HTTPPort <= 0 || c.HTTPPort > 65535 {
		return fmt.Errorf("invalid HTTP port: %d", c.HTTPPort)
	}
	if c.Environment == "production" {
		if c.EncryptionKey == "" {
			return fmt.Errorf("encryption key is required in production")
		}
		if c.JWTSecret == "" {
			return fmt.Errorf("JWT secret is required in production")
		}
		if c.DatabaseSSLMode == "disable" {
			return fmt.Errorf("database SSL must be enabled in production")
		}
	}
	return nil
}

// IsProduction returns true if running in production environment
func (c *ServiceConfig) IsProduction() bool {
	return c.Environment == "production"
}

// IsDevelopment returns true if running in development environment
func (c *ServiceConfig) IsDevelopment() bool {
	return c.Environment == "development"
}

// Helper functions
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}

func getEnvBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		if boolValue, err := strconv.ParseBool(value); err == nil {
			return boolValue
		}
	}
	return defaultValue
}

func getEnvSlice(key string, defaultValue []string) []string {
	if value := os.Getenv(key); value != "" {
		return strings.Split(value, ",")
	}
	return defaultValue
}

func requireEnvSlice(key string) []string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("FATAL: %s environment variable is required", key)
	}
	return strings.Split(value, ",")
}

func getEnvDuration(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if duration, err := time.ParseDuration(value); err == nil {
			return duration
		}
	}
	return defaultValue
}

// GetDatabaseDSN returns the database connection string
func (c *ServiceConfig) GetDatabaseDSN() string {
	return c.DatabaseURL
}

// GetRedisAddr returns the Redis address
func (c *ServiceConfig) GetRedisAddr() string {
	return fmt.Sprintf("%s:%d", c.RedisHost, c.RedisPort)
}

// GetHTTPAddr returns the HTTP server address
func (c *ServiceConfig) GetHTTPAddr() string {
	return fmt.Sprintf(":%d", c.HTTPPort)
}

// GetGRPCAddr returns the gRPC server address
func (c *ServiceConfig) GetGRPCAddr() string {
	return fmt.Sprintf(":%d", c.GRPCPort)
}

// GetMetricsAddr returns the metrics server address
func (c *ServiceConfig) GetMetricsAddr() string {
	return fmt.Sprintf(":%d", c.MetricsPort)
}
