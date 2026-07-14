# InsurePortal — Security Breach Response

## Immediate Actions (0-15 min)
1. **Isolate affected service** — `kubectl scale deployment/<service> --replicas=0`
2. **Rotate all secrets** — API keys, JWT signing keys, database passwords
3. **Enable audit logging** — Ensure all database queries are logged
4. **Notify security team** — Escalate to CTO and compliance officer

## Investigation
```bash
# Review audit log for suspicious activity
psql $DATABASE_URL -c "SELECT * FROM audit_log WHERE action IN ('login_failed', 'permission_denied', 'data_export') AND \"createdAt\" > NOW() - INTERVAL '24 hours' ORDER BY \"createdAt\" DESC;"

# Check for unauthorized API access
grep -r "401\|403\|rate limit" /var/log/<service>/*.log | tail -100

# Review JWT token issuance
psql $DATABASE_URL -c "SELECT * FROM sessions WHERE \"createdAt\" > NOW() - INTERVAL '24 hours' ORDER BY \"createdAt\" DESC LIMIT 50;"
```

## Data Breach Notification (NDPR compliance — 72 hour deadline)
1. Document scope of breach (affected records, data types)
2. Notify NITDA within 72 hours
3. Notify affected data subjects "without undue delay"
4. Prepare remediation plan
