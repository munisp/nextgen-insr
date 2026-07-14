package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/segmentio/kafka-go"
	tigerbeetle_go "github.com/tigerbeetle/tigerbeetle-go"
	"github.com/tigerbeetle/tigerbeetle-go/pkg/types"
	"gorm.io/gorm"

	"nextgen-insr/tigerbeetle-implementation/ledger"
)

type MojaloopPaymentService struct {
	db                *gorm.DB
	mojaloopClient    *MojaloopClient
	tigerBeetleClient *ledger.TigerBeetleClient
	kafkaWriter       *kafka.Writer
}

type Payment struct {
	ID                  uuid.UUID `gorm:"type:uuid;primary_key"`
	CustomerID          uuid.UUID `gorm:"type:uuid;not null;index"`
	PolicyID            uuid.UUID `gorm:"type:uuid;index"`
	Amount              string    `gorm:"not null"`
	Currency            string    `gorm:"not null"`
	PaymentMethod       string    `gorm:"not null"`
	Status              string    `gorm:"not null;index"`
	MojaloopTransferID  string    `gorm:"index"`
	MojaloopQuoteID     string    
	TigerBeetleTransferID string  
	PayerPartyID        string    
	PayeePartyID        string    
	ILPPacket           string    
	Condition           string    
	Fulfilment          string    
	ErrorCode           string    
	ErrorDescription    string    
	CreatedAt           time.Time
	UpdatedAt           time.Time
	CompletedAt         *time.Time
}

func NewMojaloopPaymentService(
	db *gorm.DB,
	mojaloopBaseURL string,
	fspiID string,
	apiKey string,
	kafkaBrokers string,
	tbClient *ledger.TigerBeetleClient,
) *MojaloopPaymentService {
	mojaloopClient := NewMojaloopClient(mojaloopBaseURL, fspiID, apiKey)

	kafkaWriter := &kafka.Writer{
		Addr:         kafka.TCP(kafkaBrokers),
		Topic:        "54link.payments.events",
		Balancer:     &kafka.Hash{},
		RequiredAcks: kafka.RequireAll,
		Compression:  kafka.Snappy,
	}

	return &MojaloopPaymentService{
		db:                db,
		mojaloopClient:    mojaloopClient,
		tigerBeetleClient: tbClient,
		kafkaWriter:       kafkaWriter,
	}
}

func (s *MojaloopPaymentService) InitiatePayment(ctx context.Context, customerID, policyID uuid.UUID, amount, currency, payerPhone, payeePhone string) (*Payment, error) {
	payment := &Payment{
		ID:            uuid.New(),
		CustomerID:    customerID,
		PolicyID:      policyID,
		Amount:        amount,
		Currency:      currency,
		PaymentMethod: "mojaloop",
		Status:        "initiated",
		PayerPartyID:  payerPhone,
		PayeePartyID:  payeePhone,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	if err := s.db.Create(payment).Error; err != nil {
		return nil, fmt.Errorf("failed to create payment: %w", err)
	}

	if err := s.publishEvent("payment.initiated", payment); err != nil {
		log.Printf("Failed to publish payment initiated event: %v", err)
	}

	go s.processPaymentAsync(ctx, payment)

	return payment, nil
}

func (s *MojaloopPaymentService) processPaymentAsync(ctx context.Context, payment *Payment) {
	if err := s.lookupParties(ctx, payment); err != nil {
		s.failPayment(payment, "PARTY_LOOKUP_FAILED", err.Error())
		return
	}

	if err := s.requestQuote(ctx, payment); err != nil {
		s.failPayment(payment, "QUOTE_FAILED", err.Error())
		return
	}

	if err := s.prepareTransfer(ctx, payment); err != nil {
		s.failPayment(payment, "TRANSFER_PREPARE_FAILED", err.Error())
		return
	}

	if err := s.fulfillTransfer(ctx, payment); err != nil {
		s.failPayment(payment, "TRANSFER_FULFIL_FAILED", err.Error())
		return
	}

	s.completePayment(payment)
}

func (s *MojaloopPaymentService) lookupParties(ctx context.Context, payment *Payment) error {
	payment.Status = "party_lookup"
	s.db.Save(payment)

	payerReq := PartyLookupRequest{
		PartyIdType:     "MSISDN",
		PartyIdentifier: payment.PayerPartyID,
	}

	payerResp, err := s.mojaloopClient.LookupParty(ctx, payerReq)
	if err != nil {
		return fmt.Errorf("payer lookup failed: %w", err)
	}

	payeeReq := PartyLookupRequest{
		PartyIdType:     "MSISDN",
		PartyIdentifier: payment.PayeePartyID,
	}

	payeeResp, err := s.mojaloopClient.LookupParty(ctx, payeeReq)
	if err != nil {
		return fmt.Errorf("payee lookup failed: %w", err)
	}

	log.Printf("Party lookup successful - Payer: %s, Payee: %s", 
		payerResp.Party.FspId, payeeResp.Party.FspId)

	s.publishEvent("payment.parties_resolved", payment)
	return nil
}

func (s *MojaloopPaymentService) requestQuote(ctx context.Context, payment *Payment) error {
	payment.Status = "quote_request"
	s.db.Save(payment)

	quoteID := uuid.New().String()
	transactionID := uuid.New().String()

	quoteReq := QuoteRequest{
		QuoteID:       quoteID,
		TransactionID: transactionID,
		Payer: Party{
			PartyIdType:     "MSISDN",
			PartyIdentifier: payment.PayerPartyID,
		},
		Payee: Party{
			PartyIdType:     "MSISDN",
			PartyIdentifier: payment.PayeePartyID,
		},
		AmountType: "SEND",
		Amount: Money{
			Currency: payment.Currency,
			Amount:   payment.Amount,
		},
		TransactionType: TransactionType{
			Scenario:      "TRANSFER",
			Initiator:     "PAYER",
			InitiatorType: "CONSUMER",
		},
		Expiration: time.Now().Add(1 * time.Hour),
	}

	quoteResp, err := s.mojaloopClient.RequestQuote(ctx, quoteReq)
	if err != nil {
		return fmt.Errorf("quote request failed: %w", err)
	}

	payment.MojaloopQuoteID = quoteID
	payment.ILPPacket = quoteResp.ILPPacket
	payment.Condition = quoteResp.Condition
	payment.Status = "quote_received"
	s.db.Save(payment)

	s.publishEvent("payment.quote_received", payment)
	return nil
}

func (s *MojaloopPaymentService) prepareTransfer(ctx context.Context, payment *Payment) error {
	payment.Status = "transfer_prepare"
	s.db.Save(payment)

	transferID := uuid.New().String()

	transferReq := TransferRequest{
		TransferID: transferID,
		PayerFSP:   "insurance-platform",
		PayeeFSP:   "recipient-fsp",
		Amount: Money{
			Currency: payment.Currency,
			Amount:   payment.Amount,
		},
		ILPPacket:  payment.ILPPacket,
		Condition:  payment.Condition,
		Expiration: time.Now().Add(30 * time.Minute),
	}

	transferResp, err := s.mojaloopClient.PrepareTransfer(ctx, transferReq)
	if err != nil {
		return fmt.Errorf("transfer prepare failed: %w", err)
	}

	payment.MojaloopTransferID = transferID
	payment.Status = "transfer_prepared"
	s.db.Save(payment)

	log.Printf("Transfer prepared: %s, state: %s", transferResp.TransferID, transferResp.TransferState)

	s.publishEvent("payment.transfer_prepared", payment)
	return nil
}

func (s *MojaloopPaymentService) fulfillTransfer(ctx context.Context, payment *Payment) error {
	payment.Status = "transfer_fulfil"
	s.db.Save(payment)

	fulfilment := GenerateFulfilment(payment.Condition)

	if err := s.mojaloopClient.FulfillTransfer(ctx, payment.MojaloopTransferID, fulfilment); err != nil {
		return fmt.Errorf("transfer fulfil failed: %w", err)
	}

	payment.Fulfilment = fulfilment
	payment.Status = "transfer_fulfilled"
	s.db.Save(payment)

	s.publishEvent("payment.transfer_fulfilled", payment)
	return nil
}

func (s *MojaloopPaymentService) completePayment(payment *Payment) {
	now := time.Now()
	payment.Status = "completed"
	payment.CompletedAt = &now
	payment.UpdatedAt = now

	// Record the transfer in TigerBeetle for double-entry ledger
	if s.tigerBeetleClient != nil {
		amountFloat, err := strconv.ParseFloat(payment.Amount, 64)
		if err == nil {
			amountSmallest := ledger.AmountToSmallestUnit(amountFloat, 2)
			transferID := ledger.GenerateTransferID(
				fmt.Sprintf("mojaloop-%s", payment.MojaloopTransferID), 1,
			)
			customerAccountID := ledger.GenerateAccountID("customer", payment.CustomerID.ID())
			companyAccountID := ledger.GenerateAccountID("company", 1)

			transfer := types.Transfer{
				ID:              transferID,
				DebitAccountID:  customerAccountID,
				CreditAccountID: companyAccountID,
				Amount:          ledger.Uint128FromUint64(amountSmallest),
				Ledger:          1,
				Code:            100, // Premium payment
			}

			if _, err := s.tigerBeetleClient.CreateTransfer(
				context.Background(), transfer,
			); err != nil {
				log.Printf("TigerBeetle transfer failed for payment %s: %v", payment.ID, err)
			} else {
				payment.TigerBeetleTransferID = fmt.Sprintf("%v", transferID)
				log.Printf("TigerBeetle transfer recorded for payment %s", payment.ID)
			}
		}
	}

	s.db.Save(payment)
	s.publishEvent("payment.completed", payment)
	log.Printf("Payment completed: %s", payment.ID)
}

func (s *MojaloopPaymentService) failPayment(payment *Payment, errorCode, errorDescription string) {
	payment.Status = "failed"
	payment.ErrorCode = errorCode
	payment.ErrorDescription = errorDescription
	payment.UpdatedAt = time.Now()
	s.db.Save(payment)

	s.publishEvent("payment.failed", payment)
	log.Printf("Payment failed: %s, error: %s - %s", payment.ID, errorCode, errorDescription)
}

func (s *MojaloopPaymentService) GetPaymentStatus(ctx context.Context, paymentID uuid.UUID) (*Payment, error) {
	var payment Payment
	if err := s.db.Where("id = ?", paymentID).First(&payment).Error; err != nil {
		return nil, fmt.Errorf("payment not found: %w", err)
	}

	if payment.MojaloopTransferID != "" && payment.Status != "completed" && payment.Status != "failed" {
		transferResp, err := s.mojaloopClient.GetTransferStatus(ctx, payment.MojaloopTransferID)
		if err != nil {
			log.Printf("Failed to get transfer status: %v", err)
		} else {
			if transferResp.TransferState == "COMMITTED" && payment.Status != "completed" {
				s.completePayment(&payment)
			}
		}
	}

	return &payment, nil
}

func (s *MojaloopPaymentService) publishEvent(eventType string, payment *Payment) error {
	event := map[string]interface{}{
		"event_type":           eventType,
		"payment_id":           payment.ID,
		"customer_id":          payment.CustomerID,
		"policy_id":            payment.PolicyID,
		"amount":               payment.Amount,
		"currency":             payment.Currency,
		"status":               payment.Status,
		"mojaloop_transfer_id": payment.MojaloopTransferID,
		"mojaloop_quote_id":    payment.MojaloopQuoteID,
		"timestamp":            time.Now(),
	}

	eventJSON, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal event: %w", err)
	}

	msg := kafka.Message{
		Key:   []byte(payment.ID.String()),
		Value: eventJSON,
		Time:  time.Now(),
	}

	return s.kafkaWriter.WriteMessages(context.Background(), msg)
}

func (s *MojaloopPaymentService) Close() error {
	if err := s.kafkaWriter.Close(); err != nil {
		return fmt.Errorf("failed to close kafka writer: %w", err)
	}
	return nil
}
