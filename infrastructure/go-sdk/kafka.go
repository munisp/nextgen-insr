package infra

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/IBM/sarama"
	"go.uber.org/zap"
)

type KafkaClient struct {
	producer sarama.SyncProducer
	logger   *zap.Logger
	brokers  []string
}

// Platform-wide Kafka topics
var PlatformTopics = []string{
	"kyc.verification.events",
	"kyc.gate.events",
	"kyc.risk.alerts",
	"kyb.verification.events",
	"policy.lifecycle",
	"claims.lifecycle",
	"payments.processed",
	"premium.collected",
	"agent.commission",
	"fraud.detection",
	"audit.trail",
	"compliance.events",
	"mojaloop.transfers",
	"notifications.outbound",
	"customer.onboarding",
	"underwriting.decisions",
}

// DeadLetterTopic returns the DLQ topic for a given topic.
func DeadLetterTopic(topic string) string {
	return topic + ".dlq"
}

func NewKafkaClient(logger *zap.Logger, brokers []string) *KafkaClient {
	c := &KafkaClient{logger: logger, brokers: brokers}

	config := sarama.NewConfig()
	config.Producer.RequiredAcks = sarama.WaitForAll
	config.Producer.Idempotent = true
	config.Producer.Return.Successes = true
	config.Producer.Retry.Max = 5
	config.Producer.Retry.Backoff = 100 * time.Millisecond
	config.Net.MaxOpenRequests = 1

	producer, err := sarama.NewSyncProducer(brokers, config)
	if err != nil {
		logger.Warn("kafka_producer_failed", zap.Error(err))
		return c
	}
	c.producer = producer
	logger.Info("kafka_producer_ready", zap.Strings("brokers", brokers))
	return c
}

func (c *KafkaClient) Ping(ctx context.Context) error {
	if c.producer == nil {
		return fmt.Errorf("kafka producer not initialized")
	}
	client, err := sarama.NewClient(c.brokers, sarama.NewConfig())
	if err != nil {
		return err
	}
	defer client.Close()
	_, err = client.Topics()
	return err
}

func (c *KafkaClient) Publish(ctx context.Context, topic string, key string, payload interface{}) error {
	if c.producer == nil {
		return fmt.Errorf("kafka producer not available")
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	msg := &sarama.ProducerMessage{
		Topic:     topic,
		Key:       sarama.StringEncoder(key),
		Value:     sarama.ByteEncoder(data),
		Timestamp: time.Now(),
		Headers: []sarama.RecordHeader{
			{Key: []byte("source"), Value: []byte("ngapp-platform")},
			{Key: []byte("version"), Value: []byte("1.0")},
		},
	}
	_, _, err = c.producer.SendMessage(msg)
	if err != nil {
		// Attempt DLQ on failure
		dlqMsg := &sarama.ProducerMessage{
			Topic: DeadLetterTopic(topic),
			Key:   sarama.StringEncoder(key),
			Value: sarama.ByteEncoder(data),
			Headers: []sarama.RecordHeader{
				{Key: []byte("original_topic"), Value: []byte(topic)},
				{Key: []byte("error"), Value: []byte(err.Error())},
			},
		}
		c.producer.SendMessage(dlqMsg)
		return fmt.Errorf("publish to %s: %w", topic, err)
	}
	return nil
}

func (c *KafkaClient) PublishBatch(ctx context.Context, topic string, messages []sarama.ProducerMessage) error {
	if c.producer == nil {
		return fmt.Errorf("kafka producer not available")
	}
	return c.producer.SendMessages(toPointers(messages))
}

func toPointers(msgs []sarama.ProducerMessage) []*sarama.ProducerMessage {
	ptrs := make([]*sarama.ProducerMessage, len(msgs))
	for i := range msgs {
		ptrs[i] = &msgs[i]
	}
	return ptrs
}

// PublishPolicyEvent publishes a policy lifecycle event.
func (c *KafkaClient) PublishPolicyEvent(ctx context.Context, policyID string, eventType string, data interface{}) error {
	return c.Publish(ctx, "policy.lifecycle", policyID, map[string]interface{}{
		"policy_id":  policyID,
		"event_type": eventType,
		"data":       data,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
	})
}

// PublishClaimEvent publishes a claims lifecycle event.
func (c *KafkaClient) PublishClaimEvent(ctx context.Context, claimID string, eventType string, data interface{}) error {
	return c.Publish(ctx, "claims.lifecycle", claimID, map[string]interface{}{
		"claim_id":   claimID,
		"event_type": eventType,
		"data":       data,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
	})
}

// PublishPaymentEvent publishes a payment event.
func (c *KafkaClient) PublishPaymentEvent(ctx context.Context, paymentID string, eventType string, data interface{}) error {
	return c.Publish(ctx, "payments.processed", paymentID, map[string]interface{}{
		"payment_id": paymentID,
		"event_type": eventType,
		"data":       data,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
	})
}

// PublishAuditEvent publishes an audit trail event.
func (c *KafkaClient) PublishAuditEvent(ctx context.Context, service string, action string, details interface{}) error {
	return c.Publish(ctx, "audit.trail", service, map[string]interface{}{
		"service":   service,
		"action":    action,
		"details":   details,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func (c *KafkaClient) Close() {
	if c.producer != nil {
		c.producer.Close()
	}
}
