package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// DevOps Platform — CI/CD, infrastructure management, deployment orchestration
// Business Rules:
// - Deployment strategy: Blue/green with canary validation
// - Rollback: Automatic if error rate > 1% in first 5 minutes
// - Environment: dev → staging → production (manual gate for prod)
// - Infrastructure: K8s on AWS EKS, multi-AZ
// - Monitoring: Full stack observability (Prometheus, Grafana, OpenSearch)

var kafkaRestURL string

func initKafka() {
	kafkaRestURL = os.Getenv("KAFKA_REST_URL")
	if kafkaRestURL == "" {
		kafkaRestURL = "http://localhost:8082"
	}
	log.Printf("Kafka REST proxy configured at %s", kafkaRestURL)
}

func publishEvent(topic string, key string, payload interface{}) {
	if kafkaRestURL == "" {
		return
	}
	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("WARN: kafka marshal error: %v", err)
		return
	}
	msg := map[string]interface{}{
		"records": []map[string]interface{}{
			{"key": key, "value": string(data)},
		},
	}
	body, _ := json.Marshal(msg)
	resp, err := http.Post(kafkaRestURL+"/topics/"+topic, "application/vnd.kafka.json.v2+json", bytes.NewReader(body))
	if err != nil {
		log.Printf("WARN: kafka publish error: %v", err)
		return
	}
	defer resp.Body.Close()
}

func main() {
	initKafka()
	r := chi.NewRouter()
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "devops-platform"})
	})
	r.Get("/api/v1/deployments", listDeployments)
	r.Post("/api/v1/deploy", triggerDeploy)
	r.Get("/api/v1/infrastructure", infraStatus)

	port := os.Getenv("PORT")
	if port == "" { port = "8136" }
	log.Printf("DevOps Platform starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

func listDeployments(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"deployments": []map[string]interface{}{
			{"id": "DEP-001", "service": "customer-portal", "version": "2.5.1", "environment": "production", "status": "healthy", "deployed_at": time.Now().AddDate(0, 0, -2).Format(time.RFC3339)},
			{"id": "DEP-002", "service": "claims-engine", "version": "1.8.0", "environment": "staging", "status": "canary_validating", "deployed_at": time.Now().Add(-30 * time.Minute).Format(time.RFC3339)},
		},
	})
}

func triggerDeploy(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"deployment_id": "DEP-" + time.Now().Format("20060102150405"),
		"strategy": "blue_green", "canary_pct": 10, "auto_rollback": true,
		"rollback_threshold": "error_rate > 1%", "status": "in_progress",
	})
}

func infraStatus(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"cluster": "eks-insureportal-prod", "nodes": 12, "pods_running": 85,
		"cpu_utilization": 45, "memory_utilization": 62,
		"availability_zones": []string{"af-south-1a", "af-south-1b", "af-south-1c"},
	})
}
