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

	// SMS
	SMSEnabled    bool `mapstructure:"SMS_ENABLED"`
	SMSTiermiAPIKey string `mapstructure:"SMS_TERMII_API_KEY"`
	SMSMaxPerDay  int  `mapstructure:"SMS_MAX_PER_DAY"`

	// Email
	EmailEnabled    bool `mapstructure:"EMAIL_ENABLED"`
	EmailSendGridKey string `mapstructure:"EMAIL_SENDGRID_KEY"`
	EmailFromName   string `mapstructure:"EMAIL_FROM_NAME"`
	EmailFromAddress string `mapstructure:"EMAIL_FROM_ADDRESS"`

	// Push
	PushEnabled    bool `mapstructure:"PUSH_ENABLED"`
	PushFCMServerKey string `mapstructure:"PUSH_FCM_SERVER_KEY"`
	PushMaxPerHour  int  `mapstructure:"PUSH_MAX_PER_HOUR"`

	// WhatsApp
	WhatsAppEnabled bool `mapstructure:"WHATSAPP_ENABLED"`
	WhatsAppAPIKey  string `mapstructure:"WHATSAPP_API_KEY"`

	// Retry
	RetryMaxAttempts  int `mapstructure:"RETRY_MAX_ATTEMPTS"`
	RetryInitialDelay int `mapstructure:"RETRY_INITIAL_DELAY"` // seconds
	RetryBackoffFactor int `mapstructure:"RETRY_BACKOFF_FACTOR"`

	// Quiet hours
	QuietHoursStart string `mapstructure:"QUIET_HOURS_START"`
	QuietHoursEnd   string `mapstructure:"QUIET_HOURS_END"`

	LogLevel  string `mapstructure:"LOG_LEVEL"`
	LogFormat string `mapstructure:"LOG_FORMAT"`
}

func Load() (*Config, error) {
	c := &Config{
		Port:          getEnvInt("PORT", 8122),
		Env:           getEnv("ENV", "production"),
		ReadTimeout:   getEnvDuration("READ_TIMEOUT", 15*time.Second),
		WriteTimeout:  getEnvDuration("WRITE_TIMEOUT", 15*time.Second),
		ShutdownTimeout: getEnvDuration("SHUTDOWN_TIMEOUT", 30*time.Second),
		HealthCheckPath: getEnv("HEALTH_CHECK_PATH", "/health"),
		DBHost:     getEnv("DB_HOST", "localhost"),
		DBPort:     getEnvInt("DB_PORT", 5432),
		DBUser:     getEnv("DB_USER", "notification_service"),
		DBPass:     getEnv("DB_PASS", ""),
		DBName:     getEnv("DB_NAME", "notification_service"),
		DBSSLMode:  getEnv("DB_SSL_MODE", "prefer"),
		DBMaxConns: getEnvInt("DB_MAX_CONNS", 20),
		DBMinConns: getEnvInt("DB_MIN_CONNS", 5),
		RedisAddr:     getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPass:     getEnv("REDIS_PASS", ""),
		RedisDB:       getEnvInt("REDIS_DB", 0),
		RedisMaxRetries: getEnvInt("REDIS_MAX_RETRIES", 3),
		SMSMaxPerDay:  getEnvInt("SMS_MAX_PER_DAY", 5),
		PushMaxPerHour: getEnvInt("PUSH_MAX_PER_HOUR", 3),
		RetryMaxAttempts: getEnvInt("RETRY_MAX_ATTEMPTS", 3),
		RetryInitialDelay: getEnvInt("RETRY_INITIAL_DELAY", 60),
		RetryBackoffFactor: getEnvInt("RETRY_BACKOFF_FACTOR", 2),
		QuietHoursStart: getEnv("QUIET_HOURS_START", "22:00"),
		QuietHoursEnd:   getEnv("QUIET_HOURS_END", "07:00"),
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
func getEnvDuration(key string, d time.Duration) time.Duration {
	if val, ok := os.LookupEnv(key); ok {
		if v, err := time.ParseDuration(val); err == nil { return v }
	}
	return d
}
