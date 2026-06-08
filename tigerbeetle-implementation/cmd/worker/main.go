package main

import (
	"context"
	"database/sql"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"

	_ "github.com/lib/pq"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"

	"insurance-platform/ledger"
	"insurance-platform/models"
	"insurance-platform/repository"
	"insurance-platform/service"
	"insurance-platform/workflows"
)

func main() {
	log.Println("Starting Policy Service Temporal Worker...")

	// Load configuration from environment variables
	config := loadConfig()

	// Initialize TigerBeetle client
	log.Println("Connecting to TigerBeetle cluster...")
	ledgerClient, err := ledger.NewTigerBeetleClient(ledger.ClientConfig{
		ClusterID:          config.TigerBeetleClusterID,
		Addresses:          strings.Split(config.TigerBeetleAddresses, ","),
		MaxConcurrentBatch: 4096,
	})
	if err != nil {
		log.Fatalf("Failed to create TigerBeetle client: %v", err)
	}
	defer ledgerClient.Close()
	log.Println("TigerBeetle client connected successfully")

	// Initialize PostgreSQL connection
	log.Println("Connecting to PostgreSQL...")
	db, err := sql.Open("postgres", config.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	// Test database connection
	if err := db.Ping(); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}
	log.Println("PostgreSQL connected successfully")

	// Initialize repositories
	paymentRepo := repository.NewPaymentRepository(db)

	// Initialize Kafka producer
	kafkaProducer := NewKafkaProducer(config.KafkaBrokers)
	defer kafkaProducer.Close()

	// Initialize services
	paymentService := service.NewPaymentService(ledgerClient, paymentRepo, kafkaProducer)

	// Initialize service clients (mock implementations for demonstration)
	verificationService := NewVerificationServiceClient(config.VerificationServiceURL)
	documentService := NewDocumentServiceClient(config.DocumentServiceURL)
	notificationService := NewNotificationServiceClient(config.NotificationServiceURL)
	policyRepository := NewPolicyRepository(db)

	// Create Temporal client
	log.Printf("Connecting to Temporal server at %s...", config.TemporalServiceURL)
	temporalClient, err := client.Dial(client.Options{
		HostPort:  config.TemporalServiceURL,
		Namespace: config.TemporalNamespace,
	})
	if err != nil {
		log.Fatalf("Failed to create Temporal client: %v", err)
	}
	defer temporalClient.Close()
	log.Println("Temporal client connected successfully")

	// Create Temporal worker
	w := worker.New(temporalClient, config.TemporalTaskQueue, worker.Options{
		MaxConcurrentActivityExecutionSize:     10,
		MaxConcurrentWorkflowTaskExecutionSize: 5,
	})

	// Register workflows
	w.RegisterWorkflow(workflows.PolicyIssuanceWorkflow)
	log.Println("Registered PolicyIssuanceWorkflow")

	// Register activities
	activities := &workflows.Activities{
		PaymentService:      paymentService,
		VerificationService: verificationService,
		DocumentService:     documentService,
		NotificationService: notificationService,
		PolicyRepository:    policyRepository,
	}

	w.RegisterActivity(activities.VerifyCustomerNINActivity)
	w.RegisterActivity(activities.CalculateRiskAndPremiumActivity)
	w.RegisterActivity(activities.CreatePolicyRecordActivity)
	w.RegisterActivity(activities.ProcessPremiumPaymentActivity)
	w.RegisterActivity(activities.GeneratePolicyDocumentActivity)
	w.RegisterActivity(activities.IssuePolicyActivity)
	w.RegisterActivity(activities.SendPolicyNotificationsActivity)
	w.RegisterActivity(activities.SchedulePremiumRemindersActivity)

	// Register compensating activities
	w.RegisterActivity(activities.CancelPolicyActivity)
	w.RegisterActivity(activities.DeletePolicyDocumentActivity)
	w.RegisterActivity(activities.ProcessRefundActivity)
	w.RegisterActivity(activities.DeletePolicyRecordActivity)
	w.RegisterActivity(activities.SendCompensationNotificationActivity)

	log.Println("All activities registered successfully")

	// Start worker in a goroutine
	go func() {
		log.Printf("Starting Temporal worker on task queue: %s", config.TemporalTaskQueue)
		err := w.Run(worker.InterruptCh())
		if err != nil {
			log.Fatalf("Worker failed: %v", err)
		}
	}()

	log.Println("Temporal worker started successfully")
	log.Println("Worker is ready to process workflows and activities")

	// Wait for interrupt signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	<-sigCh

	log.Println("Shutting down worker...")
	w.Stop()
	log.Println("Worker stopped successfully")
}

// Config holds the application configuration
type Config struct {
	// TigerBeetle
	TigerBeetleClusterID uint32
	TigerBeetleAddresses string

	// PostgreSQL
	DatabaseURL string

	// Kafka
	KafkaBrokers string

	// Temporal
	TemporalServiceURL string
	TemporalNamespace  string
	TemporalTaskQueue  string

	// Service URLs
	VerificationServiceURL string
	DocumentServiceURL     string
	NotificationServiceURL string
}

// loadConfig loads configuration from environment variables
func loadConfig() Config {
	return Config{
		TigerBeetleClusterID:   1, // Default cluster ID
		TigerBeetleAddresses:   getEnv("TIGERBEETLE_ADDRESSES", "localhost:3000"),
		DatabaseURL:            requireEnv("DATABASE_URL"),
		KafkaBrokers:           getEnv("KAFKA_BROKERS", "localhost:9092"),
		TemporalServiceURL:     getEnv("TEMPORAL_SERVICE_URL", "localhost:7233"),
		TemporalNamespace:      getEnv("TEMPORAL_NAMESPACE", "default"),
		TemporalTaskQueue:      getEnv("TEMPORAL_TASK_QUEUE", "policy-task-queue"),
		VerificationServiceURL: getEnv("VERIFICATION_SERVICE_URL", "http://localhost:8081"),
		DocumentServiceURL:     getEnv("DOCUMENT_SERVICE_URL", "http://localhost:8082"),
		NotificationServiceURL: getEnv("NOTIFICATION_SERVICE_URL", "http://localhost:8083"),
	}
}

// getEnv gets an environment variable with a default value
func requireEnv(key string) string {
	val := os.Getenv(key)
	if val == "" {
		log.Fatalf("FATAL: %s environment variable is required", key)
	}
	return val
}

func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}

// Mock implementations of service clients (replace with actual implementations)

type KafkaProducer struct {
	brokers string
}

func NewKafkaProducer(brokers string) *KafkaProducer {
	return &KafkaProducer{brokers: brokers}
}

func (k *KafkaProducer) PublishPaymentEvent(ctx context.Context, event models.PaymentEvent) error {
	log.Printf("Publishing payment event: %s", event.EventType)
	// Actual Kafka implementation would go here
	return nil
}

func (k *KafkaProducer) Close() {
	log.Println("Kafka producer closed")
}

// Service client stubs for external service integration

type verificationServiceClient struct{ url string }

func NewVerificationServiceClient(url string) workflows.VerificationServiceClient {
	return &verificationServiceClient{url: url}
}

func (v *verificationServiceClient) VerifyNIN(ctx context.Context, customerID string) (*models.VerificationResult, error) {
	return &models.VerificationResult{Success: true}, nil
}

type documentServiceClient struct{ url string }

func NewDocumentServiceClient(url string) workflows.DocumentServiceClient {
	return &documentServiceClient{url: url}
}

func (d *documentServiceClient) GeneratePolicyDocument(ctx context.Context, policyID string) (string, error) {
	return "https://docs.example.com/" + policyID, nil
}

func (d *documentServiceClient) DeletePolicyDocument(ctx context.Context, policyID string) error {
	return nil
}

type notificationServiceClient struct{ url string }

func NewNotificationServiceClient(url string) workflows.NotificationServiceClient {
	return &notificationServiceClient{url: url}
}

func (n *notificationServiceClient) SendPolicyNotification(ctx context.Context, req models.NotificationRequest) error {
	log.Printf("Sending notification to customer %s", req.CustomerID)
	return nil
}

func (n *notificationServiceClient) SendCompensationNotification(ctx context.Context, req models.NotificationRequest) error {
	log.Printf("Sending compensation notification to customer %s", req.CustomerID)
	return nil
}

type policyRepo struct{ db *sql.DB }

func NewPolicyRepository(db *sql.DB) workflows.PolicyRepository {
	return &policyRepo{db: db}
}

func (p *policyRepo) Create(ctx context.Context, policy models.Policy) (string, error) {
	return policy.ID, nil
}

func (p *policyRepo) UpdateStatus(ctx context.Context, policyID string, status models.PolicyStatus) error {
	return nil
}

func (p *policyRepo) GetByID(ctx context.Context, policyID string) (*models.Policy, error) {
	return &models.Policy{ID: policyID}, nil
}

func (p *policyRepo) Delete(ctx context.Context, policyID string) error {
	return nil
}
