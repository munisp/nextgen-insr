package main

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/insureportal/ussd_gateway/db"
	"github.com/insureportal/ussd_gateway/models"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Config holds all runtime configuration, loaded from environment variables.
type Config struct {
	Port        int
	DatabaseDSN string
	RedisAddr   string
	RedisPass   string
	RedisDB     int
	LogLevel    string
	// PINPepper is the server-side secret mixed into PIN hashes (fail-closed:
	// financial ops are blocked when unset, since PINs could not be verified
	// safely).
	PINPepper string
	// PINMaxAttempts before lockout; PINLockSeconds is the lockout duration.
	PINMaxAttempts int
	PINLockSeconds int
	// CashOutCoolingHours is the cooling period after a phone rebind before
	// cash-out (float claim) is allowed.
	CashOutCoolingHours int
}

func loadConfig() Config {
	cfg := Config{
		Port:      8092,
		LogLevel:  "info",
		RedisDB:   0,
		RedisPass: "",
		RedisAddr: "127.0.0.1:6379",
	}

	if p := os.Getenv("PORT"); p != "" {
		if v, err := strconv.Atoi(p); err == nil {
			cfg.Port = v
		}
	}
	if v := os.Getenv("DATABASE_URL"); v != "" {
		cfg.DatabaseDSN = v
	}
	if v := os.Getenv("REDIS_ADDR"); v != "" {
		cfg.RedisAddr = v
	}
	if v := os.Getenv("REDIS_PASSWORD"); v != "" {
		cfg.RedisPass = v
	}
	if v, err := strconv.Atoi(os.Getenv("REDIS_DB")); err == nil {
		cfg.RedisDB = v
	}
	if v := os.Getenv("LOG_LEVEL"); v != "" {
		cfg.LogLevel = v
	}
	cfg.PINPepper = os.Getenv("PIN_PEPPER")
	cfg.PINMaxAttempts = 3
	if v, err := strconv.Atoi(os.Getenv("PIN_MAX_ATTEMPTS")); err == nil && v > 0 {
		cfg.PINMaxAttempts = v
	}
	cfg.PINLockSeconds = 900
	if v, err := strconv.Atoi(os.Getenv("PIN_LOCK_SECONDS")); err == nil && v > 0 {
		cfg.PINLockSeconds = v
	}
	cfg.CashOutCoolingHours = 24
	if v, err := strconv.Atoi(os.Getenv("CASHOUT_COOLING_HOURS")); err == nil && v >= 0 {
		cfg.CashOutCoolingHours = v
	}

	return cfg
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

func newLogger(level string) *zap.Logger {
	encoderCfg := zap.NewProductionEncoderConfig()
	encoderCfg.TimeKey = "ts"
	encoderCfg.EncodeTime = zapcore.ISO8601TimeEncoder

	core := zapcore.NewCore(
		zapcore.NewJSONEncoder(encoderCfg),
		zapcore.AddSync(os.Stdout),
		zap.LevelEnablerFunc(func(lvl zapcore.Level) bool {
			switch level {
			case "debug":
				return lvl >= zapcore.DebugLevel
			case "warn":
				return lvl >= zapcore.WarnLevel
			case "error":
				return lvl >= zapcore.ErrorLevel
			default:
				return lvl >= zapcore.InfoLevel
			}
		}),
	)
	return zap.New(core, zap.AddCaller())
}

// ---------------------------------------------------------------------------
// Application — holds all dependencies
// ---------------------------------------------------------------------------

type Application struct {
	cfg   Config
	log   *zap.Logger
	redis *db.RedisCache
	pg    *db.PostgresStore
	quit  chan struct{}
}

func newApp(cfg Config, log *zap.Logger) *Application {
	return &Application{
		cfg:  cfg,
		log:  log,
		quit: make(chan struct{}),
	}
}

func (app *Application) start(ctx context.Context) error {
	// Connect to PostgreSQL.
	pg, err := db.NewPostgresStore(app.cfg.DatabaseDSN)
	if err != nil {
		return fmt.Errorf("postgres init: %w", err)
	}
	app.pg = pg
	app.log.Info("postgres connected", zap.String("dsn", maskDSN(app.cfg.DatabaseDSN)))

	// Connect to Redis.
	rc, err := db.NewRedisCache(app.cfg.RedisAddr, app.cfg.RedisPass, app.cfg.RedisDB)
	if err != nil {
		_ = pg.Close()
		return fmt.Errorf("redis init: %w", err)
	}
	app.redis = rc

	// Start background session cleanup.
	go app.cleanupSessions(ctx)

	return nil
}

func (app *Application) cleanupSessions(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			n, err := app.pg.CleanupExpiredSessions(ctx)
			if err != nil {
				app.log.Error("session cleanup", zap.Error(err))
			} else if n > 0 {
				app.log.Info("cleaned expired sessions", zap.Int("count", n))
			}
			// Also purge stale Redis sessions.
			app.redis.PurgeStaleSessions(ctx)
		}
	}
}

func maskDSN(dsn string) string {
	parts := strings.Split(dsn, "://")
	if len(parts) != 2 {
		return "***"
	}
	return parts[0] + "://***:***@..."
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

func jsonOK(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func jsonError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// ---------------------------------------------------------------------------
// USSD State Machine — core flow
// ---------------------------------------------------------------------------

// processInput drives the USSD state machine.  It reads the current session
// state and the user's input, transitions to the next state, and returns the
// USSD response.
func (app *Application) processInput(ctx context.Context, sess *models.SessionData, input string) (models.USSDResponse, error) {
	input = strings.TrimSpace(strings.ToUpper(input))

	// Session timeout check
	if time.Now().After(sess.ExpiresAt) {
		return models.USSDResponse{
			Text:         "Session expired. Dial *384*100# to start again.",
			CloseSession: true,
			Action:       "end",
		}, nil
	}

	// Refresh TTL
	_ = app.redis.TouchSession(ctx, sess.SessionID)
	sess.ExpiresAt = time.Now().Add(180 * time.Second)

	switch sess.State {
	case "main_menu":
		return app.stateMainMenu(sess, input)
	case "product_enroll":
		return app.stateProductEnroll(sess, input)
	case "product_confirm":
		return app.stateProductConfirm(sess, input)
	case "enroll_complete":
		return models.USSDResponse{
			Text:         "Enrollment complete! Reference: " + sess.Data["reference"].(string) + "\nYou will receive a confirmation within 24 hours.",
			CloseSession: true,
			Action:       "end",
		}, nil
	case "agent_menu":
		return app.stateAgentMenu(sess, input)
	case "agent_register_name":
		return app.stateAgentRegisterName(sess, input)
	case "agent_register_state":
		return app.stateAgentRegisterState(sess, input)
	case "agent_register_lga":
		return app.stateAgentRegisterLGA(sess, input)
	case "agent_register_bank":
		return app.stateAgentRegisterBank(sess, input)
	case "agent_register_confirm":
		return app.stateAgentRegisterConfirm(sess, input)
	case "agent_register_complete":
		return app.stateAgentRegisterComplete(sess, input)
	case "agent_float_input":
		return app.stateAgentFloatInput(sess, input)
	case "agent_pin_enter":
		return app.stateAgentPINEnter(sess, input)
	case "agent_pin_set":
		return app.stateAgentPINSet(sess, input)
	case "agent_pin_set_confirm":
		return app.stateAgentPINSetConfirm(sess, input)
	case "agent_float_confirm":
		return app.stateAgentFloatConfirm(sess, input)
	case "agent_float_complete":
		return app.stateAgentFloatComplete(sess, input)
	case "agent_details":
		return app.stateAgentDetails(sess, input)
	case "claim_status_input":
		return app.stateClaimStatusInput(sess, input)
	case "claim_status_result":
		return app.stateClaimStatusResult(sess, input)
	case "end":
		return models.USSDResponse{
			Text:         "Thank you for using NGApp Insurance. Goodbye!",
			CloseSession: true,
			Action:       "end",
		}, nil
	default:
		return models.USSDResponse{
			Text:         "Error: Invalid state. Dial *384*100# to restart.",
			CloseSession: true,
			Action:       "end",
		}, nil
	}
}

// -- State: main menu --------------------------------------------------------

func (app *Application) stateMainMenu(sess *models.SessionData, input string) (models.USSDResponse, error) {
	switch input {
	case "1":
		sess.State = "product_enroll"
		sess.Data["product_id"] = "life"
		sess.Data["field_index"] = 0
		sess.Data["collected_data"] = map[string]string{}
		return app.renderProductField(sess), nil
	case "2":
		sess.State = "product_enroll"
		sess.Data["product_id"] = "health"
		sess.Data["field_index"] = 0
		sess.Data["collected_data"] = map[string]string{}
		return app.renderProductField(sess), nil
	case "3":
		sess.State = "product_enroll"
		sess.Data["product_id"] = "motor"
		sess.Data["field_index"] = 0
		sess.Data["collected_data"] = map[string]string{}
		return app.renderProductField(sess), nil
	case "4":
		sess.State = "product_enroll"
		sess.Data["product_id"] = "micro"
		sess.Data["field_index"] = 0
		sess.Data["collected_data"] = map[string]string{}
		return app.renderProductField(sess), nil
	case "5":
		sess.State = "agent_menu"
		return models.USSDResponse{
			Text:         "AGENT SERVICES\n1. Register as Agent\n2. Float Insurance Claim\n3. My Agent Details\n0. Back to Main Menu\n\nEnter your choice:",
			CloseSession: false,
			Action:       "menu",
		}, nil
	case "6":
		sess.State = "claim_status_input"
		return models.USSDResponse{
			Text:         "Enter your transaction reference ID (e.g. TXN-xxxxxxxx):",
			CloseSession: false,
			Action:       "continue",
		}, nil
	case "0":
		sess.State = "end"
		return models.USSDResponse{
			Text:         "Thank you for using NGApp Insurance. Goodbye!",
			CloseSession: true,
			Action:       "end",
		}, nil
	default:
		return models.USSDResponse{
			Text:   "Welcome to NGApp Insurance\n1. Life Insurance\n2. Health Insurance\n3. Motor Insurance\n4. Micro-insurance\n5. Agent Services\n6. Claim Status\n\nEnter your choice:",
			Action: "menu",
		}, nil
	}
}

// -- State: product enrollment -----------------------------------------------

// renderProductField returns the prompt for the current enrollment field.
func (app *Application) renderProductField(sess *models.SessionData) models.USSDResponse {
	productID := sess.Data["product_id"].(string)
	product := models.GetProductByID(productID)
	if product == nil {
		return models.USSDResponse{
			Text:         "Error: Unknown product.",
			CloseSession: true,
			Action:       "end",
		}
	}

	fieldIndex := int(sess.Data["field_index"].(float64))
	if fieldIndex >= len(product.EnrollmentFields) {
		// All fields collected — show confirmation.
		sess.State = "product_confirm"
		return app.renderProductConfirm(sess)
	}

	field := product.EnrollmentFields[fieldIndex]
	fieldLabel := formatFieldName(field)

	return models.USSDResponse{
		Text:         fmt.Sprintf("%s\n\n%s", product.Name+"\n"+product.Description, fieldLabel),
		CloseSession: false,
		Action:       "continue",
	}
}

// formatFieldName converts internal field names to user-friendly labels.
func formatFieldName(field string) string {
	switch field {
	case "full_name":
		return "Enter your full name:"
	case "date_of_birth":
		return "Enter your date of birth (DD-MM-YYYY):"
	case "gender":
		return "Enter your gender (M/F):"
	case "id_type":
		return "Select ID type:\n1. NIN\n2. Voter's Card\n3. International Passport\n4. Driver's License\n5. PHCN Card\n\nEnter choice:"
	case "id_number":
		return "Enter your ID number:"
	case "coverage_amount":
		return "Enter coverage amount in Naira:"
	case "plan_type":
		return "Select plan type:\n1. Basic\n2. Standard\n3. Premium\n\nEnter choice:"
	case "dependents":
		return "Number of dependents to cover:"
	case "vehicle_type":
		return "Enter vehicle type (e.g. Sedan, SUV, Van):"
	case "vehicle_make":
		return "Enter vehicle make (e.g. Toyota, Honda):"
	case "vehicle_year":
		return "Enter vehicle year (e.g. 2023):"
	case "vehicle_number":
		return "Enter vehicle registration number:"
	case "bvn_or_nin":
		return "Enter your BVN or NIN:"
	case "product_type":
		return "Select micro-insurance type:\n1. Farmer\n2. Artisan\n3. Market Trader\n\nEnter choice:"
	case "bank_name":
		return "Enter your bank name:"
	case "account_number":
		return "Enter your bank account number:"
	default:
		return "Enter " + field + ":"
	}
}

func (app *Application) stateProductEnroll(sess *models.SessionData, input string) (models.USSDResponse, error) {
	// Store the collected input.
	productID := sess.Data["product_id"].(string)
	product := models.GetProductByID(productID)
	if product == nil {
		sess.State = "end"
		return models.USSDResponse{
			Text:         "Error: Unknown product.",
			CloseSession: true,
			Action:       "end",
		}, nil
	}

	collected, ok := sess.Data["collected_data"].(map[string]string)
	if !ok {
		collected = map[string]string{}
		sess.Data["collected_data"] = collected
	}

	fieldIndex := int(sess.Data["field_index"].(float64))
	if fieldIndex >= len(product.EnrollmentFields) {
		// Shouldn't happen — should have moved to confirmation.
		sess.State = "product_confirm"
		return app.renderProductConfirm(sess), nil
	}

	currentField := product.EnrollmentFields[fieldIndex]
	collected[currentField] = strings.TrimSpace(input)
	sess.Data["collected_data"] = collected

	// Check for cancellation.
	if strings.ToUpper(input) == "0" || input == "BACK" {
		return models.USSDResponse{
			Text:         "Enrollment cancelled. Returning to main menu.",
			CloseSession: false,
			Action:       "continue",
		}, nil
	}

	// Advance to next field.
	sess.Data["field_index"] = float64(fieldIndex + 1)

	// Check if we've collected all fields.
	nextIndex := int(sess.Data["field_index"].(float64))
	if nextIndex >= len(product.EnrollmentFields) {
		sess.State = "product_confirm"
		return app.renderProductConfirm(sess), nil
	}

	return app.renderProductField(sess), nil
}

// renderProductConfirm shows a summary for user confirmation.
func (app *Application) renderProductConfirm(sess *models.SessionData) models.USSDResponse {
	productID := sess.Data["product_id"].(string)
	product := models.GetProductByID(productID)
	if product == nil {
		return models.USSDResponse{
			Text:         "Error: Unknown product.",
			CloseSession: true,
			Action:       "end",
		}
	}

	collected, _ := sess.Data["collected_data"].(map[string]string)

	var sb strings.Builder
	sb.WriteString("Please confirm your enrollment:\n\n")
	sb.WriteString(fmt.Sprintf("Product: %s\n", product.Name))
	for k, v := range collected {
		sb.WriteString(fmt.Sprintf("%s: %s\n", formatFieldName(k), v))
	}
	sb.WriteString("\n1. Confirm\n0. Cancel")

	sess.Data["summary"] = sb.String()

	return models.USSDResponse{
		Text:         sb.String(),
		CloseSession: false,
		Action:       "confirm",
	}
}

// renderAgentRegisterConfirm shows a summary for agent registration confirmation.
func (app *Application) renderAgentRegisterConfirm(sess *models.SessionData) models.USSDResponse {
	collected := []string{
		fmt.Sprintf("Name: %s", sess.Data["agent_name"].(string)),
		fmt.Sprintf("State: %s", sess.Data["agent_state"].(string)),
		fmt.Sprintf("LGA: %s", sess.Data["agent_lga"].(string)),
		fmt.Sprintf("Bank: %s", sess.Data["agent_bank_name"].(string)),
		fmt.Sprintf("Account: %s", sess.Data["agent_bank_account"].(string)),
	}

	var sb strings.Builder
	sb.WriteString("Please confirm your registration:\n\n")
	for _, line := range collected {
		sb.WriteString(line + "\n")
	}
	sb.WriteString("\n1. Confirm\n0. Cancel")

	return models.USSDResponse{
		Text:         sb.String(),
		CloseSession: false,
		Action:       "confirm",
	}
}

// renderAgentFloatConfirm shows a summary for the float claim confirmation.
func (app *Application) renderAgentFloatConfirm(sess *models.SessionData) models.USSDResponse {
	amount := sess.Data["claim_amount"].(float64)
	balanceBefore := sess.Data["claim_balance_before"].(float64)

	var sb strings.Builder
	sb.WriteString("FLOAT CLAIM SUMMARY\n\n")
	sb.WriteString(fmt.Sprintf("Current balance: ₦%s\n", formatCurrency(balanceBefore)))
	sb.WriteString(fmt.Sprintf("Claim amount:  ₦%s\n", formatCurrency(amount)))
	sb.WriteString(fmt.Sprintf("New balance:   ₦%s\n\n", formatCurrency(balanceBefore-amount)))
	sb.WriteString("1. Confirm\n0. Cancel")

	return models.USSDResponse{
		Text:         sb.String(),
		CloseSession: false,
		Action:       "confirm",
	}
}

func (app *Application) stateProductConfirm(sess *models.SessionData, input string) (models.USSDResponse, error) {
	if isCancelInput(input) {
		// Restart enrollment from beginning.
		sess.State = "product_enroll"
		sess.Data["field_index"] = 0
		sess.Data["collected_data"] = map[string]string{}
		return app.renderProductField(sess), nil
	}

	// NG-1: ONLY an explicit "1" confirms. Any other input re-prompts so a
	// typo or ambiguous callback payload cannot trigger enrollment.
	if !isConfirmInput(input) {
		summary, _ := sess.Data["summary"].(string)
		if summary == "" {
			summary = "1. Confirm\n0. Cancel"
		}
		return models.USSDResponse{
			Text:         "Invalid input.\n\n" + summary,
			CloseSession: false,
			Action:       "confirm",
		}, nil
	}

	// Create the enrollment transaction.
	productID := sess.Data["product_id"].(string)
	product := models.GetProductByID(productID)
	if product == nil {
		sess.State = "end"
		return models.USSDResponse{
			Text:         "Error: Unknown product.",
			CloseSession: true,
			Action:       "end",
		}, nil
	}

	collected, _ := sess.Data["collected_data"].(map[string]string)

	// Parse coverage amount for premium calculation.
	var amount float64
	if raw, ok := collected["coverage_amount"]; ok {
		amount, _ = strconv.ParseFloat(strings.ReplaceAll(raw, ",", ""), 64)
	}
	if amount == 0 {
		amount = product.MinPremium
	}

	txn := &models.TransactionRecord{
		SessionID:   sess.SessionID,
		PhoneNumber: sess.PhoneNumber,
		Type:        models.TransactionTypeEnrollment,
		ProductID:   productID,
		Amount:      amount,
		Status:      "pending",
	}

	ctx := context.Background()
	// NG-1: idempotency key on (session base, type, product) — telco callback
	// redelivery or post-drop resume dedups to the original pending txn.
	idemKey := fmt.Sprintf("enroll:%s:%s", idempotencyBase(sess), productID)
	txn, dup, err := app.pg.CreateTransactionIdempotent(ctx, txn, idemKey)
	if err != nil {
		app.log.Error("create transaction", zap.Error(err))
		sess.State = "end"
		return models.USSDResponse{
			Text:         "Processing failed. Please try again later.",
			CloseSession: true,
			Action:       "end",
		}, nil
	}
	if dup {
		app.log.Info("duplicate enrollment callback deduplicated",
			zap.String("idempotency_key", idemKey), zap.String("reference", txn.Reference))
	}

	// Store reference for display.
	sess.Data["reference"] = txn.Reference
	sess.State = "enroll_complete"

	// Update agent policy count if associated with an agent.
	if agentPhone, _ := sess.Data["agent_phone"].(string); agentPhone != "" {
		if agent, _ := app.pg.GetAgentByPhone(ctx, agentPhone); agent != nil {
			_ = app.pg.IncrementPolicies(ctx, agent.ID)
		}
	}

	return models.USSDResponse{
		Text:         "Enrollment complete! Reference: " + txn.Reference + "\nYou will receive a confirmation within 24 hours.",
		CloseSession: true,
		Action:       "end",
	}, nil
}

// -- State: agent menu -------------------------------------------------------

func (app *Application) stateAgentMenu(sess *models.SessionData, input string) (models.USSDResponse, error) {
	switch input {
	case "1":
		sess.State = "agent_register_name"
		return models.USSDResponse{
			Text:         "AGENT REGISTRATION\nStep 1/5\nEnter your full name:",
			CloseSession: false,
			Action:       "continue",
		}, nil
	case "2":
		// Check if user is a registered agent.
		agent, _ := app.pg.GetAgentByPhone(context.Background(), sess.PhoneNumber)
		if agent == nil {
			return models.USSDResponse{
				Text:         "You are not registered as an agent. Please register first (option 1).",
				CloseSession: false,
				Action:       "continue",
			}, nil
		}
		// G3 (audit #9): only APPROVED (active) agents may reach financial ops.
		// A pending/suspended agent holding a valid MSISDN (or even a valid
		// PIN) must not cash out.
		if agent.Status != models.AgentStatusActive {
			return models.USSDResponse{
				Text:         "Your agent account is " + agent.Status + ". Float services are available once your account is approved.",
				CloseSession: true,
				Action:       "end",
			}, nil
		}
		sess.Data["agent_id"] = agent.ID
		// USSD identity: float claim (cash-out) requires PIN verification.
		pinState, err := app.pg.GetAgentPINState(context.Background(), agent.ID)
		if err != nil {
			app.log.Error("pin state lookup", zap.Error(err))
			return models.USSDResponse{
				Text:         "Service unavailable. Please try again later.",
				CloseSession: true,
				Action:       "end",
			}, nil
		}
		if msg, blocked := app.financialOpsBlocked(pinState); blocked {
			return models.USSDResponse{Text: msg, CloseSession: true, Action: "end"}, nil
		}
		if pinState.PINHash == "" {
			sess.State = "agent_pin_set"
			return models.USSDResponse{
				Text:         "Set a 4-6 digit PIN to secure your float account.\nEnter new PIN:",
				CloseSession: false,
				Action:       "continue",
			}, nil
		}
		sess.State = "agent_pin_enter"
		return models.USSDResponse{
			Text:         "Enter your agent PIN to continue:",
			CloseSession: false,
			Action:       "continue",
		}, nil
	case "3":
		agent, _ := app.pg.GetAgentByPhone(context.Background(), sess.PhoneNumber)
		if agent == nil {
			return models.USSDResponse{
				Text:         "You are not registered as an agent.",
				CloseSession: false,
				Action:       "continue",
			}, nil
		}
		sess.State = "agent_details"
		sess.Data["agent_id"] = agent.ID
		return models.USSDResponse{
			Text: fmt.Sprintf("AGENT DETAILS\nName: %s\nState: %s\nLGA: %s\nStatus: %s\nFloat Balance: ₦%s\nPolicies Sold: %d\n0. Back",
				agent.Name, agent.State, agent.LGA, agent.Status,
				formatCurrency(agent.FloatBalance), agent.TotalPolicies),
			CloseSession: false,
			Action:       "menu",
		}, nil
	case "0":
		sess.State = "main_menu"
		resp, _ := app.stateMainMenu(sess, "")
		return resp, nil
	default:
		return models.USSDResponse{
			Text:         "AGENT SERVICES\n1. Register as Agent\n2. Float Insurance Claim\n3. My Agent Details\n0. Back to Main Menu\n\nEnter your choice:",
			CloseSession: false,
			Action:       "menu",
		}, nil
	}
}

// -- State: agent registration flow ------------------------------------------

func (app *Application) stateAgentRegisterName(sess *models.SessionData, input string) (models.USSDResponse, error) {
	if strings.TrimSpace(input) == "" {
		return models.USSDResponse{
			Text:         "Name cannot be empty.\nEnter your full name:",
			CloseSession: false,
			Action:       "continue",
		}, nil
	}
	sess.Data["agent_name"] = strings.TrimSpace(input)
	sess.State = "agent_register_state"
	return models.USSDResponse{
		Text:         "Step 2/5\nEnter your state:",
		CloseSession: false,
		Action:       "continue",
	}, nil
}

func (app *Application) stateAgentRegisterState(sess *models.SessionData, input string) (models.USSDResponse, error) {
	if strings.TrimSpace(input) == "" {
		return models.USSDResponse{
			Text:         "State cannot be empty.\nEnter your state:",
			CloseSession: false,
			Action:       "continue",
		}, nil
	}
	sess.Data["agent_state"] = strings.TrimSpace(titleASCII(strings.ToLower(input)))
	sess.State = "agent_register_lga"
	return models.USSDResponse{
		Text:         "Step 3/5\nEnter your LGA:",
		CloseSession: false,
		Action:       "continue",
	}, nil
}

func (app *Application) stateAgentRegisterLGA(sess *models.SessionData, input string) (models.USSDResponse, error) {
	if strings.TrimSpace(input) == "" {
		return models.USSDResponse{
			Text:         "LGA cannot be empty.\nEnter your LGA:",
			CloseSession: false,
			Action:       "continue",
		}, nil
	}
	sess.Data["agent_lga"] = strings.TrimSpace(input)
	sess.State = "agent_register_bank"
	return models.USSDResponse{
		Text:         "Step 4/5\nEnter your bank account number:",
		CloseSession: false,
		Action:       "continue",
	}, nil
}

func (app *Application) stateAgentRegisterBank(sess *models.SessionData, input string) (models.USSDResponse, error) {
	input = strings.TrimSpace(input)
	// G3 (audit #11): strict NUBAN format — exactly 10 digits. Previously ANY
	// numeric string was accepted ("here we accept any numeric input"), so an
	// attacker-controlled settlement destination was stored from day one.
	// Format validation is the only automated check available in-band; the
	// account stays UNVERIFIED and the agent remains pending until back-office
	// name-enquiry confirms ownership before activation.
	if !nubanFormat(input) {
		return models.USSDResponse{
			Text:         "Invalid account number. Enter your 10-digit NUBAN account number:",
			CloseSession: false,
			Action:       "continue",
		}, nil
	}
	sess.Data["agent_bank_account"] = input
	// Best-effort bank name lookup from a small mapping; fallback to generic.
	sess.Data["agent_bank_name"] = lookupBankByNumber(input)
	sess.State = "agent_register_confirm"
	return app.renderAgentRegisterConfirm(sess), nil
}

// nubanFormat reports whether s is exactly 10 ASCII digits (NUBAN length).
func nubanFormat(s string) bool {
	if len(s) != 10 {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func (app *Application) stateAgentRegisterConfirm(sess *models.SessionData, input string) (models.USSDResponse, error) {
	if isCancelInput(input) {
		sess.State = "agent_menu"
		return models.USSDResponse{
			Text:         "Registration cancelled. Returning to Agent Services.",
			CloseSession: false,
			Action:       "continue",
		}, nil
	}

	// NG-1: only explicit "1" confirms registration.
	if !isConfirmInput(input) {
		return models.USSDResponse{
			Text:         "Invalid input. Reply 1 to Confirm or 0 to Cancel.",
			CloseSession: false,
			Action:       "confirm",
		}, nil
	}

	// G3 (audit #9/#12): enrollment requires a PIN (F4 salted+peppered infra),
	// so fail BEFORE persisting anything when PIN hashing is impossible.
	if app.cfg.PINPepper == "" {
		app.log.Error("agent enrollment aborted: PIN_PEPPER not configured")
		sess.State = "end"
		return models.USSDResponse{
			Text:         "Registration is temporarily unavailable. Please try again later.",
			CloseSession: true,
			Action:       "end",
		}, nil
	}

	// Persist the agent.
	agent := &models.AgentAccount{
		PhoneNumber:   sess.PhoneNumber,
		Name:          sess.Data["agent_name"].(string),
		State:         sess.Data["agent_state"].(string),
		LGA:           sess.Data["agent_lga"].(string),
		BankAccount:   sess.Data["agent_bank_account"].(string),
		BankName:      sess.Data["agent_bank_name"].(string),
		Status:        models.AgentStatusPending,
		FloatBalance:  0,
		TotalPolicies: 0,
	}

	ctx := context.Background()
	agent, err := app.pg.CreateAgentAccount(ctx, agent)
	if err != nil {
		app.log.Error("create agent", zap.Error(err))
		sess.State = "end"
		return models.USSDResponse{
			Text:         "Registration failed. Please try again later.",
			CloseSession: true,
			Action:       "end",
		}, nil
	}

	// G3 (audit #9): NO immediate activation. The agent stays PENDING until
	// back-office verification (bank name-enquiry + KYC) approves it; a USSD
	// session must never be able to self-activate. Activation happens only
	// through the gated admin paths on the platform side.
	sess.Data["agent_id"] = agent.ID
	sess.Data["agent_phone"] = agent.PhoneNumber
	sess.Data["reference"] = "AGT-" + agent.ID[:8]

	sess.Data["pin_context"] = "enroll"
	sess.State = "agent_pin_set"
	return models.USSDResponse{
		Text:         "Almost done. Set a 4-6 digit PIN to secure your agent account.\nEnter new PIN:",
		CloseSession: false,
		Action:       "continue",
	}, nil
}

func (app *Application) stateAgentRegisterComplete(sess *models.SessionData, input string) (models.USSDResponse, error) {
	// This state is reached only after a completion screen; just end the session.
	sess.State = "end"
	return models.USSDResponse{
		Text:         "Thank you! Goodbye.",
		CloseSession: true,
		Action:       "end",
	}, nil
}

// -- State: agent float claim ------------------------------------------------

func (app *Application) stateAgentFloatInput(sess *models.SessionData, input string) (models.USSDResponse, error) {
	input = strings.TrimSpace(input)

	agentID := sess.Data["agent_id"].(string)
	balance, _ := app.pg.GetAgentBalance(context.Background(), agentID)

	amount, err := strconv.ParseFloat(strings.ReplaceAll(input, ",", ""), 64)
	if err != nil || amount <= 0 {
		return models.USSDResponse{
			Text:         "Please enter a valid amount in Naira:",
			CloseSession: false,
			Action:       "continue",
		}, nil
	}

	if amount > balance {
		return models.USSDResponse{
			Text:         fmt.Sprintf("Insufficient float balance. Available: ₦%s\n\nEnter claim amount:", formatCurrency(balance)),
			CloseSession: false,
			Action:       "continue",
		}, nil
	}

	// Store amount and move to confirmation.
	sess.Data["claim_amount"] = amount
	sess.Data["claim_balance_before"] = balance
	sess.State = "agent_float_confirm"
	return app.renderAgentFloatConfirm(sess), nil
}

func (app *Application) stateAgentFloatConfirm(sess *models.SessionData, input string) (models.USSDResponse, error) {
	if isCancelInput(input) {
		sess.State = "agent_menu"
		return models.USSDResponse{
			Text:         "Claim cancelled.",
			CloseSession: false,
			Action:       "continue",
		}, nil
	}

	// NG-1: only explicit "1" confirms; anything else re-prompts.
	if !isConfirmInput(input) {
		return models.USSDResponse{
			Text:         "Invalid input. Reply 1 to Confirm or 0 to Cancel.",
			CloseSession: false,
			Action:       "confirm",
		}, nil
	}

	// PIN must have been verified in this session (fail-closed).
	if pinOK, _ := sess.Data["pin_verified"].(bool); !pinOK {
		sess.State = "agent_menu"
		return models.USSDResponse{
			Text:         "PIN verification required before float claims. Start again from Agent Services.",
			CloseSession: false,
			Action:       "continue",
		}, nil
	}

	amount := sess.Data["claim_amount"].(float64)
	agentID := sess.Data["agent_id"].(string)
	ctx := context.Background()

	// NG-4: atomic conditional deduction — the balance check and the debit
	// happen in ONE SQL statement, so concurrent/duplicate confirms cannot
	// both pass the balance check. Fail-closed on any error.
	newBalance, err := app.pg.DeductAgentBalance(ctx, agentID, amount)
	if err != nil {
		if err == db.ErrInsufficientFloat {
			balance, _ := app.pg.GetAgentBalance(ctx, agentID)
			sess.State = "agent_float_input"
			return models.USSDResponse{
				Text:         fmt.Sprintf("Insufficient float balance. Available: ₦%s\n\nEnter claim amount:", formatCurrency(balance)),
				CloseSession: false,
				Action:       "continue",
			}, nil
		}
		app.log.Error("float deduction failed", zap.Error(err))
		sess.State = "end"
		return models.USSDResponse{
			Text:         "Processing failed. No funds were deducted. Please try again later.",
			CloseSession: true,
			Action:       "end",
		}, nil
	}

	// Record the transaction (idempotent on session+amount).
	txn := &models.TransactionRecord{
		SessionID:   sess.SessionID,
		PhoneNumber: sess.PhoneNumber,
		Type:        models.TransactionTypeFloatClaim,
		ProductID:   "float_claim",
		Amount:      amount,
		Status:      "completed",
	}
	idemKey := fmt.Sprintf("float:%s:%s:%s", idempotencyBase(sess), agentID, strconv.FormatFloat(amount, 'f', 2, 64))
	txn, _, err = app.pg.CreateTransactionIdempotent(ctx, txn, idemKey)
	if err != nil {
		app.log.Error("float claim txn", zap.Error(err))
	}
	reference := "PENDING"
	if txn != nil {
		reference = txn.Reference
	}

	sess.Data["reference"] = reference
	sess.Data["new_balance"] = newBalance
	sess.State = "agent_float_complete"

	return models.USSDResponse{
		Text:         fmt.Sprintf("Float claim of ₦%s processed successfully!\nNew balance: ₦%s\nReference: %s", formatCurrency(amount), formatCurrency(newBalance), reference),
		CloseSession: true,
		Action:       "end",
	}, nil
}

func (app *Application) stateAgentFloatComplete(sess *models.SessionData, input string) (models.USSDResponse, error) {
	sess.State = "end"
	return models.USSDResponse{
		Text:         "Thank you. Goodbye.",
		CloseSession: true,
		Action:       "end",
	}, nil
}

// -- State: agent details display --------------------------------------------

func (app *Application) stateAgentDetails(sess *models.SessionData, input string) (models.USSDResponse, error) {
	agentID := sess.Data["agent_id"].(string)
	ctx := context.Background()
	agent, err := app.pg.GetAgentByID(ctx, agentID)
	if err != nil || agent == nil {
		return models.USSDResponse{
			Text:         "Could not retrieve agent details.",
			CloseSession: false,
			Action:       "continue",
		}, nil
	}

	sess.State = "agent_details" // Stay in this state.
	return models.USSDResponse{
		Text: fmt.Sprintf("AGENT DETAILS\nName: %s\nState: %s\nLGA: %s\nStatus: %s\nFloat Balance: ₦%s\nPolicies Sold: %d\n\n0. Back to Agent Services",
			agent.Name, agent.State, agent.LGA, agent.Status,
			formatCurrency(agent.FloatBalance), agent.TotalPolicies),
		CloseSession: false,
		Action:       "menu",
	}, nil
}

// -- State: claim status lookup ----------------------------------------------

func (app *Application) stateClaimStatusInput(sess *models.SessionData, input string) (models.USSDResponse, error) {
	input = strings.TrimSpace(input)
	if input == "" {
		return models.USSDResponse{
			Text:         "Please enter a reference ID (e.g. TXN-xxxxxxxx):",
			CloseSession: false,
			Action:       "continue",
		}, nil
	}
	// Accept both "TXN-..." and plain hex IDs.
	txn, _ := app.pg.GetTransactionByReference(context.Background(), input)
	if txn == nil {
		// Try as plain ID.
		txn, _ = app.pg.GetTransactionByReference(context.Background(), "TXN-"+input)
	}
	if txn == nil {
		return models.USSDResponse{
			Text:         "No transaction found with reference: " + input + "\n\nPlease try again or dial 0 to go back.",
			CloseSession: false,
			Action:       "continue",
		}, nil
	}

	sess.State = "claim_status_result"
	sess.Data["reference"] = txn.Reference
	sess.Data["status"] = txn.Status

	// Map product ID to a human-readable name.
	productName := "Unknown"
	if p := models.GetProductByID(txn.ProductID); p != nil {
		productName = p.Name
	}

	return models.USSDResponse{
		Text: fmt.Sprintf("TRANSACTION STATUS\nReference: %s\nProduct: %s\nAmount: ₦%s\nStatus: %s\nDate: %s\n\n0. Check Another\n00. Main Menu",
			txn.Reference, productName, formatCurrency(txn.Amount), txn.Status,
			txn.CreatedAt.Format("02-Jan-2006 15:04")),
		CloseSession: false,
		Action:       "menu",
	}, nil
}

func (app *Application) stateClaimStatusResult(sess *models.SessionData, input string) (models.USSDResponse, error) {
	switch input {
	case "0":
		sess.State = "claim_status_input"
		return models.USSDResponse{
			Text:         "Enter another reference ID:",
			CloseSession: false,
			Action:       "continue",
		}, nil
	case "00":
		sess.State = "main_menu"
		resp, _ := app.stateMainMenu(sess, "")
		return resp, nil
	default:
		sess.State = "claim_status_input"
		return models.USSDResponse{
			Text:         "Enter another reference ID:",
			CloseSession: false,
			Action:       "continue",
		}, nil
	}
}

// ---------------------------------------------------------------------------
// Rate limiter (thin wrapper around Redis)
// ---------------------------------------------------------------------------

func (app *Application) isRateLimited(phone string) bool {
	ctx := context.Background()
	return app.redis.IsRateLimited(ctx, phone)
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

// handleUSSD processes incoming USSD payloads from the mobile network operator.
func (app *Application) handleUSSD(w http.ResponseWriter, r *http.Request) {
	var req models.USSDRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	ctx := r.Context()
	app.log.Info("ussd request",
		zap.String("session_id", req.SessionID),
		zap.String("phone", req.PhoneNumber),
		zap.String("input", req.Message),
		zap.Int("step", req.Step),
	)

	// Rate limit check.
	if app.isRateLimited(req.PhoneNumber) {
		app.log.Warn("rate limit exceeded", zap.String("phone", req.PhoneNumber))
		jsonOK(w, http.StatusOK, map[string]interface{}{
			"session_id":  req.SessionID,
			"response":    "Too many requests. Please wait a moment.",
			"end_session": false,
		})
		return
	}

	// Get or create session.
	sess, err := app.getOrCreateSession(ctx, &req)
	if err != nil {
		app.log.Error("session error", zap.Error(err))
		jsonError(w, http.StatusInternalServerError, "session error")
		return
	}

	// Process input through state machine.
	resp, err := app.processInput(ctx, sess, req.Message)
	if err != nil {
		app.log.Error("process input", zap.Error(err))
		jsonError(w, http.StatusInternalServerError, "processing error")
		return
	}

	// Persist updated session.
	if err := app.saveSession(ctx, sess); err != nil {
		app.log.Error("save session", zap.Error(err))
		// Continue anyway — session is in Redis too.
	}

	jsonOK(w, http.StatusOK, map[string]interface{}{
		"session_id":  sess.SessionID,
		"response":    resp.Text,
		"end_session": resp.CloseSession,
		"action":      resp.Action,
	})
}

// getOrCreateSession loads an existing session from Redis/Postgres or creates
// a new one.
func (app *Application) getOrCreateSession(ctx context.Context, req *models.USSDRequest) (*models.SessionData, error) {
	sess, err := app.redis.GetSession(ctx, req.SessionID)
	if err != nil {
		return nil, err
	}
	if sess != nil {
		// NG-3: Redis holds the freshest copy (writes go Redis-first); only
		// fall back to Postgres when Redis has no record.
		return sess, nil
	}

	// Redis miss: try Postgres copy of this session ID.
	if pgSession, _ := app.pg.GetSessionState(ctx, req.SessionID); pgSession != nil {
		return pgSession, nil
	}

	// NG-2: session drop recovery — the telco issued a new SessionID. Look up
	// the phone's most recent live session; if it sits in a resumable
	// mid-transaction state, resume it under the new SessionID instead of
	// silently restarting at the main menu.
	if prior, _ := app.pg.GetLatestSessionByPhone(ctx, req.PhoneNumber); prior != nil && resumableStates[prior.State] {
		app.log.Info("resuming dropped session",
			zap.String("old_session_id", prior.SessionID),
			zap.String("new_session_id", req.SessionID),
			zap.String("state", prior.State),
		)
		resumed := &models.SessionData{
			SessionID:   req.SessionID,
			PhoneNumber: req.PhoneNumber,
			State:       prior.State,
			Data:        prior.Data,
			ExpiresAt:   time.Now().Add(180 * time.Second),
		}
		if resumed.Data == nil {
			resumed.Data = make(map[string]interface{})
		}
		resumed.Data["idempotency_base"] = prior.SessionID
		resumed.Data["resumed"] = true
		if err := app.saveSession(ctx, resumed); err != nil {
			return nil, err
		}
		return resumed, nil
	}

	// Create a new session.
	sess = &models.SessionData{
		SessionID:   req.SessionID,
		PhoneNumber: req.PhoneNumber,
		State:       "main_menu",
		Data:        make(map[string]interface{}),
		ExpiresAt:   time.Now().Add(180 * time.Second),
	}
	if err := app.saveSession(ctx, sess); err != nil {
		return nil, err
	}
	return sess, nil
}

// saveSession persists a session to both Redis and Postgres.
func (app *Application) saveSession(ctx context.Context, sess *models.SessionData) error {
	if err := app.redis.StoreSession(ctx, sess); err != nil {
		return err
	}
	if app.pg != nil {
		_ = app.pg.SaveSessionState(ctx, sess.SessionID, sess.PhoneNumber, sess.State, sess.Data, 180*time.Second)
	}
	return nil
}

// handleHealth returns the health status of the service and its dependencies.
func (app *Application) handleHealth(w http.ResponseWriter, r *http.Request) {
	deps := make(map[string]string)
	deps["database"] = "unknown"
	deps["redis"] = "unknown"

	status := "healthy"

	if app.pg != nil {
		if err := app.pg.Ping(); err != nil {
			status = "degraded"
			deps["database"] = "unhealthy: " + err.Error()
		} else {
			deps["database"] = "healthy"
		}
	}

	if app.redis != nil {
		if err := app.redis.Ping(); err != nil {
			status = "degraded"
			deps["redis"] = "unhealthy: " + err.Error()
		} else {
			deps["redis"] = "healthy"
		}
	}

	jsonOK(w, http.StatusOK, map[string]interface{}{
		"status":       status,
		"service":      "ussd-gateway",
		"uptime":       time.Since(startTime).Round(time.Second).String(),
		"timestamp":    time.Now().UTC().Format(time.RFC3339),
		"dependencies": deps,
	})
}

// handleAgentRegister handles non-USSD agent registration.
func (app *Application) handleAgentRegister(w http.ResponseWriter, r *http.Request) {
	var reg struct {
		PhoneNumber string `json:"phone_number"`
		Name        string `json:"name"`
		State       string `json:"state"`
		LGA         string `json:"lga"`
		BankAccount string `json:"bank_account"`
		BankName    string `json:"bank_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&reg); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if reg.PhoneNumber == "" || reg.Name == "" || reg.State == "" {
		jsonError(w, http.StatusBadRequest, "phone_number, name, and state are required")
		return
	}

	ctx := context.Background()

	// Check for existing agent.
	existing, _ := app.pg.GetAgentByPhone(ctx, reg.PhoneNumber)
	if existing != nil {
		jsonError(w, http.StatusConflict, "agent already registered with this phone number")
		return
	}

	agent := &models.AgentAccount{
		PhoneNumber:   reg.PhoneNumber,
		Name:          reg.Name,
		State:         reg.State,
		LGA:           reg.LGA,
		BankAccount:   reg.BankAccount,
		BankName:      reg.BankName,
		Status:        models.AgentStatusPending,
		FloatBalance:  0,
		TotalPolicies: 0,
	}

	agent, err := app.pg.CreateAgentAccount(ctx, agent)
	if err != nil {
		app.log.Error("agent registration", zap.Error(err))
		jsonError(w, http.StatusInternalServerError, "failed to register agent")
		return
	}

	// Auto-activate for API-registered agents.
	_ = app.pg.UpdateAgentStatus(ctx, agent.ID, models.AgentStatusActive)

	jsonOK(w, http.StatusCreated, map[string]interface{}{
		"message":      "Agent registered successfully",
		"agent_id":     agent.ID,
		"phone_number": agent.PhoneNumber,
		"status":       agent.Status,
	})
}

// handleAgentByID returns agent details by ID.
func (app *Application) handleAgentByID(w http.ResponseWriter, r *http.Request, id string) {
	ctx := context.Background()
	agent, err := app.pg.GetAgentByID(ctx, id)
	if err != nil || agent == nil {
		jsonError(w, http.StatusNotFound, "agent not found")
		return
	}

	jsonOK(w, http.StatusOK, agent)
}

// handleSessionStatus returns the status of a USSD session.
func (app *Application) handleSessionStatus(w http.ResponseWriter, r *http.Request, sessionID string) {
	ctx := context.Background()

	// Try Redis first.
	sess, err := app.redis.GetSession(ctx, sessionID)
	if err == nil && sess != nil {
		jsonOK(w, http.StatusOK, sess)
		return
	}

	// Fall back to Postgres.
	if app.pg != nil {
		sess, err = app.pg.GetSessionState(ctx, sessionID)
		if err == nil && sess != nil {
			jsonOK(w, http.StatusOK, sess)
			return
		}
	}

	jsonError(w, http.StatusNotFound, "session not found or expired")
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

func (app *Application) router() http.Handler {
	r := chi.NewRouter()

	// Standard middleware.
	r.Use(middleware.RequestID)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Logger)
	r.Use(middleware.Timeout(30 * time.Second))

	// Health check.
	r.Get("/health", app.handleHealth)

	// USSD endpoint (main integration point for MNOs).
	r.Post("/ussd", app.handleUSSD)

	// REST API v1.
	r.Route("/api/v1", func(r chi.Router) {
		// Agent registration.
		r.Post("/register", app.handleAgentRegister)

		// Agent lookup by ID.
		r.Get("/agents/{id}", func(w http.ResponseWriter, r *http.Request) {
			id := chi.URLParam(r, "id")
			app.handleAgentByID(w, r, id)
		})

		// Session status.
		r.Get("/sessions/{id}", func(w http.ResponseWriter, r *http.Request) {
			id := chi.URLParam(r, "id")
			app.handleSessionStatus(w, r, id)
		})
	})

	return r
}

// ---------------------------------------------------------------------------
// Bank name lookup (best-effort for Nigerian banks by account number prefix)
// ---------------------------------------------------------------------------

// lookupBankByNumber returns a bank name based on account number heuristics.
func lookupBankByNumber(acct string) string {
	switch {
	case strings.HasPrefix(acct, "0") || len(acct) == 10:
		// 10-digit Nigerian account numbers; do a few common prefixes.
		switch {
		case strings.HasPrefix(acct, "011"), strings.HasPrefix(acct, "044"):
			return "GTBank"
		case strings.HasPrefix(acct, "033"):
			return "Access Bank"
		case strings.HasPrefix(acct, "050"):
			return "First Bank"
		case strings.HasPrefix(acct, "032"), strings.HasPrefix(acct, "063"):
			return "Zenith Bank"
		case strings.HasPrefix(acct, "062"):
			return "Union Bank"
		case strings.HasPrefix(acct, "070"):
			return "Sterling Bank"
		case strings.HasPrefix(acct, "058"):
			return "Ecobank"
		case strings.HasPrefix(acct, "057"):
			return "Stanbic IBTC"
		case strings.HasPrefix(acct, "074"):
			return "WEMA Bank"
		case strings.HasPrefix(acct, "0333"), strings.HasPrefix(acct, "0444"):
			return "Access Bank"
		default:
			return "Unknown Bank"
		}
	default:
		return "Unknown Bank"
	}
}

// ---------------------------------------------------------------------------
// Currency formatting
// ---------------------------------------------------------------------------

func formatCurrency(amount float64) string {
	return fmt.Sprintf("%.2f", amount)
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

var startTime time.Time

func main() {
	startTime = time.Now()

	cfg := loadConfig()
	logger := newLogger(cfg.LogLevel)
	defer func() { _ = logger.Sync() }()

	app := newApp(cfg, logger)

	// Initialise background services.
	if err := app.start(context.Background()); err != nil {
		logger.Fatal("application startup failed", zap.Error(err))
	}
	logger.Info("dependencies initialised",
		zap.String("database", "connected"),
		zap.String("redis", "connected"),
	)

	// Build the HTTP server.
	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      app.router(),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Run the server in a goroutine so we can handle signals.
	go func() {
		logger.Info("ussd-gateway listening", zap.String("addr", srv.Addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("server error", zap.Error(err))
		}
	}()

	// Wait for termination signal.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("shutting down server...")

	// Graceful shutdown with a timeout.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Fatal("server forced shutdown", zap.Error(err))
	}

	logger.Info("server exited cleanly")
}

// validateQueryParam returns the query parameter value for key, enforcing a
// maximum length. An absent parameter yields an empty string and no error.
func validateQueryParam(r *http.Request, key string, maxLen int) (string, error) {
	val := r.URL.Query().Get(key)
	if len(val) > maxLen {
		return "", fmt.Errorf("parameter %s exceeds max length %d", key, maxLen)
	}
	return val, nil
}

// validateIntParam parses the query parameter for key as an integer. An absent
// parameter yields 0 and no error; a non-integer value yields an error.
func validateIntParam(r *http.Request, key string) (int, error) {
	val := r.URL.Query().Get(key)
	if val == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return 0, fmt.Errorf("parameter %s must be an integer", key)
	}
	return n, nil
}

// titleASCII replaces deprecated strings.Title for the ASCII-only USSD input path
// (strings.Title mishandles Unicode punctuation; x/text/cases would be the
// general replacement but is not yet a module dependency)
func titleASCII(s string) string {
	prevBoundary := true
	b := []byte(s)
	for i, ch := range b {
		isLetter := (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
		if isLetter && prevBoundary && ch >= 'a' && ch <= 'z' {
			b[i] = ch - 32
		}
		prevBoundary = !isLetter
	}
	return string(b)
}

// ---------------------------------------------------------------------------
// F4 audit additions (nigeria.md NG-1..NG-4 + USSD identity)
// ---------------------------------------------------------------------------

// hashPIN derives a salted, peppered SHA-256 hash for a PIN. The salt is the
// agent ID; the pepper is the server-side secret so DB-only leaks are useless.
func hashPIN(pin, agentID, pepper string) string {
	h := sha256.Sum256([]byte("ussd-pin-v1:" + pepper + ":" + agentID + ":" + pin))
	return hex.EncodeToString(h[:])
}

// verifyPIN compares a PIN against its stored hash in constant time.
func verifyPIN(pin, agentID, pepper, expectedHash string) bool {
	if expectedHash == "" || pepper == "" {
		return false
	}
	actual := hashPIN(pin, agentID, pepper)
	return subtle.ConstantTimeCompare([]byte(actual), []byte(expectedHash)) == 1
}

// validPINFormat enforces 4-6 digit numeric PINs.
func validPINFormat(pin string) bool {
	if len(pin) < 4 || len(pin) > 6 {
		return false
	}
	for _, c := range pin {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// isConfirmInput accepts ONLY an explicit "1" as confirmation (NG-1: any
// other non-cancel input must re-prompt, never confirm).
func isConfirmInput(input string) bool {
	return strings.TrimSpace(input) == "1"
}

// isCancelInput detects explicit cancellation input.
func isCancelInput(input string) bool {
	up := strings.ToUpper(strings.TrimSpace(input))
	return up == "0" || up == "BACK" || up == "CANCEL"
}

// resumableStates are states a dropped session can be resumed into under a
// new telco SessionID (NG-2). Terminal/menu states restart cleanly instead.
var resumableStates = map[string]bool{
	"product_enroll":         true,
	"product_confirm":        true,
	"agent_register_name":    true,
	"agent_register_state":   true,
	"agent_register_lga":     true,
	"agent_register_bank":    true,
	"agent_register_confirm": true,
	"agent_float_input":      true,
	"agent_float_confirm":    true,
	"claim_status_input":     true,
}

// idempotencyBase returns the stable base for transaction idempotency keys.
// A resumed session keeps the ORIGINAL session's base so a post-resume confirm
// dedups against the pre-drop attempt (NG-1/NG-2).
func idempotencyBase(sess *models.SessionData) string {
	if base, ok := sess.Data["idempotency_base"].(string); ok && base != "" {
		return base
	}
	return sess.SessionID
}

// financialOpsBlocked reports whether cash-out is blocked: PIN pepper must be
// configured (fail-closed) and the phone-binding cooling period must have
// elapsed since the last rebind (NG-20 mitigation for SIM-swap cash-out).
func (app *Application) financialOpsBlocked(pinState *db.AgentPINState) (string, bool) {
	if app.cfg.PINPepper == "" {
		return "Financial operations are temporarily unavailable. Please contact support.", true
	}
	if app.cfg.CashOutCoolingHours > 0 && !pinState.PhoneBoundAt.IsZero() {
		coolingEnd := pinState.PhoneBoundAt.Add(time.Duration(app.cfg.CashOutCoolingHours) * time.Hour)
		if time.Now().Before(coolingEnd) {
			return fmt.Sprintf("For your security, cash-out is enabled %d hours after a phone number change. Please try again after %s.",
				app.cfg.CashOutCoolingHours, coolingEnd.Format("02-Jan 15:04")), true
		}
	}
	return "", false
}

// -- State: PIN verification / setup for financial operations -----------------

// stateAgentPINEnter verifies the agent's PIN with attempt lockout before a
// float claim (NG identity: PIN requirement for financial ops).
func (app *Application) stateAgentPINEnter(sess *models.SessionData, input string) (models.USSDResponse, error) {
	agentID := sess.Data["agent_id"].(string)
	ctx := context.Background()

	if app.cfg.PINPepper == "" {
		sess.State = "end"
		return models.USSDResponse{
			Text:         "Financial operations are temporarily unavailable. Please contact support.",
			CloseSession: true,
			Action:       "end",
		}, nil
	}

	st, err := app.pg.GetAgentPINState(ctx, agentID)
	if err != nil {
		app.log.Error("pin state", zap.Error(err))
		sess.State = "end"
		return models.USSDResponse{Text: "Service unavailable. Try again later.", CloseSession: true, Action: "end"}, nil
	}
	if st.LockedUntil != nil && time.Now().Before(*st.LockedUntil) {
		sess.State = "end"
		return models.USSDResponse{
			Text:         fmt.Sprintf("PIN locked after too many attempts. Try again after %s.", st.LockedUntil.Format("15:04")),
			CloseSession: true,
			Action:       "end",
		}, nil
	}

	pin := strings.TrimSpace(input)
	if !verifyPIN(pin, agentID, app.cfg.PINPepper, st.PINHash) {
		locked, rerr := app.pg.RecordPINFailure(ctx, agentID, app.cfg.PINMaxAttempts, time.Duration(app.cfg.PINLockSeconds)*time.Second)
		if rerr != nil {
			app.log.Error("pin failure record", zap.Error(rerr))
		}
		if locked {
			sess.State = "end"
			return models.USSDResponse{
				Text:         "Too many wrong PIN attempts. Account locked temporarily.",
				CloseSession: true,
				Action:       "end",
			}, nil
		}
		return models.USSDResponse{
			Text:         "Wrong PIN. Enter your agent PIN:",
			CloseSession: false,
			Action:       "continue",
		}, nil
	}

	_ = app.pg.ResetPINFailures(ctx, agentID)
	sess.Data["pin_verified"] = true
	sess.State = "agent_float_input"
	balance, _ := app.pg.GetAgentBalance(ctx, agentID)
	return models.USSDResponse{
		Text:         fmt.Sprintf("AGENT FLOAT CLAIM\nCurrent balance: ₦%s\n\nEnter claim amount:", formatCurrency(balance)),
		CloseSession: false,
		Action:       "continue",
	}, nil
}

// stateAgentPINSet collects a new PIN (first-time setup before financial ops).
func (app *Application) stateAgentPINSet(sess *models.SessionData, input string) (models.USSDResponse, error) {
	if app.cfg.PINPepper == "" {
		sess.State = "end"
		return models.USSDResponse{
			Text:         "Financial operations are temporarily unavailable. Please contact support.",
			CloseSession: true,
			Action:       "end",
		}, nil
	}
	pin := strings.TrimSpace(input)
	if !validPINFormat(pin) {
		return models.USSDResponse{
			Text:         "PIN must be 4-6 digits. Enter new PIN:",
			CloseSession: false,
			Action:       "continue",
		}, nil
	}
	sess.Data["pin_pending"] = pin
	sess.State = "agent_pin_set_confirm"
	return models.USSDResponse{
		Text:         "Re-enter your new PIN to confirm:",
		CloseSession: false,
		Action:       "continue",
	}, nil
}

func (app *Application) stateAgentPINSetConfirm(sess *models.SessionData, input string) (models.USSDResponse, error) {
	agentID := sess.Data["agent_id"].(string)
	pending, _ := sess.Data["pin_pending"].(string)
	if strings.TrimSpace(input) != pending {
		sess.State = "agent_pin_set"
		return models.USSDResponse{
			Text:         "PINs do not match. Enter new PIN:",
			CloseSession: false,
			Action:       "continue",
		}, nil
	}
	ctx := context.Background()
	if err := app.pg.SetAgentPIN(ctx, agentID, hashPIN(pending, agentID, app.cfg.PINPepper)); err != nil {
		app.log.Error("set pin", zap.Error(err))
		sess.State = "end"
		return models.USSDResponse{Text: "Could not set PIN. Try again later.", CloseSession: true, Action: "end"}, nil
	}
	delete(sess.Data, "pin_pending")
	sess.Data["pin_verified"] = true

	// G3: when the PIN was set as part of ENROLLMENT, the flow ends here —
	// the account remains pending verification; it does NOT drop into a float
	// claim for an unapproved agent.
	if ctx2, _ := sess.Data["pin_context"].(string); ctx2 == "enroll" {
		delete(sess.Data, "pin_context")
		sess.State = "end"
		ref, _ := sess.Data["reference"].(string)
		return models.USSDResponse{
			Text:         "PIN set successfully.\nRegistration received. Reference: " + ref + "\nYour agent account is PENDING verification. You will be notified once approved.",
			CloseSession: true,
			Action:       "end",
		}, nil
	}

	sess.State = "agent_float_input"
	balance, _ := app.pg.GetAgentBalance(ctx, agentID)
	return models.USSDResponse{
		Text:         fmt.Sprintf("PIN set successfully.\nAGENT FLOAT CLAIM\nCurrent balance: ₦%s\n\nEnter claim amount:", formatCurrency(balance)),
		CloseSession: false,
		Action:       "continue",
	}, nil
}

// ---------------------------------------------------------------------------
// Phone-number change / rebind (NG-20)
// ---------------------------------------------------------------------------

// handlePhoneRebind rebinds an agent account to a new phone number (SIM swap /
// number change). Verification: caller must prove control of the account with
// the agent PIN. The rebind restarts the cash-out cooling period and writes an
// audit row. Fail-closed: 503 when PIN verification cannot be performed.
func (app *Application) handlePhoneRebind(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OldPhone string `json:"old_phone"`
		NewPhone string `json:"new_phone"`
		PIN      string `json:"pin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.OldPhone == "" || req.NewPhone == "" || req.PIN == "" {
		jsonError(w, http.StatusBadRequest, "old_phone, new_phone and pin are required")
		return
	}
	if req.OldPhone == req.NewPhone {
		jsonError(w, http.StatusBadRequest, "new_phone must differ from old_phone")
		return
	}
	if app.cfg.PINPepper == "" {
		jsonError(w, http.StatusServiceUnavailable, "rebind unavailable: PIN verification not configured")
		return
	}

	ctx := r.Context()
	agent, err := app.pg.GetAgentByPhone(ctx, req.OldPhone)
	if err != nil || agent == nil {
		jsonError(w, http.StatusNotFound, "agent not found for old_phone")
		return
	}
	if existing, _ := app.pg.GetAgentByPhone(ctx, req.NewPhone); existing != nil {
		jsonError(w, http.StatusConflict, "new_phone is already bound to another account")
		return
	}

	st, err := app.pg.GetAgentPINState(ctx, agent.ID)
	if err != nil {
		app.log.Error("pin state", zap.Error(err))
		jsonError(w, http.StatusInternalServerError, "verification failed")
		return
	}
	if st.PINHash == "" {
		jsonError(w, http.StatusPreconditionFailed, "no PIN set on account; set a PIN via USSD first")
		return
	}
	if st.LockedUntil != nil && time.Now().Before(*st.LockedUntil) {
		jsonError(w, http.StatusLocked, "PIN locked; try again later")
		return
	}
	if !verifyPIN(req.PIN, agent.ID, app.cfg.PINPepper, st.PINHash) {
		locked, rerr := app.pg.RecordPINFailure(ctx, agent.ID, app.cfg.PINMaxAttempts, time.Duration(app.cfg.PINLockSeconds)*time.Second)
		if rerr != nil {
			app.log.Error("pin failure record", zap.Error(rerr))
		}
		if locked {
			jsonError(w, http.StatusLocked, "too many wrong PIN attempts; account locked")
			return
		}
		jsonError(w, http.StatusUnauthorized, "invalid PIN")
		return
	}
	_ = app.pg.ResetPINFailures(ctx, agent.ID)

	if err := app.pg.RebindAgentPhone(ctx, agent.ID, req.OldPhone, req.NewPhone, "pin"); err != nil {
		app.log.Error("phone rebind", zap.Error(err))
		jsonError(w, http.StatusInternalServerError, "rebind failed")
		return
	}

	jsonOK(w, http.StatusOK, map[string]interface{}{
		"message":               "phone number rebound; cash-out cooling period restarted",
		"agent_id":              agent.ID,
		"new_phone":             req.NewPhone,
		"cashout_cooling_hours": app.cfg.CashOutCoolingHours,
	})
}

// handlePendingTransaction returns the latest pending transaction for a phone
// (session-drop reconciliation, NG-2).
func (app *Application) handlePendingTransaction(w http.ResponseWriter, r *http.Request) {
	phone, err := validateQueryParam(r, "phone", 32)
	if err != nil || phone == "" {
		jsonError(w, http.StatusBadRequest, "phone query parameter is required")
		return
	}
	txn, err := app.pg.GetLatestPendingTransactionByPhone(r.Context(), phone)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "lookup failed")
		return
	}
	if txn == nil {
		jsonError(w, http.StatusNotFound, "no pending transaction")
		return
	}
	jsonOK(w, http.StatusOK, txn)
}
