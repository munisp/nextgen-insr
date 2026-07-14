# InsurePortal — Deployment Runbook

## Standard Deployment
```bash
# 1. Build and push Docker image
docker build -t insureportal/<service>:$(git rev-parse --short HEAD) ./<service>/
docker push insureportal/<service>:$(git rev-parse --short HEAD)

# 2. Update Kubernetes deployment
kubectl set image deployment/<service> <service>=insureportal/<service>:$(git rev-parse --short HEAD) -n insureportal

# 3. Monitor rollout
kubectl rollout status deployment/<service> -n insureportal --timeout=5m

# 4. Verify health
curl -s http://<service>:8091/health | jq .
curl -s http://<service>:8091/ready | jq .
```

## Rollback
```bash
# Immediate rollback to previous version
kubectl rollout undo deployment/<service> -n insureportal

# Rollback to specific revision
kubectl rollout undo deployment/<service> --to-revision=<N> -n insureportal
```

## Blue-Green Deployment
```bash
# Deploy new version as "green"
kubectl apply -f k8s/<service>-green.yaml -n insureportal

# Verify green is healthy
curl -s http://<service>-green:8091/health | jq .

# Switch traffic via APISIX
apisix route update --upstream green

# Remove old "blue" deployment
kubectl delete -f k8s/<service>-blue.yaml -n insureportal
```

## Canary Deployment
```bash
# Deploy canary (10% traffic)
kubectl apply -f k8s/<service>-canary.yaml -n insureportal
apisix upstream update --weight blue=90,canary=10

# Monitor error rate for 15 minutes
# If error rate < 1%, proceed to 50%
apisix upstream update --weight blue=50,canary=50

# If stable, promote to 100%
apisix upstream update --weight canary=100
kubectl delete -f k8s/<service>-blue.yaml -n insureportal
```
