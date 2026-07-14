package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds all configuration for the claims adjudication engine
type Config struct {
	Server    ServerConfig
	Database  DatabaseConfig
	Redis     RedisConfig
	Kafka     KafkaConfig
	Temporal  TemporalConfig
	Observability ObservabilityConfig
	SLA       SLAConfig
	RateLimit RateLimitConfig
}

// ServerConfig holds HTTP server configuration
type ServerConfig struct {
	Port              int           `json:"port"`
	ReadTimeout       time.Duration `json:"read_timeout"`
	WriteTimeout      time.Duration `json:"write_timeout"`
	ShutdownTimeout   time.Duration `json:"shutdown_timeout"`
	Environment       string        `json:"environment"`
	MaxRequestBody    int64         `json:"max_request_body"`
}

// DatabaseConfig holds PostgreSQL configuration
type DatabaseConfig struct {
	Host                string        `json:"host"`
	Port                int           `json:"port"`
	User                string        `json:"user"`
	Password            string        `json:"password"`
	DBName              string        `json:"dbname"`
	MaxOpenConns        int           `json:"max_open_conns"`
	MaxIdleConns        int           `json:"max_idle_conns"`
	ConnMaxLifetime     time.Duration `json:"conn_max_lifetime"`
	ConnMaxIdleTime     time.Duration `json:"conn_max_idle_time"`
	SSLMode             string        `json:"ssl_mode"`
	MinioURL            string        `json:"minio_url"`
	MinioAccessKey      string        `json:"minio_access_key"`
	MinioSecretKey      string        `json:"minio_secret_key"`
	MinioBucket         string        `json:"minio_bucket"`
}

// RedisConfig holds Redis configuration
type RedisConfig struct {
	Host             string        `json:"host"`
	Port             int           `json:"port"`
	Password         string        `json:"password"`
	DB               int           `json:"db"`
	MaxRetries       int           `json:"max_retries"`
	PoolSize         int           `json:"pool_size"`
	MinConns         int           `json:"min_conns"`
	ConnMaxIdleTime  time.Duration `json:"conn_max_idle_time"`
	ClusterMode      bool          `json:"cluster_mode"`
	ClusterNodes     []string      `json:"cluster_nodes"`
}

// KafkaConfig holds Kafka configuration
type KafkaConfig struct {
	Brokers      []string      `json:"brokers"`
	TopicPrefix  string        `json:"topic_prefix"`
	ConsumerGroup string       `json:"consumer_group"`
	MaxRetry     int           `json:"max_retry"`
	CommitInterval time.Duration `json:"commit_interval"`
}

// TemporalConfig holds Temporal workflow engine configuration
type TemporalConfig struct {
	HostPort    string        `json:"host_port"`
	Namespace   string        `json:"namespace"`
	TaskQueue   string        `json:"task_queue"`
	MaxConns    int           `json:"max_conns"`
}

// ObservabilityConfig holds OpenTelemetry/Prometheus configuration
type ObservabilityConfig struct {
	Enabled          bool          `json:"enabled"`
	PrometheusPort   int           `json:"prometheus_port"`
	OtelEndpoint     string        `json:"otel_endpoint"`
	ServiceName      string        `json:"service_name"`
	LogLevel         string        `json:"log_level"`
	LogFormat        string        `json:"log_format"`
}

// SLAConfig holds SLA configuration
type SLAConfig struct {
	AutoApprovalMaxHours     int `json:"auto_approval_max_hours"`
	SupervisorReviewHours    int `json:"supervisor_review_hours"`
	ExecutiveApprovalDays    int `json:"executive_approval_days"`
	FraudInvestigationDays   int `json:"fraud_investigation_days"`
}

// RateLimitConfig holds API rate limiting configuration
type RateLimitConfig struct {
	Enabled         bool          `json:"enabled"`
	RPS             int           `json:"rps"`
	Burst           int           `json:"burst"`
	WindowSize      time.Duration `json:"window_size"`
	MaxClaimsPerPolicy time.Duration `json:"max_claims_per_policy"`
	MaxClaimsPerDay int           `json:"max_claims_per_day"`
}

// Load loads configuration from environment variables with defaults
func Load() *Config {
	return &Config{
		Server: ServerConfig{
			Port:           getEnvInt("SERVER_PORT", 8090),
			ReadTimeout:    getEnvDuration("SERVER_READ_TIMEOUT", 15*time.Second),
			WriteTimeout:   getEnvDuration("SERVER_WRITE_TIMEOUT", 15*time.Second),
			ShutdownTimeout: getEnvDuration("SERVER_SHUTDOWN_TIMEOUT", 30*time.Second),
			Environment:    getEnv("SERVER_ENVIRONMENT", "production"),
			MaxRequestBody: getEnvInt64("SERVER_MAX_REQUEST_BODY", 10*1024*1024),
		},
		Database: DatabaseConfig{
			Host:              getEnv("DB_HOST", "localhost"),
			Port:              getEnvInt("DB_PORT", 5432),
			User:              getEnv("DB_USER", "claims_engine"),
			Password:          getEnv("DB_PASSWORD", ""),
			DBName:            getEnv("DB_NAME", "ngapp_claims"),
			MaxOpenConns:      getEnvInt("DB_MAX_OPEN_CONNS", 25),
			MaxIdleConns:      getEnvInt("DB_MAX_IDLE_CONNS", 5),
			ConnMaxLifetime:   getEnvDuration("DB_CONN_MAX_LIFETIME", 5*time.Minute),
			ConnMaxIdleTime:   getEnvDuration("DB_CONN_MAX_IDLE_TIME", 3*time.Minute),
			SSLMode:           getEnv("DB_SSL_MODE", "prefer"),
			MinioURL:          getEnv("MINIO_URL", "localhost:9000"),
			MinioAccessKey:    getEnv("MINIO_ACCESS_KEY", ""),
			MinioSecretKey:    getEnv("MINIO_SECRET_KEY", ""),
			MinioBucket:       getEnv("MINIO_BUCKET", "claims-evidence"),
		},
		Redis: RedisConfig{
			Host:            getEnv("REDIS_HOST", "localhost"),
			Port:            getEnvInt("REDIS_PORT", 6379),
			Password:        getEnv("REDIS_PASSWORD", ""),
			DB:              getEnvInt("REDIS_DB", 0),
			MaxRetries:      getEnvInt("REDIS_MAX_RETRIES", 3),
			PoolSize:        getEnvInt("REDIS_POOL_SIZE", 10),
			MinConns:        getEnvInt("REDIS_MIN_CONNS", 2),
			ConnMaxIdleTime: getEnvDuration("REDIS_CONN_MAX_IDLE_TIME", 3*time.Minute),
			ClusterMode:     getEnvBool("REDIS_CLUSTER_MODE", false),
		},
		Kafka: KafkaConfig{
			Brokers:          getEnvStringSlice("KAFKA_BROKERS", []string{"localhost:9092"}),
			TopicPrefix:      getEnv("KAFKA_TOPIC_PREFIX", "ngapp"),
			ConsumerGroup:    getEnv("KAFKA_CONSUMER_GROUP", "claims-adjudication-group"),
			MaxRetry:         getEnvInt("KAFKA_MAX_RETRY", 3),
			CommitInterval:   getEnvDuration("KAFKA_COMMIT_INTERVAL", 1*time.Second),
		},
		Temporal: TemporalConfig{
			HostPort:    getEnv("TEMPORAL_HOST_PORT", "localhost:7233"),
			Namespace:   getEnv("TEMPORAL_NAMESPACE", "claims-engine"),
			TaskQueue:   getEnv("TEMPORAL_TASK_QUEUE", "claims-adjudication"),
			MaxConns:    getEnvInt("TEMPORAL_MAX_CONNS", 100),
		},
		Observability: ObservabilityConfig{
			Enabled:        getEnvBool("OBSERVABILITY_ENABLED", true),
			PrometheusPort: getEnvInt("PROMETHEUS_PORT", 9091),
			OtelEndpoint:   getEnv("OTEL_ENDPOINT", ""),
			ServiceName:    getEnv("SERVICE_NAME", "claims-adjudication-engine"),
			LogLevel:       getEnv("LOG_LEVEL", "info"),
			LogFormat:      getEnv("LOG_FORMAT", "json"),
		},
		SLA: SLAConfig{
			AutoApprovalMaxHours:     getEnvInt("SLA_AUTO_APPROVAL_HOURS", 48),
			SupervisorReviewHours:    getEnvInt("SLA_SUPERVISOR_REVIEW_HOURS", 72),
			ExecutiveApprovalDays:    getEnvInt("SLA_EXECUTIVE_APPROVAL_DAYS", 5),
			FraudInvestigationDays:   getEnvInt("SLA_FRAUD_INVESTIGATION_DAYS", 10),
		},
		RateLimit: RateLimitConfig{
			Enabled:           getEnvBool("RATE_LIMIT_ENABLED", true),
			RPS:               getEnvInt("RATE_LIMIT_RPS", 100),
			Burst:             getEnvInt("RATE_LIMIT_BURST", 200),
			WindowSize:        getEnvDuration("RATE_LIMIT_WINDOW", 1*time.Minute),
			MaxClaimsPerPolicy: getEnvDuration("RATE_LIMIT_POLICY_WINDOW", 1*time.Hour),
			MaxClaimsPerDay:   getEnvInt("RATE_LIMIT_MAX_PER_DAY", 10),
		},
	}
}

// DatabaseURL returns the PostgreSQL connection string
func (c *DatabaseConfig) DatabaseURL() string {
	return fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		c.Host, c.Port, c.User, c.Password, c.DBName, c.SSLMode)
}

// RedisAddr returns the Redis connection address
func (c *RedisConfig) RedisAddr() string {
	return fmt.Sprintf("%s:%d", c.Host, c.Port)
}

// Validate validates the configuration
func (c *Config) Validate() error {
	if c.Database.User == "" {
		return fmt.Errorf("DB_USER is required")
	}
	if c.Database.Password == "" {
		return fmt.Errorf("DB_PASSWORD is required")
	}
	if c.Database.DBName == "" {
		return fmt.Errorf("DB_NAME is required")
	}
	if len(c.Kafka.Brokers) == 0 {
		return fmt.Errorf("KAFKA_BROKERS is required")
	}
	if c.Server.Port < 1 || c.Server.Port > 65535 {
		return fmt.Errorf("SERVER_PORT must be between 1 and 65535")
	}
	return nil
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intVal, err := strconv.Atoi(value); err == nil {
			return intVal
		}
	}
	return defaultValue
}

func getEnvInt64(key string, defaultValue int64) int64 {
	if value := os.Getenv(key); value != "" {
		if intVal, err := strconv.ParseInt(value, 10, 64); err == nil {
			return intVal
		}
	}
	return defaultValue
}

func getEnvDuration(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if dur, err := time.ParseDuration(value); err == nil {
			return dur
		}
	}
	return defaultValue
}

func getEnvBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		if boolVal, err := strconv.ParseBool(value); err == nil {
			return boolVal
		}
	}
	return defaultValue
}

func getEnvStringSlice(key string, defaultValue []string) []string {
	if value := os.Getenv(key); value != "" {
		return []string{value}
	}
	return defaultValue
}
