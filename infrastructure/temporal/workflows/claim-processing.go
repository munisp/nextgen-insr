package workflows

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// ClaimProcessingWorkflow orchestrates the entire claim lifecycle
// Steps: validate → fraud score → adjudicate → payout/reject → notify
func ClaimProcessingWorkflow(ctx workflow.Context, claimID int64) error {
	retryPolicy := &temporal.RetryPolicy{
		InitialInterval:    time.Second,
		BackoffCoefficient: 2.0,
		MaximumInterval:    time.Minute * 5,
		MaximumAttempts:    3,
	}
	opts := workflow.ActivityOptions{
		StartToCloseTimeout: time.Minute * 10,
		RetryPolicy:         retryPolicy,
	}
	ctx = workflow.WithActivityOptions(ctx, opts)

	// Step 1: Validate claim data completeness
	var validationResult ValidationResult
	err := workflow.ExecuteActivity(ctx, ValidateClaimActivity, claimID).Get(ctx, &validationResult)
	if err != nil {
		return err
	}
	if !validationResult.Valid {
		return workflow.ExecuteActivity(ctx, RejectClaimActivity, claimID, "validation_failed", validationResult.Errors).Get(ctx, nil)
	}

	// Step 2: Run fraud detection scoring
	var fraudScore FraudScoreResult
	err = workflow.ExecuteActivity(ctx, ScoreFraudActivity, claimID).Get(ctx, &fraudScore)
	if err != nil {
		return err
	}

	// Step 3: Auto-reject if critical fraud risk
	if fraudScore.Score >= 80 {
		return workflow.ExecuteActivity(ctx, RejectClaimActivity, claimID, "fraud_detected", nil).Get(ctx, nil)
	}

	// Step 4: Route to manual review if high risk, auto-approve if low
	if fraudScore.Score >= 50 {
		// Wait for manual adjudication (human-in-the-loop)
		var decision string
		signalCh := workflow.GetSignalChannel(ctx, "adjudication-decision")
		signalCh.Receive(ctx, &decision)

		if decision == "reject" {
			return workflow.ExecuteActivity(ctx, RejectClaimActivity, claimID, "adjudicator_rejected", nil).Get(ctx, nil)
		}
	}

	// Step 5: Process payout
	err = workflow.ExecuteActivity(ctx, ProcessPayoutActivity, claimID).Get(ctx, nil)
	if err != nil {
		return err
	}

	// Step 6: Send notifications
	return workflow.ExecuteActivity(ctx, NotifyClaimantActivity, claimID, "approved").Get(ctx, nil)
}

// ParametricPayoutWorkflow handles auto-triggered parametric insurance payouts
func ParametricPayoutWorkflow(ctx workflow.Context, policyID int64, triggerData TriggerData) error {
	opts := workflow.ActivityOptions{
		StartToCloseTimeout: time.Minute * 5,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 5,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, opts)

	// Step 1: Verify trigger conditions from multiple data sources
	var verified bool
	err := workflow.ExecuteActivity(ctx, VerifyTriggerActivity, policyID, triggerData).Get(ctx, &verified)
	if err != nil || !verified {
		return err
	}

	// Step 2: Calculate payout amount based on trigger severity
	var payoutAmount float64
	err = workflow.ExecuteActivity(ctx, CalculateParametricPayoutActivity, policyID, triggerData).Get(ctx, &payoutAmount)
	if err != nil {
		return err
	}

	// Step 3: Execute payout via TigerBeetle ledger
	err = workflow.ExecuteActivity(ctx, ExecutePayoutActivity, policyID, payoutAmount).Get(ctx, nil)
	if err != nil {
		return err
	}

	// Step 4: Notify policyholder
	return workflow.ExecuteActivity(ctx, NotifyParametricPayoutActivity, policyID, payoutAmount).Get(ctx, nil)
}

// P2PPoolClaimWorkflow manages peer voting and payout for microinsurance pools
func P2PPoolClaimWorkflow(ctx workflow.Context, poolID, claimID int64) error {
	opts := workflow.ActivityOptions{
		StartToCloseTimeout: time.Hour * 72, // 72-hour voting window
	}
	ctx = workflow.WithActivityOptions(ctx, opts)

	// Step 1: Notify all pool members of the claim
	err := workflow.ExecuteActivity(ctx, NotifyPoolMembersActivity, poolID, claimID).Get(ctx, nil)
	if err != nil {
		return err
	}

	// Step 2: Wait for voting period (72 hours or quorum reached)
	votingCtx, cancelVoting := workflow.WithCancel(ctx)
	defer cancelVoting()

	var voteResult VoteResult
	timer := workflow.NewTimer(votingCtx, 72*time.Hour)

	voteCh := workflow.GetSignalChannel(ctx, "pool-vote")
	for {
		selector := workflow.NewSelector(ctx)
		selector.AddFuture(timer, func(f workflow.Future) {
			// Voting period expired
		})
		selector.AddReceive(voteCh, func(ch workflow.ReceiveChannel, more bool) {
			var vote Vote
			ch.Receive(ctx, &vote)
			voteResult.AddVote(vote)
		})
		selector.Select(ctx)

		if voteResult.QuorumReached() || timer.IsReady() {
			break
		}
	}

	// Step 3: Process result
	if voteResult.Approved() {
		return workflow.ExecuteActivity(ctx, ProcessP2PPayoutActivity, poolID, claimID).Get(ctx, nil)
	}
	return workflow.ExecuteActivity(ctx, RejectP2PClaimActivity, poolID, claimID).Get(ctx, nil)
}

// Types used by workflows
type ValidationResult struct {
	Valid  bool
	Errors []string
}

type FraudScoreResult struct {
	Score          float64
	Risk           string
	Recommendation string
}

type TriggerData struct {
	MetricType string
	Value      float64
	Threshold  float64
	Region     string
	DataSource string
}

type VoteResult struct {
	For     int
	Against int
	Total   int
	Quorum  int
}

func (v *VoteResult) AddVote(vote Vote) {
	if vote.Approve {
		v.For++
	} else {
		v.Against++
	}
	v.Total++
}

func (v *VoteResult) QuorumReached() bool {
	return v.Total >= v.Quorum
}

func (v *VoteResult) Approved() bool {
	threshold := float64(v.Quorum) * 0.67
	return float64(v.For) >= threshold
}

type Vote struct {
	VoterID int64
	Approve bool
	Reason  string
}
