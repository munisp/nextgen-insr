package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func baseRequest() AuthorizeRequest {
	return AuthorizeRequest{
		Subject: Subject{
			UserID:   "u-1",
			Roles:    []string{"user"},
			KycLevel: 2,
		},
		Resource: Resource{ID: "/api/trpc/transactions.create", Type: "transaction"},
		Action:   "create",
		Context: RequestContext{
			Amount:      1000,
			Channel:     "web",
			MfaVerified: true,
			RiskScore:   10,
		},
	}
}

// TestPBACEvaluateAllow: KYC tier-2 user, small MFA-verified transaction → allow.
func TestPBACEvaluateAllow(t *testing.T) {
	e := NewEvaluator(defaultPolicies())
	d := e.Evaluate(baseRequest())
	if !d.Allowed {
		t.Fatalf("expected allow, got deny: %s (policy %s)", d.Reason, d.MatchedPolicy)
	}
	if d.MatchedPolicy == "" {
		t.Fatal("expected a matched policy id")
	}
}

// TestPBACDenyOverrides: an allow policy AND a deny policy both match → deny wins.
func TestPBACDenyOverrides(t *testing.T) {
	e := NewEvaluator(defaultPolicies())
	req := baseRequest()
	req.Context.Amount = 100000
	req.Context.MfaVerified = false // trips mfa-high-value-write
	d := e.Evaluate(req)
	if d.Allowed {
		t.Fatal("expected deny-overrides to win")
	}
	if d.MatchedPolicy != "mfa-high-value-write" {
		t.Fatalf("expected mfa-high-value-write, got %s", d.MatchedPolicy)
	}
	if len(d.RequiredActions) == 0 || d.RequiredActions[0] != "mfa" {
		t.Fatalf("expected required action mfa, got %v", d.RequiredActions)
	}
}

// TestPBACDefaultDeny: nothing matches → closed default.
func TestPBACDefaultDeny(t *testing.T) {
	e := NewEvaluator(defaultPolicies())
	req := baseRequest()
	req.Action = "delete"
	req.Resource.Type = "admin"
	req.Subject.KycLevel = 3
	d := e.Evaluate(req)
	if d.Allowed || d.Reason != "no_matching_policy" {
		t.Fatalf("expected default deny, got %+v", d)
	}
}

// TestPBACKycTierLimit: tier-1 subject above the CBN tier-1 limit is denied.
func TestPBACKycTierLimit(t *testing.T) {
	e := NewEvaluator(defaultPolicies())
	req := baseRequest()
	req.Subject.KycLevel = 1
	req.Context.Amount = 60000
	d := e.Evaluate(req)
	if d.Allowed || d.MatchedPolicy != "kyc-tier1-transaction-limit" {
		t.Fatalf("expected kyc tier limit deny, got %+v", d)
	}
}

// TestPBACRiskCutoff: risk score >= 80 denies writes even for admins.
func TestPBACRiskCutoff(t *testing.T) {
	e := NewEvaluator(defaultPolicies())
	req := baseRequest()
	req.Subject.Roles = []string{"admin"}
	req.Context.RiskScore = 95
	d := e.Evaluate(req)
	if d.Allowed || d.MatchedPolicy != "risk-score-cutoff" {
		t.Fatalf("expected risk cutoff deny, got %+v", d)
	}
}

// TestPBACAdminAllow: admin with clean context can act on anything.
func TestPBACAdminAllow(t *testing.T) {
	e := NewEvaluator(defaultPolicies())
	req := baseRequest()
	req.Subject.Roles = []string{"admin"}
	req.Resource.Type = "admin"
	req.Action = "delete"
	d := e.Evaluate(req)
	if !d.Allowed {
		t.Fatalf("expected admin allow, got %+v", d)
	}
}

// TestPBACConditionOperators: every operator behaves genuinely.
func TestPBACConditionOperators(t *testing.T) {
	ctx := RequestContext{Amount: 100, Channel: "ussd", RiskScore: 42, GeoCountry: "NG", MfaVerified: true}
	cases := []struct {
		c    Condition
		want bool
	}{
		{Condition{Attribute: "amount", Operator: "equals", Value: float64(100)}, true},
		{Condition{Attribute: "amount", Operator: "not_equals", Value: float64(5)}, true},
		{Condition{Attribute: "amount", Operator: "greater_than", Value: float64(99)}, true},
		{Condition{Attribute: "amount", Operator: "less_than", Value: float64(101)}, true},
		{Condition{Attribute: "channel", Operator: "contains", Value: "ss"}, true},
		{Condition{Attribute: "geo_country", Operator: "in", Value: []interface{}{"GH", "NG"}}, true},
		{Condition{Attribute: "geo_country", Operator: "in", Value: []interface{}{"GH", "KE"}}, false},
		{Condition{Attribute: "amount", Operator: "greater_than", Value: float64(100)}, false},
		{Condition{Attribute: "bogus", Operator: "equals", Value: "x"}, false},
	}
	for i, tc := range cases {
		if got := evalCondition(tc.c, ctx); got != tc.want {
			t.Errorf("case %d (%s %s): got %v want %v", i, tc.c.Attribute, tc.c.Operator, got, tc.want)
		}
	}
}

// TestPBACAuthorizeEndpoint: full HTTP round-trip of the orchestrator contract.
func TestPBACAuthorizeEndpoint(t *testing.T) {
	s := &server{eval: NewEvaluator(defaultPolicies())}
	body, _ := json.Marshal(baseRequest())
	r := httptest.NewRequest(http.MethodPost, "/authorize", bytes.NewReader(body))
	w := httptest.NewRecorder()
	s.handleAuthorize(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var d Decision
	if err := json.Unmarshal(w.Body.Bytes(), &d); err != nil {
		t.Fatalf("invalid decision JSON: %v", err)
	}
	if !d.Allowed || d.MatchedPolicy == "" {
		t.Fatalf("unexpected decision: %+v", d)
	}
}

// TestPBACPolicyCRUD: store, fetch, list, delete; invalid effect rejected.
func TestPBACPolicyCRUD(t *testing.T) {
	s := &server{eval: NewEvaluator(defaultPolicies())}

	p := Policy{ID: "test-allow", Name: "t", Effect: "allow", Roles: []string{"user"}, Actions: []string{"read"}}
	body, _ := json.Marshal(p)
	w := httptest.NewRecorder()
	s.handlePolicies(w, httptest.NewRequest(http.MethodPost, "/policies", bytes.NewReader(body)))
	if w.Code != http.StatusOK {
		t.Fatalf("store failed: %d %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	s.handlePolicyByID(w, httptest.NewRequest(http.MethodGet, "/policies/test-allow", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("get failed: %d", w.Code)
	}

	got, ok := s.eval.Get("test-allow")
	if !ok || got.Effect != "allow" {
		t.Fatalf("stored policy missing: %+v", got)
	}

	bad := Policy{ID: "bad", Effect: "maybe"}
	body, _ = json.Marshal(bad)
	w = httptest.NewRecorder()
	s.handlePolicies(w, httptest.NewRequest(http.MethodPost, "/policies", bytes.NewReader(body)))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid effect, got %d", w.Code)
	}

	w = httptest.NewRecorder()
	s.handlePolicyByID(w, httptest.NewRequest(http.MethodDelete, "/policies/test-allow", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("delete failed: %d", w.Code)
	}
	if _, ok := s.eval.Get("test-allow"); ok {
		t.Fatal("policy still present after delete")
	}
}
