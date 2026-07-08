// @ts-check

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Database Performance Configuration Tests
 * Validates that all performance tuning artifacts exist and are correctly configured.
 */

const infraDir = path.join(__dirname, "..", "infra", "postgres");

describe("PostgreSQL Performance Configuration", () => {
  describe("Production Configuration", () => {
    const confPath = path.join(infraDir, "postgresql-production.conf");

    it("postgresql-production.conf exists", () => {
      expect(fs.existsSync(confPath)).toBe(true);
    });

    it("configures shared_buffers for production", () => {
      const content = fs.readFileSync(confPath, "utf-8");
      expect(content).toMatch(/shared_buffers\s*=\s*'16GB'/);
    });

    it("configures effective_cache_size", () => {
      const content = fs.readFileSync(confPath, "utf-8");
      expect(content).toMatch(/effective_cache_size\s*=\s*'48GB'/);
    });

    it("enables WAL compression", () => {
      const content = fs.readFileSync(confPath, "utf-8");
      expect(content).toMatch(/wal_compression\s*=\s*lz4/);
    });

    it("configures parallel query workers", () => {
      const content = fs.readFileSync(confPath, "utf-8");
      expect(content).toMatch(/max_parallel_workers_per_gather\s*=\s*4/);
      expect(content).toMatch(/max_parallel_workers\s*=\s*8/);
    });

    it("sets SSD-optimized random_page_cost", () => {
      const content = fs.readFileSync(confPath, "utf-8");
      expect(content).toMatch(/random_page_cost\s*=\s*1\.1/);
    });

    it("configures aggressive autovacuum for fintech workload", () => {
      const content = fs.readFileSync(confPath, "utf-8");
      expect(content).toMatch(/autovacuum_vacuum_scale_factor\s*=\s*0\.02/);
      expect(content).toMatch(/autovacuum_analyze_scale_factor\s*=\s*0\.01/);
      expect(content).toMatch(/autovacuum_max_workers\s*=\s*6/);
    });

    it("enables pg_stat_statements and auto_explain", () => {
      const content = fs.readFileSync(confPath, "utf-8");
      expect(content).toMatch(
        /shared_preload_libraries\s*=\s*'pg_stat_statements,auto_explain'/
      );
    });

    it("sets WAT timezone for Nigerian fintech", () => {
      const content = fs.readFileSync(confPath, "utf-8");
      expect(content).toMatch(/timezone\s*=\s*'Africa\/Lagos'/);
    });

    it("enables SSL for production", () => {
      const content = fs.readFileSync(confPath, "utf-8");
      expect(content).toMatch(/ssl\s*=\s*on/);
      expect(content).toMatch(/ssl_min_protocol_version\s*=\s*'TLSv1\.2'/);
    });

    it("uses scram-sha-256 password encryption", () => {
      const content = fs.readFileSync(confPath, "utf-8");
      expect(content).toMatch(/password_encryption\s*=\s*scram-sha-256/);
    });
  });

  describe("PgBouncer Connection Pooling", () => {
    const pgbouncerPath = path.join(infraDir, "pgbouncer.ini");

    it("pgbouncer.ini exists", () => {
      expect(fs.existsSync(pgbouncerPath)).toBe(true);
    });

    it("uses transaction pooling mode", () => {
      const content = fs.readFileSync(pgbouncerPath, "utf-8");
      expect(content).toMatch(/pool_mode\s*=\s*transaction/);
    });

    it("configures pool sizes", () => {
      const content = fs.readFileSync(pgbouncerPath, "utf-8");
      expect(content).toMatch(/default_pool_size\s*=\s*50/);
      expect(content).toMatch(/max_client_conn\s*=\s*1000/);
      expect(content).toMatch(/max_db_connections\s*=\s*100/);
    });

    it("configures idle transaction timeout", () => {
      const content = fs.readFileSync(pgbouncerPath, "utf-8");
      expect(content).toMatch(/idle_transaction_timeout\s*=\s*60/);
    });

    it("requires TLS for client connections", () => {
      const content = fs.readFileSync(pgbouncerPath, "utf-8");
      expect(content).toMatch(/client_tls_sslmode\s*=\s*require/);
    });

    it("configures readonly replica pool", () => {
      const content = fs.readFileSync(pgbouncerPath, "utf-8");
      expect(content).toMatch(/insureportal_readonly/);
    });
  });

  describe("Performance Indexes", () => {
    const indexPath = path.join(infraDir, "performance-indexes.sql");

    it("performance-indexes.sql exists", () => {
      expect(fs.existsSync(indexPath)).toBe(true);
    });

    it("enables pg_trgm extension for text search", () => {
      const content = fs.readFileSync(indexPath, "utf-8");
      expect(content).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_trgm/);
    });

    it("creates covering index for transaction list", () => {
      const content = fs.readFileSync(indexPath, "utf-8");
      expect(content).toMatch(/tx_agent_created_covering_idx/);
      expect(content).toMatch(/INCLUDE/);
    });

    it("creates partial indexes for hot paths", () => {
      const content = fs.readFileSync(indexPath, "utf-8");
      expect(content).toMatch(/tx_pending_idx/);
      expect(content).toMatch(/WHERE status = 'pending'/);
      expect(content).toMatch(/fraud_open_severity_idx/);
      expect(content).toMatch(/kyc_pending_created_idx/);
    });

    it("creates trigram indexes for text search", () => {
      const content = fs.readFileSync(indexPath, "utf-8");
      expect(content).toMatch(/gin_trgm_ops/);
      expect(content).toMatch(/audit_description_trgm_idx/);
      expect(content).toMatch(/customers_name_trgm_idx/);
    });

    it("uses CONCURRENTLY for all index creation", () => {
      const content = fs.readFileSync(indexPath, "utf-8");
      const createIndexLines = content
        .split("\n")
        .filter(l => l.includes("CREATE INDEX"));
      for (const line of createIndexLines) {
        expect(line).toContain("CONCURRENTLY");
      }
    });

    it("creates materialized views for dashboards", () => {
      const content = fs.readFileSync(indexPath, "utf-8");
      expect(content).toMatch(/mv_daily_agent_summary/);
      expect(content).toMatch(/mv_hourly_platform_kpis/);
      expect(content).toMatch(/mv_agent_leaderboard/);
    });

    it("creates unique indexes on materialized views", () => {
      const content = fs.readFileSync(indexPath, "utf-8");
      expect(content).toMatch(/mv_daily_agent_summary_idx/);
      expect(content).toMatch(/mv_hourly_kpis_idx/);
      expect(content).toMatch(/mv_agent_leaderboard_idx/);
    });

    it("covers all high-volume tables with indexes", () => {
      const content = fs.readFileSync(indexPath, "utf-8");
      const criticalTables = [
        "transactions",
        "fraud_alerts",
        "audit_log",
        "agents",
        "loyalty_history",
        "chat_sessions",
        "chat_messages",
        "devices",
        "kyc_sessions",
        "settlement_reconciliation",
        "commission_payouts",
        "webhook_deliveries",
        "referrals",
        "disputes",
        "reversal_requests",
        "float_topup_requests",
        "email_queue",
        "erp_sync_log",
        "dlq_messages",
        "api_key_usage",
        "device_locations",
        "customers",
        "merchants",
        "analytics_metrics",
        "connectivity_log",
      ];
      for (const table of criticalTables) {
        expect(content).toContain(table);
      }
    });
  });

  describe("Maintenance Scripts", () => {
    const maintenancePath = path.join(infraDir, "maintenance.sql");

    it("maintenance.sql exists", () => {
      expect(fs.existsSync(maintenancePath)).toBe(true);
    });

    it("includes materialized view refresh commands", () => {
      const content = fs.readFileSync(maintenancePath, "utf-8");
      expect(content).toMatch(
        /REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_agent_summary/
      );
      expect(content).toMatch(
        /REFRESH MATERIALIZED VIEW CONCURRENTLY mv_hourly_platform_kpis/
      );
      expect(content).toMatch(
        /REFRESH MATERIALIZED VIEW CONCURRENTLY mv_agent_leaderboard/
      );
    });

    it("includes table bloat detection query", () => {
      const content = fs.readFileSync(maintenancePath, "utf-8");
      expect(content).toMatch(/n_dead_tup/);
      expect(content).toMatch(/dead_pct/);
    });

    it("includes unused index detection", () => {
      const content = fs.readFileSync(maintenancePath, "utf-8");
      expect(content).toMatch(/idx_scan = 0/);
    });

    it("includes slow query analysis", () => {
      const content = fs.readFileSync(maintenancePath, "utf-8");
      expect(content).toMatch(/pg_stat_statements/);
      expect(content).toMatch(/mean_exec_time/);
    });

    it("includes cache hit ratio check", () => {
      const content = fs.readFileSync(maintenancePath, "utf-8");
      expect(content).toMatch(/hit_ratio/);
    });

    it("includes replication lag monitoring", () => {
      const content = fs.readFileSync(maintenancePath, "utf-8");
      expect(content).toMatch(/pg_stat_replication/);
      expect(content).toMatch(/replay_lag_bytes/);
    });
  });

  describe("HA Replication Setup", () => {
    const haPath = path.join(infraDir, "ha-replication.sh");

    it("ha-replication.sh exists", () => {
      expect(fs.existsSync(haPath)).toBe(true);
    });

    it("is executable", () => {
      const stats = fs.statSync(haPath);
      expect(stats.mode & 0o111).toBeTruthy();
    });

    it("configures streaming replication", () => {
      const content = fs.readFileSync(haPath, "utf-8");
      expect(content).toMatch(/pg_basebackup/);
      expect(content).toMatch(/standby\.signal/);
      expect(content).toMatch(/primary_conninfo/);
    });

    it("includes failover script", () => {
      const content = fs.readFileSync(haPath, "utf-8");
      expect(content).toMatch(/pg_ctl promote/);
      expect(content).toMatch(/pg_is_in_recovery/);
    });

    it("includes health check script", () => {
      const content = fs.readFileSync(haPath, "utf-8");
      expect(content).toMatch(/pg_isready/);
      expect(content).toMatch(/pg_wal_lsn_diff/);
    });
  });

  describe("Schema Index Coverage", () => {
    const schemaPath = path.join(__dirname, "..", "drizzle", "schema.ts");
    const content = fs.readFileSync(schemaPath, "utf-8");

    it("has indexes defined in schema.ts", () => {
      const indexCount = (content.match(/index\(/g) || []).length;
      expect(indexCount).toBeGreaterThan(80);
    });

    it("has unique indexes for critical lookups", () => {
      const uniqueCount = (content.match(/uniqueIndex\(/g) || []).length;
      expect(uniqueCount).toBeGreaterThan(10);
    });

    it("transactions table has composite indexes", () => {
      expect(content).toMatch(/tx_agentId_createdAt_idx/);
      expect(content).toMatch(/tx_status_createdAt_idx/);
      expect(content).toMatch(/tx_type_createdAt_idx/);
    });

    it("all tenant-isolated tables have tenantId index", () => {
      const tenantTables = [
        "users",
        "agents",
        "transactions",
        "fraud_alerts",
        "disputes",
        "kyc_sessions",
        "pos_terminals",
        "merchants",
        "customers",
      ];
      for (const table of tenantTables) {
        expect(content).toMatch(
          new RegExp(`${table.replace(/_/g, ".")}.*tenantId.*idx`, "s")
        );
      }
    });
  });
});
