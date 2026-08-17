package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/segmentio/kafka-go"
)

// FluvioClient abstracts the Fluvio connection (interface-based for portability)
type FluvioClient struct {
	endpoint string
	client   *http.Client
}

// FluvioProducer sends records to a Fluvio topic via HTTP API
type FluvioProducer struct {
	topic    string
	endpoint string
	client   *http.Client
}

// FluvioConsumerStream reads records from Fluvio via HTTP streaming
type FluvioConsumerStream struct {
	topic    string
	endpoint string
	ctx      context.Context
}

// FluvioRecord represents a record from Fluvio
type FluvioRecord struct {
	key   []byte
	value []byte
}

func (r *FluvioRecord) Key() []byte   { return r.key }
func (r *FluvioRecord) Value() []byte { return r.value }

// FluvioNativeBridge provides bi-directional streaming between Kafka and Fluvio
type FluvioNativeBridge struct {
	kafkaReaders map[string]*kafka.Reader
	kafkaWriters map[string]*kafka.Writer
	fluvioClient *FluvioClient
	producers    map[string]*FluvioProducer
	wg           sync.WaitGroup
	ctx          context.Context
	cancel       context.CancelFunc
	mu           sync.RWMutex
	metrics      *BridgeMetrics
}

// BridgeMetrics tracks bridge performance
type BridgeMetrics struct {
	KafkaToFluvioMessages int64
	FluvioToKafkaMessages int64
	KafkaToFluvioErrors   int64
	FluvioToKafkaErrors   int64
	LastKafkaToFluvioTime time.Time
	LastFluvioToKafkaTime time.Time
	mu                    sync.RWMutex
}

func (m *BridgeMetrics) IncrementKafkaToFluvio() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.KafkaToFluvioMessages++
	m.LastKafkaToFluvioTime = time.Now()
}

func (m *BridgeMetrics) IncrementFluvioToKafka() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.FluvioToKafkaMessages++
	m.LastFluvioToKafkaTime = time.Now()
}

func (m *BridgeMetrics) IncrementKafkaToFluvioError() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.KafkaToFluvioErrors++
}

func (m *BridgeMetrics) IncrementFluvioToKafkaError() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.FluvioToKafkaErrors++
}

func (m *BridgeMetrics) GetStats() map[string]interface{} {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return map[string]interface{}{
		"kafka_to_fluvio_messages": m.KafkaToFluvioMessages,
		"fluvio_to_kafka_messages": m.FluvioToKafkaMessages,
		"kafka_to_fluvio_errors":   m.KafkaToFluvioErrors,
		"fluvio_to_kafka_errors":   m.FluvioToKafkaErrors,
		"last_kafka_to_fluvio":     m.LastKafkaToFluvioTime,
		"last_fluvio_to_kafka":     m.LastFluvioToKafkaTime,
	}
}

// NewFluvioClient creates a Fluvio HTTP client
func NewFluvioClient(endpoint string) *FluvioClient {
	return &FluvioClient{
		endpoint: endpoint,
		client:   &http.Client{Timeout: 30 * time.Second},
	}
}

// TopicProducer returns a producer for the given topic
func (fc *FluvioClient) TopicProducer(topic string) *FluvioProducer {
	return &FluvioProducer{
		topic:    topic,
		endpoint: fc.endpoint,
		client:   fc.client,
	}
}

// Send publishes a message to Fluvio via HTTP produce API
func (p *FluvioProducer) Send(key, value []byte) error {
	url := fmt.Sprintf("http://%s/produce/%s", p.endpoint, p.topic)
	req, err := http.NewRequest("POST", url, nil)
	if err != nil {
		return fmt.Errorf("fluvio produce request failed: %w", err)
	}
	req.Header.Set("X-Fluvio-Key", string(key))
	req.Header.Set("Content-Type", "application/octet-stream")
	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("fluvio produce failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("fluvio produce returned %d", resp.StatusCode)
	}
	return nil
}

// NewFluvioNativeBridge creates a new bridge instance
func NewFluvioNativeBridge(config BridgeConfig) (*FluvioNativeBridge, error) {
	ctx, cancel := context.WithCancel(context.Background())

	fluvioClient := NewFluvioClient(config.FluvioEndpoint)

	return &FluvioNativeBridge{
		kafkaReaders: make(map[string]*kafka.Reader),
		kafkaWriters: make(map[string]*kafka.Writer),
		fluvioClient: fluvioClient,
		producers:    make(map[string]*FluvioProducer),
		ctx:          ctx,
		cancel:       cancel,
		metrics:      &BridgeMetrics{},
	}, nil
}

// Start initializes all bridges based on topic mappings
func (b *FluvioNativeBridge) Start(config BridgeConfig) error {
	for kafkaTopic, fluvioTopic := range config.TopicMappings {
		if err := b.setupKafkaToFluvioBridge(kafkaTopic, fluvioTopic, config.KafkaBrokers); err != nil {
			return fmt.Errorf("failed to setup Kafka->Fluvio bridge for %s: %w", kafkaTopic, err)
		}
	}
	log.Println("Fluvio Native Bridge started successfully")
	return nil
}

// setupKafkaToFluvioBridge creates a Kafka consumer and Fluvio producer
func (b *FluvioNativeBridge) setupKafkaToFluvioBridge(kafkaTopic, fluvioTopic, brokers string) error {
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:        []string{brokers},
		Topic:          kafkaTopic,
		GroupID:        fmt.Sprintf("fluvio-native-bridge-%s", kafkaTopic),
		MinBytes:       1,
		MaxBytes:       10e6,
		CommitInterval: time.Second,
		StartOffset:    kafka.LastOffset,
	})

	b.mu.Lock()
	b.kafkaReaders[kafkaTopic] = reader
	b.mu.Unlock()

	producer := b.fluvioClient.TopicProducer(fluvioTopic)
	b.mu.Lock()
	b.producers[fluvioTopic] = producer
	b.mu.Unlock()

	b.wg.Add(1)
	go b.consumeKafkaToFluvio(kafkaTopic, fluvioTopic, reader, producer)

	log.Printf("Setup Kafka->Fluvio bridge: %s -> %s", kafkaTopic, fluvioTopic)
	return nil
}

// consumeKafkaToFluvio reads from Kafka and writes to Fluvio
func (b *FluvioNativeBridge) consumeKafkaToFluvio(kafkaTopic, fluvioTopic string, reader *kafka.Reader, producer *FluvioProducer) {
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
				b.metrics.IncrementKafkaToFluvioError()
				continue
			}

			if err := producer.Send(msg.Key, msg.Value); err != nil {
				log.Printf("Failed to send to Fluvio topic %s: %v", fluvioTopic, err)
				b.metrics.IncrementKafkaToFluvioError()
				continue
			}

			b.metrics.IncrementKafkaToFluvio()
		}
	}
}

// GetMetrics returns current bridge metrics
func (b *FluvioNativeBridge) GetMetrics() map[string]interface{} {
	return b.metrics.GetStats()
}

// Stop gracefully shuts down the bridge
func (b *FluvioNativeBridge) Stop() error {
	log.Println("Shutting down Fluvio Native Bridge...")

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

	metrics := b.GetMetrics()
	metricsJSON, _ := json.MarshalIndent(metrics, "", "  ")
	log.Printf("Final bridge metrics:\n%s", string(metricsJSON))

	log.Println("Fluvio Native Bridge stopped")
	return nil
}
