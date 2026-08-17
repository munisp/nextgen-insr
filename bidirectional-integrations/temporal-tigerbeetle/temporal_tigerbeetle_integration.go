package temporaltigerbeetle

import (
	"context"
	"fmt"
	"math/big"
	"time"

	"github.com/google/uuid"
	types "github.com/tigerbeetle/tigerbeetle-go"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

type TigerBeetleClient struct {
	client types.Client
}

type TransferRequest struct {
	TransferID      string
	DebitAccountID  types.Uint128
	CreditAccountID types.Uint128
	Amount          uint64
	Ledger          uint32
	Code            uint16
	Timeout         uint32
	IsPending       bool
}

type TransferResult struct {
	TransferID   string
	Status       string
	ErrorCode    string
	ErrorMessage string
	Timestamp    time.Time
}

type AccountBalance struct {
	AccountID      types.Uint128
	DebitsPosted   uint64
	CreditsPosted  uint64
	DebitsPending  uint64
	CreditsPending uint64
	NetBalance     int64
}

func NewTigerBeetleClient(clusterID types.Uint128, addresses []string) (*TigerBeetleClient, error) {
	client, err := types.NewClient(clusterID, addresses)
	if err != nil {
		return nil, fmt.Errorf("failed to create TigerBeetle client: %w", err)
	}

	return &TigerBeetleClient{
		client: client,
	}, nil
}

func (c *TigerBeetleClient) CreateAccount(ctx context.Context, accountID types.Uint128, ledger uint32, code uint16) error {
	accounts := []types.Account{
		{
			ID:        accountID,
			Ledger:    ledger,
			Code:      code,
			Flags:     0,
			Timestamp: uint64(time.Now().UnixNano()),
		},
	}

	results, err := c.client.CreateAccounts(accounts)
	if err != nil {
		return fmt.Errorf("failed to create account: %w", err)
	}

	if len(results) > 0 {
		return fmt.Errorf("account creation failed with result: %v", results[0].Status)
	}

	return nil
}

func (c *TigerBeetleClient) CreateTransfer(ctx context.Context, req TransferRequest) (*TransferResult, error) {
	transferID := parseTransferID(req.TransferID)

	var flags uint16
	if req.IsPending {
		flags = types.TransferFlags{Pending: true}.ToUint16()
	}

	transfers := []types.Transfer{
		{
			ID:              transferID,
			DebitAccountID:  req.DebitAccountID,
			CreditAccountID: req.CreditAccountID,
			Amount:          uint64ToUint128(req.Amount),
			Ledger:          req.Ledger,
			Code:            req.Code,
			Flags:           flags,
			Timeout:         req.Timeout,
			Timestamp:       uint64(time.Now().UnixNano()),
		},
	}

	results, err := c.client.CreateTransfers(transfers)
	if err != nil {
		return &TransferResult{
			TransferID:   req.TransferID,
			Status:       "failed",
			ErrorMessage: err.Error(),
			Timestamp:    time.Now(),
		}, fmt.Errorf("failed to create transfer: %w", err)
	}

	if len(results) > 0 {
		return &TransferResult{
			TransferID:   req.TransferID,
			Status:       "failed",
			ErrorCode:    fmt.Sprintf("%d", results[0].Status),
			ErrorMessage: "Transfer creation failed",
			Timestamp:    time.Now(),
		}, fmt.Errorf("transfer creation failed with result: %v", results[0].Status)
	}

	return &TransferResult{
		TransferID: req.TransferID,
		Status:     "success",
		Timestamp:  time.Now(),
	}, nil
}

func (c *TigerBeetleClient) PostPendingTransfer(ctx context.Context, transferID, pendingTransferID string, ledger uint32, code uint16) (*TransferResult, error) {
	postID := parseTransferID(transferID)
	pendingID := parseTransferID(pendingTransferID)

	transfers := []types.Transfer{
		{
			ID:        postID,
			PendingID: pendingID,
			Ledger:    ledger,
			Code:      code,
			Flags:     types.TransferFlags{PostPendingTransfer: true}.ToUint16(),
			Timestamp: uint64(time.Now().UnixNano()),
		},
	}

	results, err := c.client.CreateTransfers(transfers)
	if err != nil {
		return &TransferResult{
			TransferID:   transferID,
			Status:       "failed",
			ErrorMessage: err.Error(),
			Timestamp:    time.Now(),
		}, fmt.Errorf("failed to post pending transfer: %w", err)
	}

	if len(results) > 0 {
		return &TransferResult{
			TransferID:   transferID,
			Status:       "failed",
			ErrorCode:    fmt.Sprintf("%d", results[0].Status),
			ErrorMessage: "Post pending transfer failed",
			Timestamp:    time.Now(),
		}, fmt.Errorf("post pending transfer failed with result: %v", results[0].Status)
	}

	return &TransferResult{
		TransferID: transferID,
		Status:     "committed",
		Timestamp:  time.Now(),
	}, nil
}

func (c *TigerBeetleClient) VoidPendingTransfer(ctx context.Context, transferID, pendingTransferID string, ledger uint32, code uint16) (*TransferResult, error) {
	voidID := parseTransferID(transferID)
	pendingID := parseTransferID(pendingTransferID)

	transfers := []types.Transfer{
		{
			ID:        voidID,
			PendingID: pendingID,
			Ledger:    ledger,
			Code:      code,
			Flags:     types.TransferFlags{VoidPendingTransfer: true}.ToUint16(),
			Timestamp: uint64(time.Now().UnixNano()),
		},
	}

	results, err := c.client.CreateTransfers(transfers)
	if err != nil {
		return &TransferResult{
			TransferID:   transferID,
			Status:       "failed",
			ErrorMessage: err.Error(),
			Timestamp:    time.Now(),
		}, fmt.Errorf("failed to void pending transfer: %w", err)
	}

	if len(results) > 0 {
		return &TransferResult{
			TransferID:   transferID,
			Status:       "failed",
			ErrorCode:    fmt.Sprintf("%d", results[0].Status),
			ErrorMessage: "Void pending transfer failed",
			Timestamp:    time.Now(),
		}, fmt.Errorf("void pending transfer failed with result: %v", results[0].Status)
	}

	return &TransferResult{
		TransferID: transferID,
		Status:     "voided",
		Timestamp:  time.Now(),
	}, nil
}

func (c *TigerBeetleClient) GetAccountBalance(ctx context.Context, accountID types.Uint128) (*AccountBalance, error) {
	accounts, err := c.client.LookupAccounts([]types.Uint128{accountID})
	if err != nil {
		return nil, fmt.Errorf("failed to lookup account: %w", err)
	}

	if len(accounts) == 0 {
		return nil, fmt.Errorf("account not found")
	}

	account := accounts[0]
	creditsPosted, _ := account.CreditsPosted.Uint64()
	debitsPosted, _ := account.DebitsPosted.Uint64()
	creditsPending, _ := account.CreditsPending.Uint64()
	debitsPending, _ := account.DebitsPending.Uint64()
	netBalance := int64(creditsPosted) - int64(debitsPosted)

	return &AccountBalance{
		AccountID:      accountID,
		DebitsPosted:   debitsPosted,
		CreditsPosted:  creditsPosted,
		DebitsPending:  debitsPending,
		CreditsPending: creditsPending,
		NetBalance:     netBalance,
	}, nil
}

func (c *TigerBeetleClient) Close() {
	c.client.Close()
}

type TigerBeetleActivities struct {
	client *TigerBeetleClient
}

func NewTigerBeetleActivities(client *TigerBeetleClient) *TigerBeetleActivities {
	return &TigerBeetleActivities{
		client: client,
	}
}

func (a *TigerBeetleActivities) CreateAccountActivity(ctx context.Context, accountID types.Uint128, ledger uint32, code uint16) error {
	logger := activity.GetLogger(ctx)
	logger.Info("Creating TigerBeetle account", "accountID", accountID)

	if err := a.client.CreateAccount(ctx, accountID, ledger, code); err != nil {
		logger.Error("Failed to create account", "error", err)
		return err
	}

	logger.Info("Account created successfully", "accountID", accountID)
	return nil
}

func (a *TigerBeetleActivities) CreateTransferActivity(ctx context.Context, req TransferRequest) (*TransferResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Creating TigerBeetle transfer", "transferID", req.TransferID)

	result, err := a.client.CreateTransfer(ctx, req)
	if err != nil {
		logger.Error("Failed to create transfer", "error", err)
		return result, err
	}

	logger.Info("Transfer created successfully", "transferID", req.TransferID, "status", result.Status)
	return result, nil
}

func (a *TigerBeetleActivities) PostPendingTransferActivity(ctx context.Context, transferID, pendingTransferID string, ledger uint32, code uint16) (*TransferResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Posting pending transfer", "transferID", transferID, "pendingTransferID", pendingTransferID)

	result, err := a.client.PostPendingTransfer(ctx, transferID, pendingTransferID, ledger, code)
	if err != nil {
		logger.Error("Failed to post pending transfer", "error", err)
		return result, err
	}

	logger.Info("Pending transfer posted successfully", "transferID", transferID)
	return result, nil
}

func (a *TigerBeetleActivities) VoidPendingTransferActivity(ctx context.Context, transferID, pendingTransferID string, ledger uint32, code uint16) (*TransferResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Voiding pending transfer", "transferID", transferID, "pendingTransferID", pendingTransferID)

	result, err := a.client.VoidPendingTransfer(ctx, transferID, pendingTransferID, ledger, code)
	if err != nil {
		logger.Error("Failed to void pending transfer", "error", err)
		return result, err
	}

	logger.Info("Pending transfer voided successfully", "transferID", transferID)
	return result, nil
}

func (a *TigerBeetleActivities) GetAccountBalanceActivity(ctx context.Context, accountID types.Uint128) (*AccountBalance, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("Getting account balance", "accountID", accountID)

	balance, err := a.client.GetAccountBalance(ctx, accountID)
	if err != nil {
		logger.Error("Failed to get account balance", "error", err)
		return nil, err
	}

	logger.Info("Account balance retrieved", "accountID", accountID, "netBalance", balance.NetBalance)
	return balance, nil
}

type PaymentWorkflowInput struct {
	PaymentID       string
	DebitAccountID  types.Uint128
	CreditAccountID types.Uint128
	Amount          uint64
	Currency        string
	Ledger          uint32
	Code            uint16
}

type PaymentWorkflowResult struct {
	PaymentID    string
	TransferID   string
	Status       string
	ErrorMessage string
	CompletedAt  time.Time
}

func PaymentWorkflow(ctx workflow.Context, input PaymentWorkflowInput) (*PaymentWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting payment workflow", "paymentID", input.PaymentID)

	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	transferID := fmt.Sprintf("TXN-%s-%d", input.PaymentID, time.Now().Unix())

	pendingReq := TransferRequest{
		TransferID:      transferID,
		DebitAccountID:  input.DebitAccountID,
		CreditAccountID: input.CreditAccountID,
		Amount:          input.Amount,
		Ledger:          input.Ledger,
		Code:            input.Code,
		Timeout:         3600,
		IsPending:       true,
	}

	var pendingResult *TransferResult
	err := workflow.ExecuteActivity(ctx, "CreateTransferActivity", pendingReq).Get(ctx, &pendingResult)
	if err != nil {
		logger.Error("Failed to create pending transfer", "error", err)
		return &PaymentWorkflowResult{
			PaymentID:    input.PaymentID,
			Status:       "failed",
			ErrorMessage: err.Error(),
			CompletedAt:  time.Now(),
		}, err
	}

	var paymentApproved bool
	err = workflow.ExecuteActivity(ctx, "ValidatePaymentActivity", input.PaymentID).Get(ctx, &paymentApproved)
	if err != nil {
		logger.Error("Payment validation failed", "error", err)

		voidID := fmt.Sprintf("VOID-%s", transferID)
		var voidResult *TransferResult
		_ = workflow.ExecuteActivity(ctx, "VoidPendingTransferActivity", voidID, transferID, input.Ledger, input.Code).Get(ctx, &voidResult)

		return &PaymentWorkflowResult{
			PaymentID:    input.PaymentID,
			Status:       "failed",
			ErrorMessage: "Payment validation failed",
			CompletedAt:  time.Now(),
		}, err
	}

	if !paymentApproved {
		logger.Info("Payment not approved, voiding transfer")

		voidID := fmt.Sprintf("VOID-%s", transferID)
		var voidResult *TransferResult
		err = workflow.ExecuteActivity(ctx, "VoidPendingTransferActivity", voidID, transferID, input.Ledger, input.Code).Get(ctx, &voidResult)
		if err != nil {
			logger.Error("Failed to void pending transfer", "error", err)
		}

		return &PaymentWorkflowResult{
			PaymentID:    input.PaymentID,
			TransferID:   transferID,
			Status:       "rejected",
			ErrorMessage: "Payment not approved",
			CompletedAt:  time.Now(),
		}, nil
	}

	postID := fmt.Sprintf("POST-%s", transferID)
	var postResult *TransferResult
	err = workflow.ExecuteActivity(ctx, "PostPendingTransferActivity", postID, transferID, input.Ledger, input.Code).Get(ctx, &postResult)
	if err != nil {
		logger.Error("Failed to post pending transfer", "error", err)
		return &PaymentWorkflowResult{
			PaymentID:    input.PaymentID,
			TransferID:   transferID,
			Status:       "failed",
			ErrorMessage: err.Error(),
			CompletedAt:  time.Now(),
		}, err
	}

	logger.Info("Payment workflow completed successfully", "paymentID", input.PaymentID)
	return &PaymentWorkflowResult{
		PaymentID:   input.PaymentID,
		TransferID:  transferID,
		Status:      "completed",
		CompletedAt: time.Now(),
	}, nil
}

func ClaimPaymentWorkflow(ctx workflow.Context, input PaymentWorkflowInput) (*PaymentWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting claim payment workflow", "paymentID", input.PaymentID)

	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	var claimApproved bool
	err := workflow.ExecuteActivity(ctx, "ValidateClaimActivity", input.PaymentID).Get(ctx, &claimApproved)
	if err != nil || !claimApproved {
		logger.Error("Claim validation failed", "error", err)
		return &PaymentWorkflowResult{
			PaymentID:    input.PaymentID,
			Status:       "rejected",
			ErrorMessage: "Claim validation failed",
			CompletedAt:  time.Now(),
		}, err
	}

	transferID := fmt.Sprintf("CLAIM-%s-%d", input.PaymentID, time.Now().Unix())

	transferReq := TransferRequest{
		TransferID:      transferID,
		DebitAccountID:  input.DebitAccountID,
		CreditAccountID: input.CreditAccountID,
		Amount:          input.Amount,
		Ledger:          input.Ledger,
		Code:            input.Code,
		IsPending:       false,
	}

	var transferResult *TransferResult
	err = workflow.ExecuteActivity(ctx, "CreateTransferActivity", transferReq).Get(ctx, &transferResult)
	if err != nil {
		logger.Error("Failed to create claim transfer", "error", err)
		return &PaymentWorkflowResult{
			PaymentID:    input.PaymentID,
			Status:       "failed",
			ErrorMessage: err.Error(),
			CompletedAt:  time.Now(),
		}, err
	}

	logger.Info("Claim payment workflow completed successfully", "paymentID", input.PaymentID)
	return &PaymentWorkflowResult{
		PaymentID:   input.PaymentID,
		TransferID:  transferID,
		Status:      "completed",
		CompletedAt: time.Now(),
	}, nil
}

func uint64ToUint128(v uint64) types.Uint128 {
	return types.BigIntToUint128(new(big.Int).SetUint64(v))
}

func parseTransferID(transferID string) types.Uint128 {
	id := uuid.MustParse(transferID)
	return types.BytesToUint128(id)
}
