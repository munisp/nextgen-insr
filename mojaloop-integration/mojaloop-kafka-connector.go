package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/segmentio/kafka-go"
	"database/sql"

	_ "github.com/lib/pq"
)

type MojaloopKafkaConnector struct {
	paymentEventsReader  *kafka.Reader
	mojaloopEventsWriter *kafka.Writer
	mojaloopEventsReader *kafka.Reader
	paymentEventsWriter  *kafka.Writer
	wg                   sync.WaitGroup
	ctx                  context.Context
	cancel               context.CancelFunc
}

type PaymentEvent struct {
	EventType       string    `json:"event_type"`
	PaymentID       uuid.UUID `json:"payment_id"`
	CustomerID      uuid.UUID `json:"customer_id"`
	PolicyID        uuid.UUID `json:"policy_id"`
	Amount          string    `json:"amount"`
	Currency        string    `json:"currency"`
	Status          string    `json:"status"`
	PaymentMethod   string    `json:"payment_method"`
	Timestamp       time.Time `json:"timestamp"`
}

type MojaloopEvent struct {
	EventType         string    `json:"event_type"`
	TransferID        string    `json:"transfer_id"`
	QuoteID           string    `json:"quote_id"`
	PaymentID         uuid.UUID `json:"payment_id"`
	TransferState     string    `json:"transfer_state"`
	Amount            string    `json:"amount"`
	Currency          string    `json:"currency"`
	PayerFSP          string    `json:"payer_fsp"`
	PayeeFSP          string    `json:"payee_fsp"`
	ILPPacket         string    `json:"ilp_packet"`
	Condition         string    `json:"condition"`
	Fulfilment        string    `json:"fulfilment"`
	ErrorCode         string    `json:"error_code"`
	ErrorDescription  string    `json:"error_description"`
	Timestamp         time.Time `json:"timestamp"`
}

func NewMojaloopKafkaConnector(kafkaBrokers string) *MojaloopKafkaConnector {
	ctx, cancel := context.WithCancel(context.Background())

	brokerList := []string{kafkaBrokers}

	paymentEventsReader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:        brokerList,
		Topic:          "payments.created",
		GroupID:        "mojaloop-connector-payment-events",
		MinBytes:       1,
		MaxBytes:       10e6,
		CommitInterval: time.Second,
		StartOffset:    kafka.LastOffset,
	})

	mojaloopEventsWriter := &kafka.Writer{
		Addr:         kafka.TCP(kafkaBrokers),
		Topic:        "payments.mojaloop.events",
		Balancer:     &kafka.Hash{},
		RequiredAcks: kafka.RequireAll,
		Compression:  kafka.Snappy,
		BatchSize:    100,
		BatchTimeout: 10 * time.Millisecond,
	}

	mojaloopEventsReader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:        brokerList,
		Topic:          "mojaloop.transfers.events",
		GroupID:        "mojaloop-connector-mojaloop-events",
		MinBytes:       1,
		MaxBytes:       10e6,
		CommitInterval: time.Second,
		StartOffset:    kafka.LastOffset,
	})

	paymentEventsWriter := &kafka.Writer{
		Addr:         kafka.TCP(kafkaBrokers),
		Topic:        "payments.status.updates",
		Balancer:     &kafka.Hash{},
		RequiredAcks: kafka.RequireAll,
		Compression:  kafka.Snappy,
		BatchSize:    100,
		BatchTimeout: 10 * time.Millisecond,
	}

	return &MojaloopKafkaConnector{
		paymentEventsReader:  paymentEventsReader,
		mojaloopEventsWriter: mojaloopEventsWriter,
		mojaloopEventsReader: mojaloopEventsReader,
		paymentEventsWriter:  paymentEventsWriter,
		ctx:                  ctx,
		cancel:               cancel,
	}
}

func (c *MojaloopKafkaConnector) Start() error {
	c.wg.Add(2)
	go c.consumePaymentEvents()
	go c.consumeMojaloopEvents()

	log.Println("Mojaloop Kafka Connector started")
	return nil
}

func (c *MojaloopKafkaConnector) consumePaymentEvents() {
	defer c.wg.Done()

	for {
		select {
		case <-c.ctx.Done():
			return
		default:
			msg, err := c.paymentEventsReader.ReadMessage(c.ctx)
			if err != nil {
				if err == context.Canceled {
					return
				}
				log.Printf("Error reading payment event: %v", err)
				continue
			}

			var paymentEvent PaymentEvent
			if err := json.Unmarshal(msg.Value, &paymentEvent); err != nil {
				log.Printf("Failed to unmarshal payment event: %v", err)
				continue
			}

			c.processPaymentEvent(paymentEvent)
		}
	}
}

func (c *MojaloopKafkaConnector) processPaymentEvent(event PaymentEvent) {
	if event.PaymentMethod != "mojaloop" && event.PaymentMethod != "mobile_money" {
		return
	}

	log.Printf("Processing payment event: %s for payment %s", event.EventType, event.PaymentID)

	mojaloopEvent := MojaloopEvent{
		EventType:    "mojaloop.transfer.initiate",
		PaymentID:    event.PaymentID,
		Amount:       event.Amount,
		Currency:     event.Currency,
		PayerFSP:     "insurance-platform",
		PayeeFSP:     "recipient-fsp",
		Timestamp:    time.Now(),
	}

	if err := c.publishMojaloopEvent(mojaloopEvent); err != nil {
		log.Printf("Failed to publish Mojaloop event: %v", err)
	}
}

func (c *MojaloopKafkaConnector) consumeMojaloopEvents() {
	defer c.wg.Done()

	for {
		select {
		case <-c.ctx.Done():
			return
		default:
			msg, err := c.mojaloopEventsReader.ReadMessage(c.ctx)
			if err != nil {
				if err == context.Canceled {
					return
				}
				log.Printf("Error reading Mojaloop event: %v", err)
				continue
			}

			var mojaloopEvent MojaloopEvent
			if err := json.Unmarshal(msg.Value, &mojaloopEvent); err != nil {
				log.Printf("Failed to unmarshal Mojaloop event: %v", err)
				continue
			}

			c.processMojaloopEvent(mojaloopEvent)
		}
	}
}

func (c *MojaloopKafkaConnector) processMojaloopEvent(event MojaloopEvent) {
	log.Printf("Processing Mojaloop event: %s for transfer %s", event.EventType, event.TransferID)

	var paymentStatus string
	switch event.EventType {
	case "mojaloop.transfer.prepared":
		paymentStatus = "transfer_prepared"
	case "mojaloop.transfer.fulfilled":
		paymentStatus = "transfer_fulfilled"
	case "mojaloop.transfer.committed":
		paymentStatus = "completed"
	case "mojaloop.transfer.aborted":
		paymentStatus = "failed"
	case "mojaloop.transfer.timeout":
		paymentStatus = "timeout"
	default:
		log.Printf("Unknown Mojaloop event type: %s", event.EventType)
		return
	}

	paymentEvent := PaymentEvent{
		EventType:     "payment.status.update",
		PaymentID:     event.PaymentID,
		Status:        paymentStatus,
		PaymentMethod: "mojaloop",
		Timestamp:     time.Now(),
	}

	if err := c.publishPaymentStatusUpdate(paymentEvent); err != nil {
		log.Printf("Failed to publish payment status update: %v", err)
	}
}

func (c *MojaloopKafkaConnector) publishMojaloopEvent(event MojaloopEvent) error {
	eventJSON, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal Mojaloop event: %w", err)
	}

	msg := kafka.Message{
		Key:   []byte(event.PaymentID.String()),
		Value: eventJSON,
		Time:  time.Now(),
	}

	return c.mojaloopEventsWriter.WriteMessages(c.ctx, msg)
}

func (c *MojaloopKafkaConnector) publishPaymentStatusUpdate(event PaymentEvent) error {
	eventJSON, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal payment event: %w", err)
	}

	msg := kafka.Message{
		Key:   []byte(event.PaymentID.String()),
		Value: eventJSON,
		Time:  time.Now(),
	}

	return c.paymentEventsWriter.WriteMessages(c.ctx, msg)
}

func (c *MojaloopKafkaConnector) Stop() error {
	log.Println("Shutting down Mojaloop Kafka Connector...")

	c.cancel()

	if err := c.paymentEventsReader.Close(); err != nil {
		log.Printf("Error closing payment events reader: %v", err)
	}

	if err := c.mojaloopEventsWriter.Close(); err != nil {
		log.Printf("Error closing Mojaloop events writer: %v", err)
	}

	if err := c.mojaloopEventsReader.Close(); err != nil {
		log.Printf("Error closing Mojaloop events reader: %v", err)
	}

	if err := c.paymentEventsWriter.Close(); err != nil {
		log.Printf("Error closing payment events writer: %v", err)
	}

	c.wg.Wait()
	log.Println("Mojaloop Kafka Connector stopped")
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
	log.Printf("Connected to PostgreSQL for mojaloop_integration")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS mojaloop_integration (
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
	kafkaBrokers := os.Getenv("KAFKA_BROKERS")
	if kafkaBrokers == "" {
		kafkaBrokers = "kafka-0.kafka-headless:9092,kafka-1.kafka-headless:9092,kafka-2.kafka-headless:9092"
	}

	connector := NewMojaloopKafkaConnector(kafkaBrokers)

	if err := connector.Start(); err != nil {
		log.Fatalf("Failed to start connector: %v", err)
	}

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	if err := connector.Stop(); err != nil {
		log.Fatalf("Failed to stop connector: %v", err)
	}
}
