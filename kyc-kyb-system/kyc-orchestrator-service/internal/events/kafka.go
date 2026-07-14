package events

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/IBM/sarama"
	"go.uber.org/zap"
)

type KYCEventType string

const (
	EventKYCStarted         KYCEventType = "kyc.started"
	EventKYCDocumentSubmit   KYCEventType = "kyc.document.submitted"
	EventKYCSelfieSubmit     KYCEventType = "kyc.selfie.submitted"
	EventKYCNINVerified      KYCEventType = "kyc.nin.verified"
	EventKYCBVNVerified      KYCEventType = "kyc.bvn.verified"
	EventKYCPhoneVerified    KYCEventType = "kyc.phone.verified"
	EventKYCLivenessChecked  KYCEventType = "kyc.liveness.checked"
	EventKYCAMLScreened      KYCEventType = "kyc.aml.screened"
	EventKYCApproved         KYCEventType = "kyc.approved"
	EventKYCRejected         KYCEventType = "kyc.rejected"
	EventKYCEscalated        KYCEventType = "kyc.escalated"
	EventKYCExpired          KYCEventType = "kyc.expired"
	EventKYBStarted          KYCEventType = "kyb.started"
	EventKYBCACVerified      KYCEventType = "kyb.cac.verified"
	EventKYBTINVerified      KYCEventType = "kyb.tin.verified"
	EventKYBApproved         KYCEventType = "kyb.approved"
	EventKYBRejected         KYCEventType = "kyb.rejected"
	EventKYCGateChecked      KYCEventType = "kyc.gate.checked"
	EventKYCRiskAssessed     KYCEventType = "kyc.risk.assessed"
)

type KYCEvent struct {
	ID        string            `json:"id"`
	Type      KYCEventType      `json:"type"`
	SessionID string            `json:"session_id"`
	UserID    string            `json:"user_id"`
	Timestamp time.Time         `json:"timestamp"`
	Data      map[string]interface{} `json:"data"`
	Source    string            `json:"source"`
	Version   string            `json:"version"`
}

const (
	TopicKYCEvents     = "kyc.events"
	TopicKYBEvents     = "kyb.events"
	TopicKYCAudit      = "kyc.audit"
	TopicKYCGate       = "kyc.gate"
	TopicKYCCompliance = "kyc.compliance"
)

type KafkaProducer struct {
	producer sarama.SyncProducer
	logger   *zap.Logger
}

func NewKafkaProducer(logger *zap.Logger, brokers []string) (*KafkaProducer, error) {
	if len(brokers) == 0 {
		brokers = []string{"localhost:9092"}
	}

	config := sarama.NewConfig()
	config.Producer.RequiredAcks = sarama.WaitForAll
	config.Producer.Retry.Max = 5
	config.Producer.Return.Successes = true
	config.Producer.Idempotent = true
	config.Net.MaxOpenRequests = 1
	config.Version = sarama.V3_0_0_0

	producer, err := sarama.NewSyncProducer(brokers, config)
	if err != nil {
		logger.Warn("kafka_producer_init_failed", zap.Error(err))
		return &KafkaProducer{producer: nil, logger: logger}, nil
	}

	return &KafkaProducer{producer: producer, logger: logger}, nil
}

func (p *KafkaProducer) PublishKYCEvent(ctx context.Context, event KYCEvent) error {
	if p.producer == nil {
		p.logger.Debug("kafka_not_available_skipping_publish", zap.String("event_type", string(event.Type)))
		return nil
	}

	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal kyc event: %w", err)
	}

	topic := TopicKYCEvents
	if event.Type >= EventKYBStarted && event.Type <= EventKYBRejected {
		topic = TopicKYBEvents
	}

	msg := &sarama.ProducerMessage{
		Topic:     topic,
		Key:       sarama.StringEncoder(event.SessionID),
		Value:     sarama.ByteEncoder(data),
		Timestamp: event.Timestamp,
		Headers: []sarama.RecordHeader{
			{Key: []byte("event_type"), Value: []byte(event.Type)},
			{Key: []byte("source"), Value: []byte("kyc-orchestrator")},
			{Key: []byte("version"), Value: []byte("1.0")},
		},
	}

	partition, offset, err := p.producer.SendMessage(msg)
	if err != nil {
		p.logger.Error("kafka_publish_failed", zap.Error(err), zap.String("topic", topic))
		return err
	}

	p.logger.Info("kafka_event_published",
		zap.String("topic", topic),
		zap.Int32("partition", partition),
		zap.Int64("offset", offset),
		zap.String("event_type", string(event.Type)),
		zap.String("session_id", event.SessionID),
	)
	return nil
}

func (p *KafkaProducer) PublishAuditEvent(ctx context.Context, sessionID, action, actor string, data map[string]interface{}) error {
	if p.producer == nil {
		return nil
	}

	event := map[string]interface{}{
		"session_id": sessionID,
		"action":     action,
		"actor":      actor,
		"data":       data,
		"timestamp":  time.Now().UTC(),
	}

	payload, _ := json.Marshal(event)
	msg := &sarama.ProducerMessage{
		Topic: TopicKYCAudit,
		Key:   sarama.StringEncoder(sessionID),
		Value: sarama.ByteEncoder(payload),
	}

	_, _, err := p.producer.SendMessage(msg)
	return err
}

func (p *KafkaProducer) PublishGateEvent(ctx context.Context, userID string, allowed bool, reason string) error {
	if p.producer == nil {
		return nil
	}

	event := map[string]interface{}{
		"user_id":   userID,
		"allowed":   allowed,
		"reason":    reason,
		"timestamp": time.Now().UTC(),
	}

	payload, _ := json.Marshal(event)
	msg := &sarama.ProducerMessage{
		Topic: TopicKYCGate,
		Key:   sarama.StringEncoder(userID),
		Value: sarama.ByteEncoder(payload),
	}

	_, _, err := p.producer.SendMessage(msg)
	return err
}

func (p *KafkaProducer) Close() error {
	if p.producer != nil {
		return p.producer.Close()
	}
	return nil
}

type KafkaConsumer struct {
	group  sarama.ConsumerGroup
	logger *zap.Logger
}

func NewKafkaConsumer(logger *zap.Logger, brokers []string, groupID string) (*KafkaConsumer, error) {
	if len(brokers) == 0 {
		brokers = []string{"localhost:9092"}
	}

	config := sarama.NewConfig()
	config.Consumer.Group.Rebalance.GroupStrategies = []sarama.BalanceStrategy{sarama.NewBalanceStrategyRoundRobin()}
	config.Consumer.Offsets.Initial = sarama.OffsetNewest
	config.Version = sarama.V3_0_0_0

	group, err := sarama.NewConsumerGroup(brokers, groupID, config)
	if err != nil {
		logger.Warn("kafka_consumer_init_failed", zap.Error(err))
		return &KafkaConsumer{group: nil, logger: logger}, nil
	}

	return &KafkaConsumer{group: group, logger: logger}, nil
}

func (c *KafkaConsumer) Consume(ctx context.Context, topics []string, handler func(event KYCEvent) error) error {
	if c.group == nil {
		return nil
	}

	h := &consumerGroupHandler{handler: handler, logger: c.logger}

	for {
		if err := c.group.Consume(ctx, topics, h); err != nil {
			c.logger.Error("kafka_consume_error", zap.Error(err))
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
}

func (c *KafkaConsumer) Close() error {
	if c.group != nil {
		return c.group.Close()
	}
	return nil
}

type consumerGroupHandler struct {
	handler func(event KYCEvent) error
	logger  *zap.Logger
}

func (h *consumerGroupHandler) Setup(_ sarama.ConsumerGroupSession) error   { return nil }
func (h *consumerGroupHandler) Cleanup(_ sarama.ConsumerGroupSession) error { return nil }

func (h *consumerGroupHandler) ConsumeClaim(session sarama.ConsumerGroupSession, claim sarama.ConsumerGroupClaim) error {
	for msg := range claim.Messages() {
		var event KYCEvent
		if err := json.Unmarshal(msg.Value, &event); err != nil {
			h.logger.Error("kafka_unmarshal_error", zap.Error(err))
			session.MarkMessage(msg, "")
			continue
		}

		if err := h.handler(event); err != nil {
			h.logger.Error("kafka_handler_error", zap.Error(err), zap.String("event_type", string(event.Type)))
		}

		session.MarkMessage(msg, "")
	}
	return nil
}
