-- Fix seed for tables with different column names

INSERT INTO analytics_metrics (id, "metricName", value, "bucketMinute", tags, "createdAt") VALUES
(1, 'total_premium_collected', 45000000, NOW() - INTERVAL '1 day', '{"period":"2026-Q2","currency":"NGN"}', NOW() - INTERVAL '1 day'),
(2, 'claims_paid', 12500000, NOW() - INTERVAL '1 day', '{"period":"2026-Q2","currency":"NGN"}', NOW() - INTERVAL '1 day'),
(3, 'active_policies', 23, NOW() - INTERVAL '1 day', '{"period":"2026-Q2"}', NOW() - INTERVAL '1 day'),
(4, 'loss_ratio', 0.278, NOW() - INTERVAL '1 day', '{"period":"2026-Q2"}', NOW() - INTERVAL '1 day'),
(5, 'customer_satisfaction', 4.6, NOW() - INTERVAL '1 day', '{"period":"2026-Q2","scale":"1-5"}', NOW() - INTERVAL '1 day'),
(6, 'new_customers', 8, NOW() - INTERVAL '1 day', '{"period":"2026-Q2"}', NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

INSERT INTO backup_snapshots (id, snapshot_type, size_bytes, status, storage_url, tables_included, rows_backed_up, duration_ms, rto_minutes, rpo_minutes, triggered_by, completed_at, created_at) VALUES
(1, 'full', 2147483648, 'completed', 's3://insureportal-backups/full/2026-06-01.tar.gz', 264, 15000, 900000, 30, 15, 'scheduled', NOW() - INTERVAL '5 days' + INTERVAL '15 minutes', NOW() - INTERVAL '5 days'),
(2, 'incremental', 104857600, 'completed', 's3://insureportal-backups/incr/2026-06-03.tar.gz', 264, 500, 120000, 30, 5, 'scheduled', NOW() - INTERVAL '3 days' + INTERVAL '2 minutes', NOW() - INTERVAL '3 days'),
(3, 'full', 2252341248, 'completed', 's3://insureportal-backups/full/2026-06-05.tar.gz', 264, 16500, 1080000, 30, 15, 'scheduled', NOW() - INTERVAL '1 day' + INTERVAL '18 minutes', NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;

INSERT INTO fee_rules (id, name, tx_type, agent_tier, min_amount, max_amount, fee_type, fee_value, min_fee, max_fee, is_active, priority, created_at) VALUES
(1, 'NAICOM Levy', 'premium', 'all', 0, 999999999, 'percentage', 1.0, 100, 50000, true, 1, NOW() - INTERVAL '365 days'),
(2, 'Stamp Duty', 'policy', 'all', 0, 999999999, 'flat', 50, 50, 50, true, 2, NOW() - INTERVAL '365 days'),
(3, 'Processing Fee', 'claim_payout', 'all', 0, 999999999, 'percentage', 0.5, 50, 5000, true, 3, NOW() - INTERVAL '180 days'),
(4, 'Late Payment Penalty', 'overdue_premium', 'all', 0, 999999999, 'percentage', 2.5, 1000, 100000, true, 4, NOW() - INTERVAL '180 days')
ON CONFLICT DO NOTHING;

INSERT INTO knowledge_graph_nodes (id, "userId", "nodeId", "entityType", label, properties, "createdAt") VALUES
(1, 1, 'prod-motor', 'product', 'Motor Comprehensive', '{"category":"Motor","premium_range":"50K-500K"}', NOW() - INTERVAL '180 days'),
(2, 1, 'prod-health', 'product', 'Health Family', '{"category":"Health","premium_range":"100K-1M"}', NOW() - INTERVAL '180 days'),
(3, 1, 'reg-naicom', 'regulation', 'NAICOM Act 2003', '{"jurisdiction":"Nigeria","sector":"insurance"}', NOW() - INTERVAL '180 days'),
(4, 1, 'risk-flood', 'risk', 'Lagos Flood Risk', '{"type":"parametric","trigger":"rainfall>200mm"}', NOW() - INTERVAL '120 days'),
(5, 1, 'ent-leadway', 'entity', 'Leadway Assurance', '{"type":"reinsurer","rating":"A-"}', NOW() - INTERVAL '90 days')
ON CONFLICT DO NOTHING;

INSERT INTO knowledge_graph_edges (id, "userId", "sourceNodeId", "targetNodeId", relationship, weight, "createdAt") VALUES
(1, 1, 'prod-motor', 'reg-naicom', 'regulated_by', 1.0, NOW() - INTERVAL '180 days'),
(2, 1, 'prod-health', 'reg-naicom', 'regulated_by', 1.0, NOW() - INTERVAL '180 days'),
(3, 1, 'prod-motor', 'risk-flood', 'covers_risk', 0.7, NOW() - INTERVAL '120 days'),
(4, 1, 'prod-motor', 'ent-leadway', 'reinsured_by', 0.8, NOW() - INTERVAL '90 days')
ON CONFLICT DO NOTHING;

INSERT INTO sla_definitions (id, name, service_type, metric_type, target_value, warning_threshold, critical_threshold, measurement_window, is_active, created_at) VALUES
(1, 'Claims Processing Time', 'claims', 'processing_hours', 72, 48, 72, '30 days', true, NOW() - INTERVAL '365 days'),
(2, 'Policy Issuance Time', 'policy', 'issuance_hours', 24, 16, 24, '30 days', true, NOW() - INTERVAL '365 days'),
(3, 'Customer Response Time', 'support', 'response_hours', 4, 2, 4, '7 days', true, NOW() - INTERVAL '180 days'),
(4, 'NAICOM Filing Deadline', 'compliance', 'filing_hours', 720, 480, 720, '90 days', true, NOW() - INTERVAL '365 days')
ON CONFLICT DO NOTHING;

INSERT INTO transactions (id, ref, "agentId", type, amount, fee, commission, "customerName", "customerPhone", channel, status, currency, "createdAt") VALUES
(1, 'TXN-2026-001', 1, 'premium_payment', 125000, 1250, 18750, 'Patrick Munis', '+2348012345678', 'web', 'completed', 'NGN', NOW() - INTERVAL '60 days'),
(2, 'TXN-2026-002', 2, 'premium_payment', 150000, 1500, 18000, 'Chioma Okafor', '+2348098765432', 'web', 'completed', 'NGN', NOW() - INTERVAL '45 days'),
(3, 'TXN-2026-003', 1, 'claim_payout', 350000, 1750, 0, 'Emeka Eze', '+2348055544433', 'bank', 'completed', 'NGN', NOW() - INTERVAL '20 days'),
(4, 'TXN-2026-004', 3, 'premium_payment', 75000, 750, 15000, 'Aisha Bello', '+2348077788899', 'ussd', 'completed', 'NGN', NOW() - INTERVAL '15 days'),
(5, 'TXN-2026-005', 1, 'premium_payment', 200000, 2000, 20000, 'Olumide Adeyemi', '+2348066677788', 'mobile', 'pending', 'NGN', NOW() - INTERVAL '2 days')
ON CONFLICT DO NOTHING;

ANALYZE;
