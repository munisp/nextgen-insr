package referral

import (
	"encoding/json"
	"testing"
)

func facts() Facts {
	return Facts{
		Line:           "motor",
		SumInsuredKobo: 2_000_000_000,
		Exposures:      1,
		GeoCell:        "lagos_mainland",
		Variables:      map[string]string{"age_band": "2", "imei_status": "clean", "fraud_score": "0.20"},
	}
}

func rule(id int64, priority int, pred string, action, reason string) Rule {
	return Rule{
		ID: id, Line: "motor", Priority: priority,
		Predicate: json.RawMessage(pred), Action: action, ReasonCode: reason, IsActive: true,
	}
}

func TestNumericThresholds(t *testing.T) {
	e := NewEngine()
	e.Swap([]Rule{
		rule(1, 10, `{"field":"sumInsuredKobo","op":"gt","value":3000000000}`, "refer", "SI_THRESHOLD"),
	})
	out := e.Evaluate(facts())
	if out.Action != "pass" {
		t.Errorf("2bn SI must pass a 3bn threshold, got %v", out)
	}
	f := facts()
	f.SumInsuredKobo = 3_500_000_000
	out = e.Evaluate(f)
	if out.Action != "refer" || out.ReasonCode != "SI_THRESHOLD" || out.RuleID != 1 {
		t.Errorf("3.5bn SI must refer SI_THRESHOLD, got %+v", out)
	}
}

func TestCompositePredicates(t *testing.T) {
	e := NewEngine()
	e.Swap([]Rule{
		rule(1, 10, `{"all":[
			{"field":"sumInsuredKobo","op":"gte","value":1000000000},
			{"any":[
				{"field":"var.age_band","op":"eq","value":"1"},
				{"field":"var.age_band","op":"eq","value":"2"}
			]},
			{"not":{"field":"var.imei_status","op":"eq","value":"duplicate"}}
		]}`, "refer", "COMPOSITE_HIT"),
	})
	out := e.Evaluate(facts())
	if out.Action != "refer" || out.ReasonCode != "COMPOSITE_HIT" {
		t.Errorf("composite predicate must fire, got %+v", out)
	}
	f := facts()
	f.Variables["imei_status"] = "duplicate"
	out = e.Evaluate(f)
	if out.Action != "pass" {
		t.Errorf("not-branch must suppress, got %+v", out)
	}
}

func TestPriorityOrderFirstHitWins(t *testing.T) {
	e := NewEngine()
	// Swap order is irrelevant — the engine sorts by (priority, id).
	e.Swap([]Rule{
		rule(2, 20, `{"field":"sumInsuredKobo","op":"gt","value":1}`, "refer", "LOW_PRIORITY"),
		rule(1, 10, `{"field":"sumInsuredKobo","op":"gt","value":1}`, "decline", "HIGH_PRIORITY"),
	})
	out := e.Evaluate(facts())
	if out.Action != "decline" || out.ReasonCode != "HIGH_PRIORITY" {
		t.Errorf("priority ordering broken: %+v", out)
	}
}

func TestInactiveAndOtherLineSkipped(t *testing.T) {
	e := NewEngine()
	r := rule(1, 10, `{"field":"sumInsuredKobo","op":"gt","value":1}`, "refer", "X")
	r.IsActive = false
	r2 := rule(2, 10, `{"field":"sumInsuredKobo","op":"gt","value":1}`, "refer", "X")
	r2.Line = "health"
	e.Swap([]Rule{r, r2})
	if out := e.Evaluate(facts()); out.Action != "pass" {
		t.Errorf("inactive/other-line rules must be skipped, got %+v", out)
	}
}

// TestEngineErrorFailsClosed is the C2d-mirroring contract: a malformed
// predicate is an engine failure → refer (REFERRAL_ENGINE_ERROR), never
// silently skip → accept.
func TestEngineErrorFailsClosed(t *testing.T) {
	cases := map[string]string{
		"not an object":  `[1,2,3]`,
		"unknown op":     `{"field":"sumInsuredKobo","op":"between","value":1}`,
		"unknown field":  `{"field":"nonsense","op":"gt","value":1}`,
		"missing value":  `{"field":"sumInsuredKobo","op":"gt"}`,
		"bad value type": `{"field":"sumInsuredKobo","op":"gt","value":"big"}`,
		"empty all":      `{"all":[]}`,
		"missing fact":   `{"field":"fraudScore","op":"gte","value":0.5}`,
	}
	for name, pred := range cases {
		t.Run(name, func(t *testing.T) {
			e := NewEngine()
			e.Swap([]Rule{rule(9, 10, pred, "refer", "ORIGINAL")})
			f := facts()
			if name == "missing fact" {
				delete(f.Variables, "fraud_score")
			}
			out := e.Evaluate(f)
			if out.Action != "refer" || out.ReasonCode != "REFERRAL_ENGINE_ERROR" {
				t.Errorf("malformed predicate must fail closed: %+v", out)
			}
		})
	}
}

func TestInOperator(t *testing.T) {
	e := NewEngine()
	e.Swap([]Rule{
		rule(1, 10, `{"field":"var.age_band","op":"in","value":["1","2"]}`, "refer", "AGE_IN"),
	})
	if out := e.Evaluate(facts()); out.Action != "refer" {
		t.Errorf("in-operator must match, got %+v", out)
	}
	f := facts()
	f.Variables["age_band"] = "5"
	if out := e.Evaluate(f); out.Action != "pass" {
		t.Errorf("in-operator must not match 5, got %+v", out)
	}
}

func TestFraudScoreFact(t *testing.T) {
	e := NewEngine()
	e.Swap([]Rule{
		rule(1, 10, `{"field":"fraudScore","op":"gte","value":0.85}`, "refer", "FRAUD_SCORE"),
	})
	f := facts()
	f.Variables["fraud_score"] = "0.90"
	if out := e.Evaluate(f); out.Action != "refer" || out.ReasonCode != "FRAUD_SCORE" {
		t.Errorf("fraud score 0.90 must refer, got %+v", out)
	}
	f.Variables["fraud_score"] = "0.10"
	if out := e.Evaluate(f); out.Action != "pass" {
		t.Errorf("fraud score 0.10 must pass, got %+v", out)
	}
}
