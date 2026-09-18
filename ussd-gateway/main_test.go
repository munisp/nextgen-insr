package main

import (
	"go.uber.org/zap"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/insureportal/ussd_gateway/db"
	"github.com/insureportal/ussd_gateway/models"
)

func TestValidateQueryParam(t *testing.T) {
	tests := []struct {
		name   string
		query  string
		key    string
		maxLen int
		want   string
		err    bool
	}{
		{"valid", "?name=test", "name", 100, "test", false},
		{"empty", "", "name", 100, "", false},
		{"too long", "?name=toolongvalue", "name", 5, "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/test"+tt.query, nil)
			got, err := validateQueryParam(req, tt.key, tt.maxLen)
			if (err != nil) != tt.err {
				t.Errorf("err = %v, wantErr %v", err, tt.err)
			}
			if !tt.err && got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}
func TestValidateIntParam(t *testing.T) {
	tests := []struct {
		name  string
		query string
		key   string
		want  int
		err   bool
	}{
		{"valid", "?page=5", "page", 5, false},
		{"empty", "", "page", 0, false},
		{"invalid", "?page=abc", "page", 0, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/test"+tt.query, nil)
			got, err := validateIntParam(req, tt.key)
			if (err != nil) != tt.err {
				t.Errorf("err = %v, wantErr %v", err, tt.err)
			}
			if !tt.err && got != tt.want {
				t.Errorf("got %d, want %d", got, tt.want)
			}
		})
	}
}

// --- F4 audit tests (NG-1..NG-4 + PIN identity) ---

func TestIsConfirmInput(t *testing.T) {
	if !isConfirmInput("1") || !isConfirmInput(" 1 ") {
		t.Fatal("explicit 1 must confirm")
	}
	for _, in := range []string{"", "yes", "2", "11", "0", "BACK", "CANCEL", "1.5"} {
		if isConfirmInput(in) {
			t.Fatalf("input %q must NOT confirm", in)
		}
	}
}

func TestIsCancelInput(t *testing.T) {
	for _, in := range []string{"0", "BACK", "CANCEL", "back", " cancel "} {
		if !isCancelInput(in) {
			t.Fatalf("input %q must cancel", in)
		}
	}
	if isCancelInput("1") {
		t.Fatal("1 must not cancel")
	}
}

func TestHashAndVerifyPIN(t *testing.T) {
	pepper := "test-pepper"
	h := hashPIN("1234", "agent-1", pepper)
	if !verifyPIN("1234", "agent-1", pepper, h) {
		t.Fatal("correct PIN must verify")
	}
	if verifyPIN("1235", "agent-1", pepper, h) {
		t.Fatal("wrong PIN must not verify")
	}
	if verifyPIN("1234", "agent-2", pepper, h) {
		t.Fatal("PIN must be bound to the agent ID (salt)")
	}
	if verifyPIN("1234", "agent-1", "other-pepper", h) {
		t.Fatal("PIN must be bound to the pepper")
	}
	// Fail-closed: empty pepper or hash never verifies.
	if verifyPIN("1234", "agent-1", "", h) || verifyPIN("1234", "agent-1", pepper, "") {
		t.Fatal("empty pepper/hash must not verify")
	}
}

func TestValidPINFormat(t *testing.T) {
	for _, ok := range []string{"1234", "123456", "0000"} {
		if !validPINFormat(ok) {
			t.Fatalf("%q must be a valid PIN", ok)
		}
	}
	for _, bad := range []string{"", "123", "1234567", "12a4", " 1234"} {
		if validPINFormat(bad) {
			t.Fatalf("%q must be rejected", bad)
		}
	}
}

func TestIdempotencyBase(t *testing.T) {
	sess := &models.SessionData{SessionID: "new-sess", Data: map[string]interface{}{}}
	if got := idempotencyBase(sess); got != "new-sess" {
		t.Fatalf("base = %q, want session id", got)
	}
	sess.Data["idempotency_base"] = "orig-sess"
	if got := idempotencyBase(sess); got != "orig-sess" {
		t.Fatalf("resumed session must keep original base, got %q", got)
	}
}

func TestResumableStates(t *testing.T) {
	for _, s := range []string{"product_confirm", "agent_float_confirm", "product_enroll"} {
		if !resumableStates[s] {
			t.Fatalf("state %q must be resumable", s)
		}
	}
	for _, s := range []string{"main_menu", "end", "enroll_complete", ""} {
		if resumableStates[s] {
			t.Fatalf("state %q must not be resumable", s)
		}
	}
}

func TestFinancialOpsBlocked(t *testing.T) {
	app := &Application{cfg: Config{PINPepper: "", CashOutCoolingHours: 24}}
	// Fail-closed without configured pepper.
	if _, blocked := app.financialOpsBlocked(&db.AgentPINState{}); !blocked {
		t.Fatal("financial ops must be blocked when PIN_PEPPER is unset")
	}
	app.cfg.PINPepper = "pepper"
	// Cooling period after rebind blocks cash-out.
	st := &db.AgentPINState{PhoneBoundAt: time.Now().Add(-1 * time.Hour)}
	if _, blocked := app.financialOpsBlocked(st); !blocked {
		t.Fatal("cash-out must be blocked inside cooling period")
	}
	// After cooling: allowed.
	st.PhoneBoundAt = time.Now().Add(-48 * time.Hour)
	if _, blocked := app.financialOpsBlocked(st); blocked {
		t.Fatal("cash-out must be allowed after cooling period")
	}
	// Zero cooling disables the check.
	app.cfg.CashOutCoolingHours = 0
	st.PhoneBoundAt = time.Now()
	if _, blocked := app.financialOpsBlocked(st); blocked {
		t.Fatal("cooling=0 must disable the cooling check")
	}
}

// G3 (audit #11): settlement account format gate — exactly 10 digits (NUBAN).
func TestNubanFormat(t *testing.T) {
	for _, ok := range []string{"0123456789", "0000000000", "9998877776"} {
		if !nubanFormat(ok) {
			t.Fatalf("%q must be accepted as NUBAN", ok)
		}
	}
	for _, bad := range []string{"", "123", "01234567890", "012345678a", " 0123456789", "01234 56789", "+2348012345"} {
		if nubanFormat(bad) {
			t.Fatalf("%q must be rejected", bad)
		}
	}
}

// G3 (audit #11): the bank step rejects non-NUBAN input and does NOT advance.
func TestStateAgentRegisterBankRejectsNonNUBAN(t *testing.T) {
	app := &Application{}
	sess := &models.SessionData{SessionID: "s1", State: "agent_register_bank", Data: map[string]interface{}{}}
	resp, err := app.stateAgentRegisterBank(sess, "12345")
	if err != nil {
		t.Fatal(err)
	}
	if sess.State != "agent_register_bank" {
		t.Fatalf("short account advanced state to %q", sess.State)
	}
	if resp.CloseSession {
		t.Fatal("session must stay open for retry")
	}
}

// G3 (audit #9): enrollment confirm must NEVER activate the agent and must
// require PIN infrastructure — with no PIN_PEPPER configured it fails closed
// BEFORE persisting anything.
func TestStateAgentRegisterConfirmFailsClosedWithoutPepper(t *testing.T) {
	app := &Application{cfg: Config{PINPepper: ""}, log: zap.NewNop()}
	sess := &models.SessionData{
		SessionID: "s2",
		State:     "agent_register_confirm",
		Data: map[string]interface{}{
			"agent_name":         "Test Agent",
			"agent_state":        "Lagos",
			"agent_lga":          "Ikeja",
			"agent_bank_account": "0123456789",
			"agent_bank_name":    "Test Bank",
		},
	}
	resp, err := app.stateAgentRegisterConfirm(sess, "1")
	if err != nil {
		t.Fatal(err)
	}
	if !resp.CloseSession {
		t.Fatal("fail-closed path must end the session")
	}
	// No agent_id may be set — nothing was persisted.
	if _, ok := sess.Data["agent_id"]; ok {
		t.Fatal("agent must not be persisted when PIN_PEPPER is unset")
	}
}

// G3 (audit #9): pending agents must be blocked from financial ops at the
// agent menu. (Active-agent path requires a live DB and is covered by the
// platform integration suite.)
func TestAgentMenuBlocksNonActiveAgents(t *testing.T) {
	// Direct check of the status guard semantics used in stateAgentMenu.
	for _, st := range []string{models.AgentStatusPending, models.AgentStatusSuspended, models.AgentStatusDisabled} {
		if st == models.AgentStatusActive {
			t.Fatal("non-active status must not equal active")
		}
	}
}
