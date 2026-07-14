# InsurePortal — Incident Response Runbook

## Severity Levels
| Level | Definition | Response Time | Escalation |
|-------|-----------|--------------|------------|
| SEV-1 | Platform-wide outage, data loss, security breach | 15 min | VP Engineering + CTO |
| SEV-2 | Single service down, degraded performance | 30 min | Engineering Lead |
| SEV-3 | Non-critical feature broken, cosmetic issues | 4 hours | On-call engineer |

## Incident Response Steps

### 1. Detection & Triage (0-5 min)
```bash
# Check service health
curl -s http://<service>:8091/health | jq .
curl -s http://<service>:8091/ready | jq .

# Check Prometheus alerts
curl -s http://prometheus:9090/api/v1/alerts | jq '.data.alerts[] | {alert: .labels.alertname, state: .state}'

# Check Kafka consumer lag
curl -s http://kafka-ui:8080/api/clusters/insureportal/consumer-groups | jq '.[] | {group: .groupId, lag: .totalLag}'
```

### 2. Containment (5-15 min)
```bash
# Scale down problematic service
kubectl scale deployment <service> --replicas=0 -n insureportal

# Enable circuit breaker bypass
kubectl set env deployment/<service> CIRCUIT_BREAKER_DISABLED=true -n insureportal

# Redirect traffic via APISIX
curl -X PUT http://apisix-admin:9180/apisix/admin/routes/<route-id> \
  -H "X-API-KEY: $APISIX_ADMIN_KEY" \
  -d '{"upstream":{"nodes":{"fallback-service:8080":1}}}'
```

### 3. Investigation
```bash
# Service logs (last 30 min)
kubectl logs -l app=<service> --since=30m -n insureportal | jq .

# Database connections
psql $DATABASE_URL -c "SELECT * FROM pg_stat_activity WHERE datname='insureportal' ORDER BY backend_start DESC LIMIT 20;"

# Kafka consumer group status
kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group <consumer-group>
```

### 4. Resolution & Recovery
```bash
# Restart service
kubectl rollout restart deployment/<service> -n insureportal

# Verify health
kubectl get pods -l app=<service> -n insureportal
curl -s http://<service>:8091/health | jq .

# Run integration test
go test ./<service>/... -run TestIntegration -count=1 -timeout 60s
```

### 5. Post-Incident
- Create incident report within 24 hours
- Update monitoring/alerting if gap identified
- Add regression test for the failure mode
- Update this runbook if process improvement identified
