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
	"gorm.io/gorm"

	"github.com/munisp/NGApp/mojaloop-integration/ledger"
)

type MojaloopPaymentService struct {
	db                *gorm.DB
	mojaloopClient    *MojaloopClient
	tigerBeetleClient *ledger.TigerBeetleClient
	kafkaWriter       *kafka.Writer
}

type Payment struct {
	ID                    uuid.UUID `gorm:"type:uuid;primary_key"`
	CustomerID            uuid.UUID `gorm:"type:uuid;not null;index"`
	PolicyID              uuid.UUID `gorm:"type:uuid;index"`
	Amount                string    `gorm:"not null"`
	Currency              string    `gorm:"not null"`
	PaymentMethod         string    `gorm:"not null"`
	Status                string    `gorm:"not null;index"`
	MojaloopTransferID    string    `gorm:"index"`
	MojaloopQuoteID       string
	TigerBeetleTransferID string
	PayerPartyID          string
	PayeePartyID          string
	ILPPacket             string
	Condition             string
	Fulfilment            string
	// LedgerStatus honestly records the TigerBeetle leg outcome:
	// "recorded" | "failed" | "not_configured". Empty until completion.
	LedgerStatus          string
	ErrorCode             string
	ErrorDescription      string
	CreatedAt             time.Time
	UpdatedAt             time.Time
	CompletedAt           *time.Time
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

	// Detach from the request-scoped context: the payment lifecycle
	// (quote → prepare → await switch fulfilment) outlives the HTTP call.
	go s.processPaymentAsync(context.Background(), payment)

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

	if err := s.awaitSwitchFulfilment(ctx, payment); err != nil {
		s.failPayment(payment, "TRANSFER_FULFIL_FAILED", err.Error())
		return
	}

	if err := s.completePayment(payment); err != nil {
		// Money moved at the switch but the ledger leg failed. The payment
		// is left in "ledger_error" for ops reconciliation — NOT "completed".
		log.Printf("Payment %s ledger recording failed: %v", payment.ID, err)
		_ = s.publishEvent("payment.ledger_error", payment)
	}
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

	_ = s.publishEvent("payment.parties_resolved", payment)
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

	_ = s.publishEvent("payment.quote_received", payment)
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

	_ = s.publishEvent("payment.transfer_prepared", payment)
	return nil
}

// awaitSwitchFulfilment waits for the Mojaloop switch to report the transfer
// as COMMITTED and validates the revealed ILP fulfilment cryptographically
// against the quote condition.
//
// HONESTY (DD-TB remediation): the previous implementation fabricated the
// fulfilment locally ("fulfilment_<condition>") and PUT it to the switch,
// then marked the transfer fulfilled. A payer DFSP cannot know the ILP
// preimage — only the payee DFSP reveals it on commit. This function never
// invents a fulfilment: it polls the switch, and any fulfilment that fails
// validation is treated as an error, not a success.
func (s *MojaloopPaymentService) awaitSwitchFulfilment(ctx context.Context, payment *Payment) error {
	payment.Status = "awaiting_fulfilment"
	s.db.Save(payment)

	const pollInterval = 5 * time.Second
	// Cap the wait at the transfer window (30 minutes, matching
	// prepareTransfer's expiration).
	deadline := time.Now().Add(30 * time.Minute)

	for {
		transferResp, err := s.mojaloopClient.GetTransferStatus(ctx, payment.MojaloopTransferID)
		if err != nil {
			log.Printf("Transfer status poll failed for payment %s: %v", payment.ID, err)
		} else {
			switch transferResp.TransferState {
			case "COMMITTED":
				if transferResp.Fulfilment == "" {
					return fmt.Errorf("switch reported COMMITTED without a fulfilment — refusing to mark fulfilled")
				}
				if err := ValidateFulfilment(transferResp.Fulfilment, payment.Condition); err != nil {
					return fmt.Errorf("switch fulfilment failed ILP validation: %w", err)
				}
				payment.Fulfilment = transferResp.Fulfilment
				payment.Status = "transfer_fulfilled"
				s.db.Save(payment)
				_ = s.publishEvent("payment.transfer_fulfilled", payment)
				return nil
			case "REJECTED", "ABORTED":
				return fmt.Errorf("switch reported transfer state %s", transferResp.TransferState)
			}
		}

		if time.Now().After(deadline) {
			return fmt.Errorf("switch did not commit transfer %s within 30m — NOT marking payment completed", payment.MojaloopTransferID)
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("fulfilment wait cancelled: %w", ctx.Err())
		case <-time.After(pollInterval):
		}
	}
}

// completePayment records the ledger leg and marks the payment completed.
// FAIL-CLOSED: if the TigerBeetle ledger write fails, the payment is moved
// to "ledger_error" (money moved at the switch; ledger leg missing — ops
// must reconcile) and an error is returned. "completed" is only ever
// persisted when the ledger leg succeeded or is explicitly not configured
// (LedgerStatus records which).
func (s *MojaloopPaymentService) completePayment(payment *Payment) error {
	now := time.Now()
	payment.UpdatedAt = now

	if s.tigerBeetleClient == nil {
		// Honest labeling: no ledger is wired; do not claim a ledger record.
		payment.LedgerStatus = "not_configured"
		log.Printf("WARN: payment %s completing without a ledger record (TigerBeetle client not configured)", payment.ID)
	} else {
		amountFloat, err := strconv.ParseFloat(payment.Amount, 64)
		if err != nil {
			payment.Status = "ledger_error"
			payment.LedgerStatus = "failed"
			payment.ErrorCode = "LEDGER_AMOUNT_PARSE_FAILED"
			payment.ErrorDescription = err.Error()
			s.db.Save(payment)
			return fmt.Errorf("failed to parse payment amount for ledger: %w", err)
		}
		amountSmallest := ledger.AmountToSmallestUnit(amountFloat, 2)
		transferID := ledger.GenerateTransferID(
			fmt.Sprintf("mojaloop-%s", payment.MojaloopTransferID), 1,
		)
		customerAccountID := ledger.GenerateAccountID("customer", payment.CustomerID.ID())
		companyAccountID := ledger.GenerateAccountID("company", 1)

		transfer := tigerbeetle_go.Transfer{
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
			payment.Status = "ledger_error"
			payment.LedgerStatus = "failed"
			payment.ErrorCode = "LEDGER_RECORD_FAILED"
			payment.ErrorDescription = err.Error()
			s.db.Save(payment)
			return fmt.Errorf("TigerBeetle ledger write failed for payment %s: %w", payment.ID, err)
		}
		payment.TigerBeetleTransferID = fmt.Sprintf("%v", transferID)
		payment.LedgerStatus = "recorded"
		log.Printf("TigerBeetle transfer recorded for payment %s", payment.ID)
	}

	payment.Status = "completed"
	payment.CompletedAt = &now
	s.db.Save(payment)
	_ = s.publishEvent("payment.completed", payment)
	log.Printf("Payment completed: %s (ledger: %s)", payment.ID, payment.LedgerStatus)
	return nil
}

func (s *MojaloopPaymentService) failPayment(payment *Payment, errorCode, errorDescription string) {
	payment.Status = "failed"
	payment.ErrorCode = errorCode
	payment.ErrorDescription = errorDescription
	payment.UpdatedAt = time.Now()
	s.db.Save(payment)

	_ = s.publishEvent("payment.failed", payment)
	log.Printf("Payment failed: %s, error: %s - %s", payment.ID, errorCode, errorDescription)
}

func (s *MojaloopPaymentService) GetPaymentStatus(ctx context.Context, paymentID uuid.UUID) (*Payment, error) {
	var payment Payment
	if err := s.db.Where("id = ?", paymentID).First(&payment).Error; err != nil {
		return nil, fmt.Errorf("payment not found: %w", err)
	}

	if payment.MojaloopTransferID != "" && payment.Status != "completed" && payment.Status != "failed" && payment.Status != "ledger_error" {
		transferResp, err := s.mojaloopClient.GetTransferStatus(ctx, payment.MojaloopTransferID)
		if err != nil {
			log.Printf("Failed to get transfer status: %v", err)
		} else if transferResp.TransferState == "COMMITTED" && payment.Status != "completed" {
			// Only complete on a cryptographically valid fulfilment — never
			// on the switch's say-so alone.
			if transferResp.Fulfilment == "" {
				log.Printf("Switch reported COMMITTED without fulfilment for payment %s — not completing", payment.ID)
			} else if verr := ValidateFulfilment(transferResp.Fulfilment, payment.Condition); verr != nil {
				s.failPayment(&payment, "FULFILMENT_INVALID", verr.Error())
			} else {
				payment.Fulfilment = transferResp.Fulfilment
				if cerr := s.completePayment(&payment); cerr != nil {
					log.Printf("Ledger recording failed during status sync for payment %s: %v", payment.ID, cerr)
				}
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
