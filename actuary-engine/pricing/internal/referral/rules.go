// Package referral is the automatic-referral rule engine (design §4.g):
// declarative JSON predicates over quote variables, evaluated in priority
// order, with actions refer|decline. The engine is fail-closed by
// construction (Appendix I + product-builder C2d convention): any
// evaluation error yields a refer outcome with REFERRAL_ENGINE_ERROR, never
// an accept.
package referral

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"sync/atomic"
)

// Rule is one act_referral_rules row.
type Rule struct {
	ID         int64
	Line       string
	Predicate  json.RawMessage
	Action     string // "refer" | "decline"
	ReasonCode string
	Priority   int // lower evaluates first
	IsActive   bool
}

// Facts are the quote attributes predicates evaluate against. Numeric
// fields are kobo; the fraud score is an optional python-ml-engine feature
// passed through variables["fraud_score"].
type Facts struct {
	Line           string
	SumInsuredKobo int64
	PremiumKobo    int64 // 0 pre-rating
	Exposures      float64
	GeoCell        string
	Variables      map[string]string
}

// Outcome is the engine result.
type Outcome struct {
	Action     string   // "pass" | "refer" | "decline"
	ReasonCode string   // rule reason code (or engine error code)
	RuleID     int64    // rule that fired (0 = none)
	Reasons    []string // accumulated reason codes
}

// Engine evaluates the rule set. The set is immutable and atomically
// swappable (same reload contract as the rating snapshot).
type Engine struct {
	rules atomic.Pointer[[]Rule]
}

// NewEngine returns an engine with no rules (everything passes).
func NewEngine() *Engine { return &Engine{} }

// Swap atomically publishes a successor rule set, sorted by (priority, id).
func (e *Engine) Swap(rules []Rule) {
	sorted := make([]Rule, len(rules))
	copy(sorted, rules)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].Priority != sorted[j].Priority {
			return sorted[i].Priority < sorted[j].Priority
		}
		return sorted[i].ID < sorted[j].ID
	})
	e.rules.Store(&sorted)
}

// Rules returns a copy of the live rule set (for admin read-back).
func (e *Engine) Rules() []Rule {
	cur := e.rules.Load()
	if cur == nil {
		return nil
	}
	out := make([]Rule, len(*cur))
	copy(out, *cur)
	return out
}

// Evaluate runs the active rules for the line in priority order and returns
// the first hit. A predicate that fails to evaluate is NOT skipped: the
// engine is fail-closed and refers the quote (design §4.g "rules-engine
// error = refer, not accept").
func (e *Engine) Evaluate(facts Facts) Outcome {
	cur := e.rules.Load()
	if cur == nil {
		return Outcome{Action: "pass"}
	}
	for _, rule := range *cur {
		if !rule.IsActive || rule.Line != facts.Line {
			continue
		}
		hit, err := evalPredicate(rule.Predicate, facts)
		if err != nil {
			return Outcome{
				Action:     "refer",
				ReasonCode: "REFERRAL_ENGINE_ERROR",
				RuleID:     rule.ID,
				Reasons:    []string{"REFERRAL_ENGINE_ERROR"},
			}
		}
		if hit {
			return Outcome{
				Action:     rule.Action,
				ReasonCode: rule.ReasonCode,
				RuleID:     rule.ID,
				Reasons:    []string{rule.ReasonCode},
			}
		}
	}
	return Outcome{Action: "pass"}
}

// Predicate grammar (act_referral_rules.predicate jsonb):
//
//	{"field": "sumInsuredKobo", "op": "gt", "value": 500000000}
//	{"all": [pred, ...]}  {"any": [pred, ...]}  {"not": pred}
//
// Fields: sumInsuredKobo, premiumKobo, exposures, fraudScore
// (variables.fraud_score parsed as float), or "var.<name>" for string
// variables (eq/ne/in only).
// Ops: gt, gte, lt, lte, eq, ne, in.
func evalPredicate(raw json.RawMessage, facts Facts) (bool, error) {
	var node map[string]json.RawMessage
	if err := json.Unmarshal(raw, &node); err != nil {
		return false, fmt.Errorf("predicate is not an object: %w", err)
	}
	if sub, ok := node["all"]; ok {
		var terms []json.RawMessage
		if err := json.Unmarshal(sub, &terms); err != nil || len(terms) == 0 {
			return false, errors.New("all: want non-empty array")
		}
		for _, t := range terms {
			hit, err := evalPredicate(t, facts)
			if err != nil {
				return false, err
			}
			if !hit {
				return false, nil
			}
		}
		return true, nil
	}
	if sub, ok := node["any"]; ok {
		var terms []json.RawMessage
		if err := json.Unmarshal(sub, &terms); err != nil || len(terms) == 0 {
			return false, errors.New("any: want non-empty array")
		}
		for _, t := range terms {
			hit, err := evalPredicate(t, facts)
			if err != nil {
				return false, err
			}
			if hit {
				return true, nil
			}
		}
		return false, nil
	}
	if sub, ok := node["not"]; ok {
		hit, err := evalPredicate(sub, facts)
		if err != nil {
			return false, err
		}
		return !hit, nil
	}
	return evalTerm(node, facts)
}

func evalTerm(node map[string]json.RawMessage, facts Facts) (bool, error) {
	var field, op string
	if err := json.Unmarshal(node["field"], &field); err != nil {
		return false, errors.New("term: field must be a string")
	}
	if err := json.Unmarshal(node["op"], &op); err != nil {
		return false, errors.New("term: op must be a string")
	}
	rawValue, ok := node["value"]
	if !ok {
		return false, errors.New("term: value is required")
	}

	// String-variable terms: var.<name>
	if len(field) > 4 && field[:4] == "var." {
		var s string
		if err := json.Unmarshal(rawValue, &s); err == nil {
			return compareString(facts.Variables[field[4:]], op, s)
		}
		var arr []string
		if err := json.Unmarshal(rawValue, &arr); err != nil {
			return false, fmt.Errorf("term %s: value must be string or string array", field)
		}
		if op != "in" {
			return false, fmt.Errorf("term %s: array value only valid with op=in", field)
		}
		for _, s := range arr {
			if facts.Variables[field[4:]] == s {
				return true, nil
			}
		}
		return false, nil
	}

	actual, err := numericField(field, facts)
	if err != nil {
		return false, err
	}
	var want float64
	if err := json.Unmarshal(rawValue, &want); err != nil {
		return false, fmt.Errorf("term %s: value must be numeric: %w", field, err)
	}
	if math.IsNaN(want) || math.IsInf(want, 0) {
		return false, fmt.Errorf("term %s: value must be finite", field)
	}
	return compareNumber(actual, op, want)
}

func numericField(field string, facts Facts) (float64, error) {
	switch field {
	case "sumInsuredKobo":
		return float64(facts.SumInsuredKobo), nil
	case "premiumKobo":
		return float64(facts.PremiumKobo), nil
	case "exposures":
		return facts.Exposures, nil
	case "fraudScore":
		raw, ok := facts.Variables["fraud_score"]
		if !ok || raw == "" {
			return 0, errors.New("fraudScore: quote carries no fraud_score variable")
		}
		var v float64
		if _, err := fmt.Sscanf(raw, "%g", &v); err != nil {
			return 0, fmt.Errorf("fraudScore: %q not numeric", raw)
		}
		return v, nil
	default:
		return 0, fmt.Errorf("unknown field %q", field)
	}
}

func compareNumber(actual float64, op string, want float64) (bool, error) {
	switch op {
	case "gt":
		return actual > want, nil
	case "gte":
		return actual >= want, nil
	case "lt":
		return actual < want, nil
	case "lte":
		return actual <= want, nil
	case "eq":
		return actual == want, nil
	case "ne":
		return actual != want, nil
	default:
		return false, fmt.Errorf("op %q not valid for numeric field", op)
	}
}

func compareString(actual, op, want string) (bool, error) {
	switch op {
	case "eq":
		return actual == want, nil
	case "ne":
		return actual != want, nil
	case "in":
		return actual == want, nil
	default:
		return false, fmt.Errorf("op %q not valid for string variable", op)
	}
}
