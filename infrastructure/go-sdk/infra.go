// Package infra provides a unified infrastructure client for all 12 platform components.
// It handles connection management, health checks, retries, and circuit breaking.
package infra

import (
	"context"
	"fmt"
	"strconv"
	"sync"
	"time"

	"go.uber.org/zap"
)

// ComponentStatus tracks the health of an infrastructure component.
type ComponentStatus struct {
	Name      string `json:"name"`
	Connected bool   `json:"connected"`
	Latency   string `json:"latency,omitempty"`
	Error     string `json:"error,omitempty"`
}

// Config holds connection strings for all infrastructure components.
type Config struct {
	PostgresURL       string
	RedisAddr         string
	KafkaBrokers      []string
	TigerBeetleAddr   string
	MojaloopURL       string
	APISixAdminURL    string
	KeycloakRealmURL  string
	KeycloakClientID  string
	KeycloakSecret    string
	KeycloakAdminURL  string
	OpenAppSecURL     string
	PermifyURL        string
	PermifyTenant     string
	OpenSearchURL     string
	FluvioEndpoint    string
	DaprHTTPPort      string
	DaprGRPCPort      string
}

// DefaultConfig returns a Config with sensible local defaults.
func DefaultConfig() Config {
	return Config{
		PostgresURL:      "postgres://localhost:5432/ngapp?sslmode=disable",
		RedisAddr:        "localhost:6379",
		KafkaBrokers:     []string{"localhost:9092"},
		TigerBeetleAddr:  "localhost:3000",
		MojaloopURL:      "http://localhost:4000",
		APISixAdminURL:   "http://localhost:9180",
		KeycloakRealmURL: "http://localhost:8180/realms/insurance",
		KeycloakClientID: "ngapp-service",
		KeycloakAdminURL: "http://localhost:8180",
		OpenAppSecURL:    "http://localhost:9180",
		PermifyURL:       "http://localhost:3476",
		PermifyTenant:    "insurance-platform",
		OpenSearchURL:    "http://localhost:9200",
		FluvioEndpoint:   "localhost:9003",
		DaprHTTPPort:     "3500",
		DaprGRPCPort:     "50001",
	}
}

// Platform is the top-level infrastructure manager that holds all component clients.
type Platform struct {
	Logger      *zap.Logger
	Config      Config
	Postgres    *PostgresClient
	Redis       *RedisClient
	Kafka       *KafkaClient
	TigerBeetle *TigerBeetleClient
	Mojaloop    *MojaloopClient
	APISix      *APISixClient
	Keycloak    *KeycloakClient
	OpenAppSec  *OpenAppSecClient
	Permify     *PermifyClient
	OpenSearch  *OpenSearchClient
	Fluvio      *FluvioClient
	Dapr        *DaprClient
	mu          sync.Mutex
}

// NewPlatform creates and initializes all infrastructure clients.
func NewPlatform(logger *zap.Logger, cfg Config) *Platform {
	p := &Platform{
		Logger: logger,
		Config: cfg,
	}

	p.Postgres = NewPostgresClient(logger, cfg.PostgresURL)
	p.Redis = NewRedisClient(logger, cfg.RedisAddr)
	p.Kafka = NewKafkaClient(logger, cfg.KafkaBrokers)
	p.TigerBeetle = NewTigerBeetleClient(logger, cfg.TigerBeetleAddr)
	p.Mojaloop = NewMojaloopClient(logger, cfg.MojaloopURL)
	p.APISix = NewAPISixClient(logger, cfg.APISixAdminURL)
	p.Keycloak = NewKeycloakClient(logger, cfg.KeycloakRealmURL, cfg.KeycloakClientID, cfg.KeycloakSecret, cfg.KeycloakAdminURL)
	p.OpenAppSec = NewOpenAppSecClient(logger, cfg.OpenAppSecURL)
	p.Permify = NewPermifyClient(logger, cfg.PermifyURL, cfg.PermifyTenant)
	p.OpenSearch = NewOpenSearchClient(logger, cfg.OpenSearchURL)
	p.Fluvio = NewFluvioClient(logger, cfg.FluvioEndpoint)
	daprPort, _ := strconv.Atoi(cfg.DaprHTTPPort)
	if daprPort == 0 {
		daprPort = 3500
	}
	p.Dapr = NewDaprClient(logger, daprPort)

	return p
}

// HealthCheck returns the status of all 12 infrastructure components.
func (p *Platform) HealthCheck(ctx context.Context) map[string]ComponentStatus {
	results := make(map[string]ComponentStatus)
	var wg sync.WaitGroup
	var mu sync.Mutex

	checks := []struct {
		name string
		fn   func(context.Context) error
	}{
		{"postgres", p.Postgres.Ping},
		{"redis", p.Redis.Ping},
		{"kafka", p.Kafka.Ping},
		{"tigerbeetle", p.TigerBeetle.Ping},
		{"mojaloop", p.Mojaloop.Ping},
		{"apisix", p.APISix.Ping},
		{"keycloak", p.Keycloak.Ping},
		{"openappsec", p.OpenAppSec.Ping},
		{"permify", p.Permify.Ping},
		{"opensearch", p.OpenSearch.Ping},
		{"fluvio", p.Fluvio.Ping},
		{"dapr", p.Dapr.Ping},
	}

	for _, c := range checks {
		wg.Add(1)
		go func(name string, fn func(context.Context) error) {
			defer wg.Done()
			start := time.Now()
			err := fn(ctx)
			latency := time.Since(start)

			status := ComponentStatus{
				Name:      name,
				Connected: err == nil,
				Latency:   fmt.Sprintf("%dms", latency.Milliseconds()),
			}
			if err != nil {
				status.Error = err.Error()
			}

			mu.Lock()
			results[name] = status
			mu.Unlock()
		}(c.name, c.fn)
	}

	wg.Wait()
	return results
}

// Close gracefully shuts down all infrastructure connections.
func (p *Platform) Close() {
	if p.Postgres != nil {
		p.Postgres.Close()
	}
	if p.Redis != nil {
		p.Redis.Close()
	}
	if p.Kafka != nil {
		p.Kafka.Close()
	}
	if p.OpenSearch != nil {
		p.OpenSearch.Close()
	}
}
