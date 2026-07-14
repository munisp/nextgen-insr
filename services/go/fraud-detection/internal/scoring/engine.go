package scoring

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"time"

	"github.com/munisp/ngapp/services/fraud-detection/internal/store"
)

// FraudScore represents the fraud assessment result for a claim
type FraudScore struct {
	ClaimID        int64     `json:"claimId"`
	Score          float64   `json:"score"`          // 0-100, higher = more suspicious
	Risk           string    `json:"risk"`           // low, medium, high, critical
	Factors        []Factor  `json:"factors"`        // contributing factors
	Recommendation string    `json:"recommendation"` // auto_approve, manual_review, auto_reject
	ScoredAt       time.Time `json:"scoredAt"`
}

// Factor represents a single fraud indicator
type Factor struct {
	Name   string  `json:"name"`
	Weight float64 `json:"weight"`
	Score  float64 `json:"score"`
	Detail string  `json:"detail"`
}

// Engine handles fraud scoring logic
type Engine struct {
	db    *store.Postgres
	cache *store.Redis
}

func NewEngine(db *store.Postgres, cache *store.Redis) *Engine {
	return &Engine{db: db, cache: cache}
}

// ScoreClaim evaluates a claim for fraud risk using multiple signals
func (e *Engine) ScoreClaim(ctx context.Context, claimID int64) (*FraudScore, error) {
	// Check cache first
	cached, err := e.cache.GetClaimScore(ctx, claimID)
	if err == nil && cached != nil {
		if fs, ok := cached.(*FraudScore); ok {
			return fs, nil
		}
	}

	// Fetch claim details
	claim, err := e.db.GetClaim(ctx, claimID)
	if err != nil {
		return nil, fmt.Errorf("fetch claim %d: %w", claimID, err)
	}

	var factors []Factor
	totalScore := 0.0
	totalWeight := 0.0

	// Factor 1: Claim frequency (multiple claims in short period)
	frequency, err := e.db.GetClaimFrequency(ctx, claim.UserID, 90) // last 90 days
	if err == nil {
		freqScore := math.Min(float64(frequency)*20, 100)
		factors = append(factors, Factor{
			Name:   "claim_frequency",
			Weight: 0.25,
			Score:  freqScore,
			Detail: fmt.Sprintf("%d claims in last 90 days", frequency),
		})
		totalScore += freqScore * 0.25
		totalWeight += 0.25
	}

	// Factor 2: Amount anomaly (compared to policy average)
	avgAmount, err := e.db.GetAverageClaimAmount(ctx, claim.PolicyType)
	if err == nil && avgAmount > 0 {
		deviation := math.Abs(claim.Amount-avgAmount) / avgAmount
		anomalyScore := math.Min(deviation*50, 100)
		factors = append(factors, Factor{
			Name:   "amount_anomaly",
			Weight: 0.20,
			Score:  anomalyScore,
			Detail: fmt.Sprintf("%.1f%% deviation from average (%.2f vs %.2f)", deviation*100, claim.Amount, avgAmount),
		})
		totalScore += anomalyScore * 0.20
		totalWeight += 0.20
	}

	// Factor 3: Timing pattern (claims near policy start/end)
	daysSinceStart := time.Since(claim.PolicyStartDate).Hours() / 24
	daysUntilEnd := time.Until(claim.PolicyEndDate).Hours() / 24
	timingScore := 0.0
	if daysSinceStart < 30 {
		timingScore = 60 // Early claim is suspicious
	} else if daysUntilEnd < 14 {
		timingScore = 40 // Near-expiry claim is mildly suspicious
	}
	factors = append(factors, Factor{
		Name:   "timing_pattern",
		Weight: 0.15,
		Score:  timingScore,
		Detail: fmt.Sprintf("%.0f days since policy start, %.0f days until end", daysSinceStart, daysUntilEnd),
	})
	totalScore += timingScore * 0.15
	totalWeight += 0.15

	// Factor 4: Description similarity (duplicate claims check)
	similarCount, err := e.db.FindSimilarClaims(ctx, claim.Description, claim.UserID)
	if err == nil {
		simScore := math.Min(float64(similarCount)*40, 100)
		factors = append(factors, Factor{
			Name:   "description_similarity",
			Weight: 0.20,
			Score:  simScore,
			Detail: fmt.Sprintf("%d similar claims found for this user", similarCount),
		})
		totalScore += simScore * 0.20
		totalWeight += 0.20
	}

	// Factor 5: Network analysis (connected to known fraudsters)
	networkRisk, err := e.db.GetNetworkRiskScore(ctx, claim.UserID)
	if err == nil {
		factors = append(factors, Factor{
			Name:   "network_risk",
			Weight: 0.20,
			Score:  networkRisk,
			Detail: fmt.Sprintf("network fraud risk score: %.1f", networkRisk),
		})
		totalScore += networkRisk * 0.20
		totalWeight += 0.20
	}

	// Normalize score
	finalScore := 0.0
	if totalWeight > 0 {
		finalScore = totalScore / totalWeight * (totalWeight / 1.0)
	}
	finalScore = math.Min(finalScore, 100)

	result := &FraudScore{
		ClaimID:  claimID,
		Score:    math.Round(finalScore*100) / 100,
		Risk:     classifyRisk(finalScore),
		Factors:  factors,
		ScoredAt: time.Now(),
	}
	result.Recommendation = recommend(finalScore)

	// Cache result (TTL 1 hour)
	e.cache.SetClaimScore(ctx, claimID, result, time.Hour)

	// Persist to DB
	e.db.SaveFraudScore(ctx, result)

	return result, nil
}

// ConsumeClaimEvents processes Kafka claim events and auto-scores them
func (e *Engine) ConsumeClaimEvents(ctx context.Context, consumer *store.KafkaConsumer) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
			msg, err := consumer.ReadMessage(ctx, 5*time.Second)
			if err != nil {
				continue
			}

			var event struct {
				ClaimID int64  `json:"claimId"`
				Action  string `json:"action"`
			}
			if err := json.Unmarshal(msg.Value, &event); err != nil {
				log.Printf("failed to unmarshal claim event: %v", err)
				continue
			}

			if event.Action == "submitted" || event.Action == "updated" {
				score, err := e.ScoreClaim(ctx, event.ClaimID)
				if err != nil {
					log.Printf("failed to score claim %d: %v", event.ClaimID, err)
					continue
				}
				log.Printf("scored claim %d: %.1f (%s) → %s", event.ClaimID, score.Score, score.Risk, score.Recommendation)
			}
		}
	}
}

func classifyRisk(score float64) string {
	switch {
	case score >= 80:
		return "critical"
	case score >= 60:
		return "high"
	case score >= 40:
		return "medium"
	default:
		return "low"
	}
}

func recommend(score float64) string {
	switch {
	case score >= 80:
		return "auto_reject"
	case score >= 50:
		return "manual_review"
	default:
		return "auto_approve"
	}
}
