package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/segmentio/kafka-go"
	"database/sql"

	_ "github.com/lib/pq"
)

// FluvioNativeClient wraps the Fluvio HTTP API (SmartModule-capable)
// to replace unsafe exec.Command("fluvio", ...) shelling.
// Uses the Fluvio Cloud HTTP producer/consumer API.
type FluvioNativeClient struct {
	endpoint   string
	httpClient *http.Client
}

func NewFluvioNativeClient(endpoint string) *FluvioNativeClient {
	return &FluvioNativeClient{
		endpoint: endpoint,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (f *FluvioNativeClient) Produce(ctx context.Context, topic string, data []byte) error {
	url := fmt.Sprintf("%s/api/v1/topics/%s/produce", f.endpoint, topic)
	req, err := http.NewRequestWithContext(ctx, "POST", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create produce request: %w", err)
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Body = http.NoBody

	// Build the proper body
	body := make([]byte, len(data))
	copy(body, data)
	req.Body = nopCloser{reader: body}
	req.ContentLength = int64(len(body))

	resp, err := f.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("fluvio produce failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("fluvio produce returned status %d", resp.StatusCode)
	}
	return nil
}

func (f *FluvioNativeClient) Consume(ctx context.Context, topic string, offset int64) (<-chan []byte, error) {
	ch := make(chan []byte, 100)

	go func() {
		defer close(ch)

		url := fmt.Sprintf("%s/api/v1/topics/%s/consume?offset=%d", f.endpoint, topic, offset)
		req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
		if err != nil {
			log.Printf("[Fluvio] Failed to create consume request: %v", err)
			return
		}
		req.Header.Set("Accept", "application/json")

		resp, err := f.httpClient.Do(req)
		if err != nil {
			log.Printf("[Fluvio] Consume connection failed: %v", err)
			return
		}
		defer resp.Body.Close()

		decoder := json.NewDecoder(resp.Body)
		for {
			select {
			case <-ctx.Done():
				return
			default:
				var record map[string]interface{}
				if err := decoder.Decode(&record); err != nil {
					return
				}
				if value, ok := record["value"].(string); ok {
					ch <- []byte(value)
				}
			}
		}
	}()

	return ch, nil
}

// nopCloser wraps a byte slice as io.ReadCloser
type nopCloser struct {
	reader []byte
	pos    int
}

func (n nopCloser) Read(p []byte) (int, error) {
	if n.pos >= len(n.reader) {
		return 0, fmt.Errorf("EOF")
	}
	copied := copy(p, n.reader[n.pos:])
	n.pos += copied
	return copied, nil
}

func (n nopCloser) Close() error { return nil }

type FluvioKafkaBridge struct {
	kafkaReaders   map[string]*kafka.Reader
	kafkaWriters   map[string]*kafka.Writer
	fluvioClient   *FluvioNativeClient
	fluvioTopics   map[string]string
	wg             sync.WaitGroup
	ctx            context.Context
	cancel         context.CancelFunc
	mu             sync.RWMutex
}

type BridgeConfig struct {
	KafkaBrokers   string
	FluvioEndpoint string
	TopicMappings  map[string]string
}

func NewFluvioKafkaBridge(config BridgeConfig) *FluvioKafkaBridge {
	ctx, cancel := context.WithCancel(context.Background())

	return &FluvioKafkaBridge{
		kafkaReaders:  make(map[string]*kafka.Reader),
		kafkaWriters:  make(map[string]*kafka.Writer),
		fluvioClient:  NewFluvioNativeClient(config.FluvioEndpoint),
		fluvioTopics:  config.TopicMappings,
		ctx:           ctx,
		cancel:        cancel,
	}
}

func (b *FluvioKafkaBridge) Start(config BridgeConfig) error {
	for kafkaTopic, fluvioTopic := range config.TopicMappings {
		if err := b.setupKafkaToFluvioBridge(kafkaTopic, fluvioTopic, config.KafkaBrokers); err != nil {
			return fmt.Errorf("failed to setup Kafka->Fluvio bridge for %s: %w", kafkaTopic, err)
		}

		if err := b.setupFluvioToKafkaBridge(fluvioTopic, kafkaTopic, config.KafkaBrokers); err != nil {
			return fmt.Errorf("failed to setup Fluvio->Kafka bridge for %s: %w", fluvioTopic, err)
		}
	}

	log.Println("Fluvio-Kafka Bridge started successfully")
	return nil
}

func (b *FluvioKafkaBridge) setupKafkaToFluvioBridge(kafkaTopic, fluvioTopic, brokers string) error {
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:        []string{brokers},
		Topic:          kafkaTopic,
		GroupID:        fmt.Sprintf("fluvio-bridge-%s", kafkaTopic),
		MinBytes:       1,
		MaxBytes:       10e6,
		CommitInterval: time.Second,
		StartOffset:    kafka.LastOffset,
	})

	b.mu.Lock()
	b.kafkaReaders[kafkaTopic] = reader
	b.mu.Unlock()

	b.wg.Add(1)
	go b.consumeKafkaToFluvio(kafkaTopic, fluvioTopic, reader)

	log.Printf("Setup Kafka->Fluvio bridge: %s -> %s", kafkaTopic, fluvioTopic)
	return nil
}

func (b *FluvioKafkaBridge) setupFluvioToKafkaBridge(fluvioTopic, kafkaTopic, brokers string) error {
	writer := &kafka.Writer{
		Addr:         kafka.TCP(brokers),
		Topic:        kafkaTopic,
		Balancer:     &kafka.Hash{},
		RequiredAcks: kafka.RequireAll,
		Compression:  kafka.Snappy,
		BatchSize:    100,
		BatchTimeout: 10 * time.Millisecond,
	}

	b.mu.Lock()
	b.kafkaWriters[kafkaTopic] = writer
	b.mu.Unlock()

	b.wg.Add(1)
	go b.consumeFluvioToKafka(fluvioTopic, kafkaTopic, writer)

	log.Printf("Setup Fluvio->Kafka bridge: %s -> %s", fluvioTopic, kafkaTopic)
	return nil
}

func (b *FluvioKafkaBridge) consumeKafkaToFluvio(kafkaTopic, fluvioTopic string, reader *kafka.Reader) {
	defer b.wg.Done()

	for {
		select {
		case <-b.ctx.Done():
			return
		default:
			msg, err := reader.ReadMessage(b.ctx)
			if err != nil {
				if err == context.Canceled {
					return
				}
				log.Printf("Error reading from Kafka topic %s: %v", kafkaTopic, err)
				continue
			}

			if err := b.fluvioClient.Produce(b.ctx, fluvioTopic, msg.Value); err != nil {
				log.Printf("Failed to publish to Fluvio topic %s: %v", fluvioTopic, err)
			}
		}
	}
}

func (b *FluvioKafkaBridge) consumeFluvioToKafka(fluvioTopic, kafkaTopic string, writer *kafka.Writer) {
	defer b.wg.Done()

	// Use native HTTP client instead of exec.Command("fluvio", ...)
	ch, err := b.fluvioClient.Consume(b.ctx, fluvioTopic, -1)
	if err != nil {
		log.Printf("Failed to start Fluvio native consumer for %s: %v", fluvioTopic, err)
		return
	}

	for {
		select {
		case <-b.ctx.Done():
			return
		case data, ok := <-ch:
			if !ok {
				log.Printf("[Fluvio] Consumer channel closed for topic %s, reconnecting...", fluvioTopic)
				time.Sleep(2 * time.Second)
				ch, err = b.fluvioClient.Consume(b.ctx, fluvioTopic, -1)
				if err != nil {
					log.Printf("[Fluvio] Reconnect failed for %s: %v", fluvioTopic, err)
					return
				}
				continue
			}

			msg := kafka.Message{
				Value: data,
				Time:  time.Now(),
			}

			if err := writer.WriteMessages(b.ctx, msg); err != nil {
				log.Printf("Failed to write to Kafka topic %s: %v", kafkaTopic, err)
			}
		}
	}
}

func (b *FluvioKafkaBridge) Stop() error {
	log.Println("Shutting down Fluvio-Kafka Bridge...")

	b.cancel()

	b.mu.RLock()
	for _, reader := range b.kafkaReaders {
		if err := reader.Close(); err != nil {
			log.Printf("Error closing Kafka reader: %v", err)
		}
	}

	for _, writer := range b.kafkaWriters {
		if err := writer.Close(); err != nil {
			log.Printf("Error closing Kafka writer: %v", err)
		}
	}
	b.mu.RUnlock()

	b.wg.Wait()
	log.Println("Fluvio-Kafka Bridge stopped")
	return nil
}

var db *sql.DB

func initDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgresql://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Printf("WARN: database connection failed: %v (running in degraded mode)", err)
		return
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	if err = db.Ping(); err != nil {
		log.Printf("WARN: database ping failed: %v (running in degraded mode)", err)
		db = nil
		return
	}
	log.Printf("Connected to PostgreSQL for fluvio_integration")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS fluvio_integration (
		id SERIAL PRIMARY KEY,
		data JSONB NOT NULL DEFAULT '{}',
		status VARCHAR(50) DEFAULT 'active',
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW(),
		tenant_id INTEGER DEFAULT 1
	)`)
	if err != nil {
		log.Printf("WARN: table creation failed: %v", err)
	}
}


func main() {
	initDB()
	if db != nil {
		defer db.Close()
	}
	config := BridgeConfig{
		KafkaBrokers:   getEnv("KAFKA_BROKERS", "kafka-0.kafka-headless:9092"),
		FluvioEndpoint: getEnv("FLUVIO_ENDPOINT", "fluvio-sc:9003"),
		TopicMappings: map[string]string{
			"fraud-detection-events":     "fraud-detection-realtime",
			"analytics-events":           "analytics-realtime",
			"geospatial-events":          "geospatial-events",
			"ml-predictions":             "ml-predictions-realtime",
			"policy-events":              "policy-events-stream",
			"claim-events":               "claim-events-stream",
			"payment-events":             "payment-events-stream",
		},
	}

	bridge := NewFluvioKafkaBridge(config)

	if err := bridge.Start(config); err != nil {
		log.Fatalf("Failed to start bridge: %v", err)
	}

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	if err := bridge.Stop(); err != nil {
		log.Fatalf("Failed to stop bridge: %v", err)
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
