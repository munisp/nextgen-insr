package main

import (
	"log"
	"os"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

func main() {
	// Create Temporal client
	temporalHost := os.Getenv("TEMPORAL_HOST")
	if temporalHost == "" {
		temporalHost = "localhost:7233"
	}

	c, err := client.Dial(client.Options{
		HostPort:  temporalHost,
		Namespace: "insureportal",
	})
	if err != nil {
		log.Fatalf("unable to create Temporal client: %v", err)
	}
	defer c.Close()

	// Create worker for the InsurePortal task queue
	w := worker.New(c, "insureportal-claims", worker.Options{
		MaxConcurrentActivityExecutionSize:     100,
		MaxConcurrentWorkflowTaskExecutionSize: 50,
	})

	// Register workflows
	// w.RegisterWorkflow(workflows.ClaimProcessingWorkflow)
	// w.RegisterWorkflow(workflows.ParametricPayoutWorkflow)
	// w.RegisterWorkflow(workflows.P2PPoolClaimWorkflow)

	// Register activities
	// w.RegisterActivity(activities.ValidateClaimActivity)
	// w.RegisterActivity(activities.ScoreFraudActivity)
	// w.RegisterActivity(activities.ProcessPayoutActivity)
	// w.RegisterActivity(activities.NotifyClaimantActivity)

	log.Println("Temporal worker starting on task queue: insureportal-claims")
	err = w.Run(worker.InterruptCh())
	if err != nil {
		log.Fatalf("worker run failed: %v", err)
	}
}
