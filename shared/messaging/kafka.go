package messaging

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/segmentio/kafka-go"
)

type KafkaConfig struct {
	Brokers []string
	GroupID string
}

func KafkaConfigFromEnv() KafkaConfig {
	broker := os.Getenv("KAFKA_BROKERS")
	if broker == "" {
		log.Fatal("FATAL: KAFKA_BROKERS environment variable is required")
	}
	return KafkaConfig{
		Brokers: []string{broker},
		GroupID: os.Getenv("KAFKA_GROUP_ID"),
	}
}

type Producer struct {
	writer *kafka.Writer
}

func NewProducer(cfg KafkaConfig, topic string) *Producer {
	w := &kafka.Writer{
		Addr:         kafka.TCP(cfg.Brokers...),
		Topic:        topic,
		Balancer:     &kafka.LeastBytes{},
		BatchTimeout: 10 * time.Millisecond,
		RequiredAcks: kafka.RequireOne,
	}
	log.Printf("[kafka] producer created for topic %s -> %v", topic, cfg.Brokers)
	return &Producer{writer: w}
}

func (p *Producer) Publish(ctx context.Context, key string, event interface{}) error {
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}
	return p.writer.WriteMessages(ctx, kafka.Message{
		Key:   []byte(key),
		Value: data,
		Time:  time.Now(),
	})
}

func (p *Producer) Close() error {
	return p.writer.Close()
}

type Consumer struct {
	reader *kafka.Reader
}

func NewConsumer(cfg KafkaConfig, topic string) *Consumer {
	r := kafka.NewReader(kafka.ReaderConfig{
		Brokers:  cfg.Brokers,
		Topic:    topic,
		GroupID:  cfg.GroupID,
		MinBytes: 1,
		MaxBytes: 10e6,
	})
	log.Printf("[kafka] consumer created for topic %s group %s", topic, cfg.GroupID)
	return &Consumer{reader: r}
}

func (c *Consumer) Read(ctx context.Context) (kafka.Message, error) {
	return c.reader.ReadMessage(ctx)
}

func (c *Consumer) Close() error {
	return c.reader.Close()
}
