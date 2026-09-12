// pbac-engine — Policy-Based Access Control evaluation sidecar.
// Port: 8091 (PBAC_ENGINE_URL in server/middleware/securityOrchestrator.ts).
//
// Relationship to Permify (honest note): the monolith's coarse-grained
// relationship checks ("can user X do action Y on entity Z") are delegated to
// Permify (server/_core/permify.ts). This engine is the COMPLEMENTARY layer
// Permify does not provide: attribute/context-CONDITION evaluation (amount
// limits, MFA state, KYC tier, risk score, time-of-day) with deny-overrides
// precedence, evaluated per-request by the security orchestrator. It does not
// re-implement Permify's ReBAC graph.
//
// Real evaluator, no stubs: policies are matched on subject roles, resource
// type, and action; every matched policy's Conditions are evaluated against
// the request context with real operators (equals, not_equals, greater_than,
// less_than, contains, in). Combining algorithm: deny-overrides — any matched
// "deny" policy wins over any number of matched "allow" policies; when no
// policy matches, the engine fails CLOSED (default deny) with the reason
// "no_matching_policy", because an authorization engine that silently allows
// is worse than one that is down.
//
// Endpoints:
//   POST /authorize        evaluate one authorization request
//   GET  /policies         list policies
//   POST /policies         create/replace a policy
//   GET  /policies/{id}    fetch one policy (404 when absent)
//   DELETE /policies/{id}  remove a policy (404 when absent)
//   GET  /health           liveness
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// ── Models (contract with securityOrchestrator.ts checkPBAC) ────────────────

type Subject struct {
	UserID    string   `json:"user_id"`
	Roles     []string `json:"roles"`
	KycLevel  int      `json:"kyc_level"`
	IPAddress string   `json:"ip_address"`
	DeviceID  string   `json:"device_id"`
	SessionID string   `json:"session_id"`
}

type Resource struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	OwnerID  string `json:"owner_id"`
	TenantID string `json:"tenant_id"`
}

// RequestContext carries the attributes conditions evaluate against.
type RequestContext struct {
	Amount      float64 `json:"amount"`
	Channel     string  `json:"channel"`
	MfaVerified bool    `json:"mfa_verified"`
	IPAddress   string  `json:"ip_address"`
	GeoCountry  string  `json:"geo_country"`
	RiskScore   float64 `json:"risk_score"`
	TimeOfDay   int     `json:"time_of_day"`
	DayOfWeek   int     `json:"day_of_week"`
}

// Condition is one attribute test inside a policy. operator is one of:
// equals, not_equals, greater_than, less_than, contains, in.
type Condition struct {
	Attribute string      `json:"attribute"` // context field, e.g. "amount", "risk_score", "channel"
	Operator  string      `json:"operator"`
	Value     interface{} `json:"value"`
}

// Policy binds subjects (by role / min KYC tier) to resources+actions with
// an effect ("allow" or "deny") and optional context Conditions.
type Policy struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	Description  string            `json:"description"`
	Effect       string            `json:"effect"` // "allow" | "deny"
	Roles        []string          `json:"roles"`
	MinKycLevel  int               `json:"min_kyc_level"`
	// MaxKycLevel, when > 0, scopes the policy to subjects at or below that
	// KYC tier (e.g. tier-specific transaction limits).
	MaxKycLevel  int               `json:"max_kyc_level"`
	ResourceTypes []string         `json:"resource_types"`
	Actions      []string          `json:"actions"`
	Conditions   []Condition       `json:"conditions"`
	// RequiredActions is advisory output on deny (e.g. ["mfa"]), telling the
	// caller what would have made the request pass.
	RequiredActions []string `json:"required_actions"`
	Priority        int      `json:"priority"`
}

// AuthorizeRequest is the exact body posted by checkPBAC.
type AuthorizeRequest struct {
	Subject  Subject        `json:"subject"`
	Resource Resource       `json:"resource"`
	Action   string         `json:"action"`
	Context  RequestContext `json:"context"`
}

// Decision is the exact body checkPBAC parses back.
type Decision struct {
	Allowed         bool     `json:"allowed"`
	Reason          string   `json:"reason"`
	MatchedPolicy   string   `json:"matched_policy"`
	EvalTimeMs      int64    `json:"eval_time_ms"`
	RequiredActions []string `json:"required_actions,omitempty"`
}

// ── Evaluator ───────────────────────────────────────────────────────────────

type Evaluator struct {
	mu       sync.RWMutex
	policies map[string]Policy
	order    []string // insertion order for deterministic evaluation
}

func NewEvaluator(defaults []Policy) *Evaluator {
	e := &Evaluator{policies: map[string]Policy{}}
	for _, p := range defaults {
		e.policies[p.ID] = p
		e.order = append(e.order, p.ID)
	}
	return e
}

func (e *Evaluator) List() []Policy {
	e.mu.RLock()
	defer e.mu.RUnlock()
	out := make([]Policy, 0, len(e.order))
	for _, id := range e.order {
		out = append(out, e.policies[id])
	}
	return out
}

func (e *Evaluator) Get(id string) (Policy, bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	p, ok := e.policies[id]
	return p, ok
}

// Upsert validates and stores a policy. Invalid policies are rejected loudly.
func (e *Evaluator) Upsert(p Policy) error {
	if p.ID == "" {
		return errString("policy id is required")
	}
	if p.Effect != "allow" && p.Effect != "deny" {
		return errString("policy effect must be \"allow\" or \"deny\"")
	}
	for _, c := range p.Conditions {
		if !validOperator(c.Operator) {
			return errString("invalid condition operator: " + c.Operator)
		}
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if _, exists := e.policies[p.ID]; !exists {
		e.order = append(e.order, p.ID)
	}
	e.policies[p.ID] = p
	return nil
}

func (e *Evaluator) Delete(id string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if _, ok := e.policies[id]; !ok {
		return false
	}
	delete(e.policies, id)
	for i, oid := range e.order {
		if oid == id {
			e.order = append(e.order[:i], e.order[i+1:]...)
			break
		}
	}
	return true
}

type errString string

func (e errString) Error() string { return string(e) }

func validOperator(op string) bool {
	switch op {
	case "equals", "not_equals", "greater_than", "less_than", "contains", "in":
		return true
	}
	return false
}

func hasString(list []string, v string) bool {
	for _, s := range list {
		if s == "*" || s == v {
			return true
		}
	}
	return false
}

func contextAttribute(ctx RequestContext, name string) (interface{}, bool) {
	switch name {
	case "amount":
		return ctx.Amount, true
	case "channel":
		return ctx.Channel, true
	case "mfa_verified":
		return ctx.MfaVerified, true
	case "ip_address":
		return ctx.IPAddress, true
	case "geo_country":
		return ctx.GeoCountry, true
	case "risk_score":
		return ctx.RiskScore, true
	case "time_of_day":
		return float64(ctx.TimeOfDay), true
	case "day_of_week":
		return float64(ctx.DayOfWeek), true
	}
	return nil, false
}

func toFloat(v interface{}) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	}
	return 0, false
}

// evalCondition applies one operator against a real context attribute.
// Unknown attributes and mismatched types fail the condition (a policy whose
// condition cannot be evaluated must never silently match).
func evalCondition(c Condition, ctx RequestContext) bool {
	actual, ok := contextAttribute(ctx, c.Attribute)
	if !ok {
		return false
	}
	switch c.Operator {
	case "equals":
		if af, ok := toFloat(actual); ok {
			cf, cok := toFloat(c.Value)
			return cok && af == cf
		}
		return actual == c.Value
	case "not_equals":
		if af, ok := toFloat(actual); ok {
			cf, cok := toFloat(c.Value)
			return cok && af != cf
		}
		return actual != c.Value
	case "greater_than":
		af, aok := toFloat(actual)
		cf, cok := toFloat(c.Value)
		return aok && cok && af > cf
	case "less_than":
		af, aok := toFloat(actual)
		cf, cok := toFloat(c.Value)
		return aok && cok && af < cf
	case "contains":
		s, aok := actual.(string)
		if !aok {
			return false
		}
		switch needle := c.Value.(type) {
		case string:
			return strings.Contains(s, needle)
		case []interface{}:
			for _, item := range needle {
				if str, ok := item.(string); ok && strings.Contains(s, str) {
					return true
				}
			}
		}
		return false
	case "in":
		list, ok := c.Value.([]interface{})
		if !ok {
			return false
		}
		for _, item := range list {
			if item == actual {
				return true
			}
			if af, aok := toFloat(actual); aok {
				if cf, cok := toFloat(item); cok && af == cf {
					return true
				}
			}
		}
		return false
	}
	return false
}

func policyMatches(p Policy, req AuthorizeRequest) bool {
	if len(p.Roles) > 0 {
		roleHit := false
		for _, r := range req.Subject.Roles {
			if hasString(p.Roles, r) {
				roleHit = true
				break
			}
		}
		if !roleHit {
			return false
		}
	}
	if p.MinKycLevel > 0 && req.Subject.KycLevel < p.MinKycLevel {
		return false
	}
	if p.MaxKycLevel > 0 && req.Subject.KycLevel > p.MaxKycLevel {
		return false
	}
	if len(p.ResourceTypes) > 0 && !hasString(p.ResourceTypes, req.Resource.Type) {
		return false
	}
	if len(p.Actions) > 0 && !hasString(p.Actions, req.Action) {
		return false
	}
	for _, c := range p.Conditions {
		if !evalCondition(c, req.Context) {
			return false
		}
	}
	return true
}

// Evaluate runs deny-overrides combining over every matching policy:
// any matching "deny" wins; otherwise a single matching "allow" admits;
// otherwise default-deny with reason "no_matching_policy".
func (e *Evaluator) Evaluate(req AuthorizeRequest) Decision {
	start := time.Now()
	e.mu.RLock()
	defer e.mu.RUnlock()

	var allowMatch *Policy
	for _, id := range e.order {
		p := e.policies[id]
		if !policyMatches(p, req) {
			continue
		}
		if p.Effect == "deny" {
			return Decision{
				Allowed:         false,
				Reason:          "denied by policy: " + p.Name,
				MatchedPolicy:   p.ID,
				EvalTimeMs:      time.Since(start).Milliseconds(),
				RequiredActions: p.RequiredActions,
			}
		}
		if allowMatch == nil || p.Priority > allowMatch.Priority {
			pp := p
			allowMatch = &pp
		}
	}

	if allowMatch != nil {
		return Decision{
			Allowed:       true,
			Reason:        "allowed by policy: " + allowMatch.Name,
			MatchedPolicy: allowMatch.ID,
			EvalTimeMs:    time.Since(start).Milliseconds(),
		}
	}
	return Decision{
		Allowed:       false,
		Reason:        "no_matching_policy",
		MatchedPolicy: "",
		EvalTimeMs:    time.Since(start).Milliseconds(),
	}
}

// ── Default policies ────────────────────────────────────────────────────────
// Real platform guardrails: admin reach, MFA step-up for high-value writes,
// KYC-tiered transaction limits (CBN tiers), and risk-score cutoffs.
func defaultPolicies() []Policy {
	return []Policy{
		{
			ID:           "admin-full-access",
			Name:         "Administrators may perform any action",
			Description:  "Full access for the admin role; still subject to explicit deny policies (deny-overrides).",
			Effect:       "allow",
			Roles:        []string{"admin"},
			ResourceTypes: []string{"*"},
			Actions:      []string{"*"},
			Priority:     10,
		},
		{
			ID:           "authenticated-read",
			Name:         "Authenticated users may read",
			Description:  "Any authenticated subject with KYC tier 1+ may read non-admin resources.",
			Effect:       "allow",
			Roles:        []string{"user", "agent", "merchant", "admin"},
			MinKycLevel:  1,
			ResourceTypes: []string{"transaction", "report", "general", "merchant", "agent", "user"},
			Actions:      []string{"read"},
			Priority:     1,
		},
		{
			ID:           "mfa-high-value-write",
			Name:         "High-value writes require MFA",
			Description:  "Deny create/update/delete on transaction or settings resources above NGN 50,000 when MFA is not verified.",
			Effect:       "deny",
			Roles:        []string{"user", "agent", "merchant"},
			ResourceTypes: []string{"transaction", "settings"},
			Actions:      []string{"create", "update", "delete"},
			Conditions: []Condition{
				{Attribute: "amount", Operator: "greater_than", Value: float64(50000)},
				{Attribute: "mfa_verified", Operator: "equals", Value: false},
			},
			RequiredActions: []string{"mfa"},
			Priority:        100,
		},
		{
			ID:           "kyc-tier1-transaction-limit",
			Name:         "KYC tier 1 single-transaction limit",
			Description:  "Deny tier-1 subjects transaction creates above the CBN tier-1 limit of NGN 50,000.",
			Effect:       "deny",
			Roles:        []string{"user", "agent", "merchant"},
			MaxKycLevel:  1,
			ResourceTypes: []string{"transaction"},
			Actions:      []string{"create"},
			Conditions: []Condition{
				{Attribute: "amount", Operator: "greater_than", Value: float64(50000)},
			},
			RequiredActions: []string{"kyc"},
			Priority:        90,
		},
		{
			ID:           "risk-score-cutoff",
			Name:         "High risk-score requests are denied",
			Description:  "Deny any write when the supplied risk score is at or above 80.",
			Effect:       "deny",
			Roles:        []string{"*"},
			ResourceTypes: []string{"*"},
			Actions:      []string{"create", "update", "delete"},
			Conditions: []Condition{
				{Attribute: "risk_score", Operator: "greater_than", Value: float64(79)},
			},
			RequiredActions: []string{"risk"},
			Priority:        110,
		},
		{
			ID:           "kyc-write-access",
			Name:         "KYC-verified users may write within limits",
			Description:  "Subjects with KYC tier 2+ may create/update transactions and general resources.",
			Effect:       "allow",
			Roles:        []string{"user", "agent", "merchant"},
			MinKycLevel:  2,
			ResourceTypes: []string{"transaction", "general", "merchant", "agent"},
			Actions:      []string{"create", "update"},
			Priority:     5,
		},
	}
}

// ── HTTP layer ──────────────────────────────────────────────────────────────

type server struct {
	eval *Evaluator
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (s *server) handleAuthorize(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	var req AuthorizeRequest
	dec := json.NewDecoder(r.Body)
	dec.UseNumber()
	if err := dec.Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid authorize request: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, s.eval.Evaluate(req))
}

func (s *server) handlePolicies(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]interface{}{"policies": s.eval.List()})
	case http.MethodPost:
		var p Policy
		dec := json.NewDecoder(r.Body)
		dec.UseNumber()
		if err := dec.Decode(&p); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid policy: " + err.Error()})
			return
		}
		if err := s.eval.Upsert(p); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "stored", "id": p.ID})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *server) handlePolicyByID(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/policies/")
	if id == "" || strings.Contains(id, "/") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid policy id"})
		return
	}
	switch r.Method {
	case http.MethodGet:
		p, ok := s.eval.Get(id)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "policy not found"})
			return
		}
		writeJSON(w, http.StatusOK, p)
	case http.MethodDelete:
		if !s.eval.Delete(id) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "policy not found"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted", "id": id})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":        "healthy",
		"service":       "pbac-engine",
		"policy_count":  len(s.eval.List()),
		"default_deny":  true,
		"relationship":  "complementary to Permify: condition/attribute evaluation layer, not a ReBAC replacement",
		"timestamp":     time.Now().UTC().Format(time.RFC3339),
	})
}

func main() {
	port := os.Getenv("PBAC_ENGINE_PORT")
	if port == "" {
		port = "8091"
	}
	s := &server{eval: NewEvaluator(defaultPolicies())}

	mux := http.NewServeMux()
	mux.HandleFunc("/authorize", s.handleAuthorize)
	mux.HandleFunc("/policies", s.handlePolicies)
	mux.HandleFunc("/policies/", s.handlePolicyByID)
	mux.HandleFunc("/health", s.handleHealth)

	log.Printf("pbac-engine listening on :%s (%d policies loaded, default-deny)", port, len(s.eval.List()))
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("pbac-engine failed: %v", err)
	}
}
