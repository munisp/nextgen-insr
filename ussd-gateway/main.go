package main

import (
	"context"
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
		pg.Close()
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
	json.NewEncoder(w).Encode(v)
}

func jsonError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
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
	sb.WriteString(fmt.Sprintf("FLOAT CLAIM SUMMARY\n\n"))
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
	if strings.ToUpper(input) == "0" || input == "BACK" || input == "CANCEL" {
		// Restart enrollment from beginning.
		sess.State = "product_enroll"
		sess.Data["field_index"] = 0
		sess.Data["collected_data"] = map[string]string{}
		return app.renderProductField(sess), nil
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
	txn, err := app.pg.CreateTransaction(ctx, txn)
	if err != nil {
		app.log.Error("create transaction", zap.Error(err))
		sess.State = "end"
		return models.USSDResponse{
			Text:         "Processing failed. Please try again later.",
			CloseSession: true,
			Action:       "end",
		}, nil
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
		sess.Data["agent_id"] = agent.ID
		sess.State = "agent_float_input"
		return models.USSDResponse{
			Text:         fmt.Sprintf("AGENT FLOAT CLAIM\nCurrent balance: ₦%s\n\nEnter claim amount:", formatCurrency(agent.FloatBalance)),
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
	sess.Data["agent_state"] = strings.TrimSpace(strings.Title(strings.ToLower(input)))
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
	if len(input) < 10 {
		return models.USSDResponse{
			Text:         "Please enter a valid bank account number (min 10 digits):",
			CloseSession: false,
			Action:       "continue",
		}, nil
	}
	// Try to look up bank name by account number (in production this would
	// call a bank verification API; here we accept any numeric input).
	sess.Data["agent_bank_account"] = input
	if _, err := strconv.Atoi(input); err == nil {
		// Best-effort bank name lookup from a small mapping; fallback to generic.
		bankName := lookupBankByNumber(input)
		sess.Data["agent_bank_name"] = bankName
	} else {
		sess.Data["agent_bank_name"] = "Unknown"
	}
	sess.State = "agent_register_confirm"
	return app.renderAgentRegisterConfirm(sess), nil
}

func (app *Application) stateAgentRegisterConfirm(sess *models.SessionData, input string) (models.USSDResponse, error) {
	if strings.ToUpper(input) == "0" || input == "BACK" || input == "CANCEL" {
		sess.State = "agent_menu"
		return models.USSDResponse{
			Text:         "Registration cancelled. Returning to Agent Services.",
			CloseSession: false,
			Action:       "continue",
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

	// Activate the agent immediately (in production this would be verified).
	agent.Status = models.AgentStatusActive
	_ = app.pg.UpdateAgentStatus(ctx, agent.ID, models.AgentStatusActive)

	sess.Data["agent_id"] = agent.ID
	sess.Data["agent_phone"] = agent.PhoneNumber
	sess.State = "agent_register_complete"
	sess.Data["reference"] = "AGT-" + agent.ID[:8]

	return models.USSDResponse{
		Text:         "Welcome, " + agent.Name + "! You are now a registered agent. Reference: " + sess.Data["reference"].(string) + "\nYou can now use Agent Services.",
		CloseSession: true,
		Action:       "end",
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
	if strings.ToUpper(input) == "0" || input == "BACK" || input == "CANCEL" {
		sess.State = "agent_menu"
		return models.USSDResponse{
			Text:         "Claim cancelled.",
			CloseSession: false,
			Action:       "continue",
		}, nil
	}

	amount := sess.Data["claim_amount"].(float64)
	agentID := sess.Data["agent_id"].(string)

	// Deduct the float balance.
	balance, _ := app.pg.GetAgentBalance(context.Background(), agentID)
	newBalance := balance - amount
	_ = app.pg.UpdateAgentBalance(context.Background(), agentID, newBalance)

	// Record the transaction.
	txn := &models.TransactionRecord{
		SessionID:   sess.SessionID,
		PhoneNumber: sess.PhoneNumber,
		Type:        models.TransactionTypeFloatClaim,
		ProductID:   "float_claim",
		Amount:      amount,
		Status:      "completed",
	}
	ctx := context.Background()
	txn, err := app.pg.CreateTransaction(ctx, txn)
	if err != nil {
		app.log.Error("float claim txn", zap.Error(err))
	}

	sess.Data["reference"] = txn.Reference
	sess.Data["new_balance"] = newBalance
	sess.State = "agent_float_complete"

	return models.USSDResponse{
		Text:         fmt.Sprintf("Float claim of ₦%s processed successfully!\nNew balance: ₦%s\nReference: %s", formatCurrency(amount), formatCurrency(newBalance), txn.Reference),
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
		// Also try Postgres for persistence.
		if pgSession, _ := app.pg.GetSessionState(ctx, req.SessionID); pgSession != nil {
			return pgSession, nil
		}
		return sess, nil
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
	r.Use(middleware.RealIP)
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
	defer logger.Sync()

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
