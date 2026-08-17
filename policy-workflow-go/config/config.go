package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port            int           `mapstructure:"PORT"`
	Env             string        `mapstructure:"ENV"`
	ReadTimeout     time.Duration `mapstructure:"READ_TIMEOUT"`
	WriteTimeout    time.Duration `mapstructure:"WRITE_TIMEOUT"`
	ShutdownTimeout time.Duration `mapstructure:"SHUTDOWN_TIMEOUT"`
	HealthCheckPath string        `mapstructure:"HEALTH_CHECK_PATH"`

	DBHost     string `mapstructure:"DB_HOST"`
	DBPort     int    `mapstructure:"DB_PORT"`
	DBUser     string `mapstructure:"DB_USER"`
	DBPass     string `mapstructure:"DB_PASS"`
	DBName     string `mapstructure:"DB_NAME"`
	DBSSLMode  string `mapstructure:"DB_SSL_MODE"`
	DBMaxConns int    `mapstructure:"DB_MAX_CONNS"`
	DBMinConns int    `mapstructure:"DB_MIN_CONNS"`

	RedisAddr       string `mapstructure:"REDIS_ADDR"`
	RedisPass       string `mapstructure:"REDIS_PASS"`
	RedisDB         int    `mapstructure:"REDIS_DB"`
	RedisMaxRetries int    `mapstructure:"REDIS_MAX_RETRIES"`

	// Policy specific
	UnderwritingAutoThreshold int `mapstructure:"UNDERWRITING_AUTO_THRESHOLD"`
	AutoIssueDays             int `mapstructure:"AUTO_ISSUE_DAYS"`
	CoolingOffDays            int `mapstructure:"COOLING_OFF_DAYS"`
	LapseGracePeriodDays      int `mapstructure:"LAPSE_GRACE_PERIOD_DAYS"`
	RenewalReminderDays       int `mapstructure:"RENEWAL_REMINDER_DAYS"`
	RenewalGracePeriodDays    int `mapstructure:"RENEWAL_GRACE_PERIOD_DAYS"`

	LogLevel  string `mapstructure:"LOG_LEVEL"`
	LogFormat string `mapstructure:"LOG_FORMAT"`
}

func Load() (*Config, error) {
	c := &Config{
		Port:                      getEnvInt("PORT", 8106),
		Env:                       getEnv("ENV", "production"),
		ReadTimeout:               getEnvDuration("READ_TIMEOUT", 15*time.Second),
		WriteTimeout:              getEnvDuration("WRITE_TIMEOUT", 15*time.Second),
		ShutdownTimeout:           getEnvDuration("SHUTDOWN_TIMEOUT", 30*time.Second),
		HealthCheckPath:           getEnv("HEALTH_CHECK_PATH", "/health"),
		DBHost:                    getEnv("DB_HOST", "localhost"),
		DBPort:                    getEnvInt("DB_PORT", 5432),
		DBUser:                    getEnv("DB_USER", "policy_service"),
		DBPass:                    getEnv("DB_PASS", ""),
		DBName:                    getEnv("DB_NAME", "policy_workflow"),
		DBSSLMode:                 getEnv("DB_SSL_MODE", "prefer"),
		DBMaxConns:                getEnvInt("DB_MAX_CONNS", 20),
		DBMinConns:                getEnvInt("DB_MIN_CONNS", 5),
		RedisAddr:                 getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPass:                 getEnv("REDIS_PASS", ""),
		RedisDB:                   getEnvInt("REDIS_DB", 0),
		RedisMaxRetries:           getEnvInt("REDIS_MAX_RETRIES", 3),
		UnderwritingAutoThreshold: getEnvInt("UNDERWRITING_AUTO_THRESHOLD", 50),
		AutoIssueDays:             getEnvInt("AUTO_ISSUE_DAYS", 7),
		CoolingOffDays:            getEnvInt("COOLING_OFF_DAYS", 14),
		LapseGracePeriodDays:      getEnvInt("LAPSE_GRACE_PERIOD_DAYS", 30),
		RenewalReminderDays:       getEnvInt("RENEWAL_REMINDER_DAYS", 30),
		RenewalGracePeriodDays:    getEnvInt("RENEWAL_GRACE_PERIOD_DAYS", 15),
		LogLevel:                  getEnv("LOG_LEVEL", "info"),
		LogFormat:                 getEnv("LOG_FORMAT", "json"),
	}
	return c, nil
}

func (c *Config) DSN() string {
	return fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		c.DBHost, c.DBPort, c.DBUser, c.DBPass, c.DBName, c.DBSSLMode)
}

func getEnv(key, defaultVal string) string {
	if val, ok := os.LookupEnv(key); ok {
		return val
	}
	return defaultVal
}
func getEnvInt(key string, d int) int {
	if val, ok := os.LookupEnv(key); ok {
		if v, err := strconv.Atoi(val); err == nil {
			return v
		}
	}
	return d
}
func getEnvDuration(key string, d time.Duration) time.Duration {
	if val, ok := os.LookupEnv(key); ok {
		if v, err := time.ParseDuration(val); err == nil {
			return v
		}
	}
	return d
}
