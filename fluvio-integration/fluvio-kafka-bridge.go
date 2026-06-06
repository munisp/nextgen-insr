package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/segmentio/kafka-go"
	"database/sql"

	_ "github.com/lib/pq"
)

type FluvioKafkaBridge struct {
	kafkaReaders  map[string]*kafka.Reader
	kafkaWriters  map[string]*kafka.Writer
	fluvioTopics  map[string]string
	wg            sync.WaitGroup
	ctx           context.Context
	cancel        context.CancelFunc
	mu            sync.RWMutex
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

			if err := b.publishToFluvio(fluvioTopic, msg.Value); err != nil {
				log.Printf("Failed to publish to Fluvio topic %s: %v", fluvioTopic, err)
			}
		}
	}
}

func (b *FluvioKafkaBridge) consumeFluvioToKafka(fluvioTopic, kafkaTopic string, writer *kafka.Writer) {
	defer b.wg.Done()

	cmd := exec.CommandContext(b.ctx, "fluvio", "consume", fluvioTopic, "--output", "json", "-B")
	
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Printf("Failed to create stdout pipe for Fluvio consumer: %v", err)
		return
	}

	if err := cmd.Start(); err != nil {
		log.Printf("Failed to start Fluvio consumer: %v", err)
		return
	}

	decoder := json.NewDecoder(stdout)
	
	for {
		select {
		case <-b.ctx.Done():
			cmd.Process.Kill()
			return
		default:
			var record map[string]interface{}
			if err := decoder.Decode(&record); err != nil {
				continue
			}

			value, ok := record["value"].(string)
			if !ok {
				continue
			}

			msg := kafka.Message{
				Value: []byte(value),
				Time:  time.Now(),
			}

			if err := writer.WriteMessages(b.ctx, msg); err != nil {
				log.Printf("Failed to write to Kafka topic %s: %v", kafkaTopic, err)
			}
		}
	}
}

func (b *FluvioKafkaBridge) publishToFluvio(topic string, data []byte) error {
	cmd := exec.CommandContext(b.ctx, "fluvio", "produce", topic)
	
	cmd.Stdin = bytes.NewReader(data)
	
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("fluvio produce failed: %w, output: %s", err, string(output))
	}

	return nil
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
