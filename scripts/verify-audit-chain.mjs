#!/usr/bin/env node
/**
 * verify-audit-chain.mjs — standalone verifier for the audit_log hash chain
 * (F-08). Recomputes the SHA-256 chain over audit_log and fails closed on any
 * modified, deleted, or reordered chained row.
 *
 * This intentionally re-implements the canonicalization in dependency-free
 * JS so it can run from cron/CI without the app bundle. It MUST stay in sync
 * with server/lib/auditChain.ts (chain version "insureportal-audit-v1");
 * tests/integration/auditChain.integration.test.ts pins the format against
 * the server implementation.
 *
 * Usage:
 *   POSTGRES_URL=postgres://... node scripts/verify-audit-chain.mjs [--allow-unchained] [--max-rows N] [--json]
 *
 * Exit codes: 0 = chain intact, 1 = broken link / tamper detected, 2 = usage/connection error.
 */
import { createHash } from "node:crypto";
import pg from "pg";

// Canonical timestamps must round-trip identically to the writer (TZ=UTC).
process.env.TZ = "UTC";

const AUDIT_CHAIN_VERSION = "insureportal-audit-v1";
const AUDIT_CHAIN_GENESIS = "GENESIS";

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    const s = JSON.stringify(value);
    return s === undefined ? "null" : s;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

function canonicalEntry(f) {
  return canonicalJson({
    agentId: f.agentId,
    action: f.action,
    resource: f.resource,
    resourceId: f.resourceId,
    ipAddress: f.ipAddress,
    userAgent: f.userAgent,
    status: f.status,
    metadata: f.metadata ?? null,
    tenantId: f.tenantId,
    createdAt: f.createdAt.toISOString(),
  });
}

function computeEntryHash(prevHash, fields) {
  const input = `${AUDIT_CHAIN_VERSION}\n${prevHash ?? AUDIT_CHAIN_GENESIS}\n${canonicalEntry(fields)}`;
  return createHash("sha256").update(input, "utf8").digest("hex");
}

const args = process.argv.slice(2);
const allowUnchained = args.includes("--allow-unchained");
const asJson = args.includes("--json");
const maxRowsIdx = args.indexOf("--max-rows");
const maxRows = maxRowsIdx >= 0 ? Number.parseInt(args[maxRowsIdx + 1] ?? "", 10) : 50000;

const url = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("ERROR: POSTGRES_URL or DATABASE_URL is required");
  process.exit(2);
}
if (!Number.isFinite(maxRows) || maxRows < 1) {
  console.error("ERROR: --max-rows must be a positive integer");
  process.exit(2);
}

// INT8 (bigserial id) arrives as string by default; parse to Number so JSON
// reports and rowId comparisons are numeric (safe: ids << 2^53).
pg.types.setTypeParser(pg.types.builtins.INT8, v => (v === null ? null : Number(v)));

const pool = new pg.Pool({ connectionString: url, max: 1 });

try {
  const { rows } = await pool.query(
    'SELECT id, "agentId", action, resource, "resourceId", "ipAddress", "userAgent", status, metadata, "tenantId", "prevHash", "entryHash", "createdAt" FROM audit_log ORDER BY id ASC LIMIT $1',
    [maxRows + 1]
  );
  const scan = rows.slice(0, maxRows);

  let checkedRows = 0;
  let unchainedRows = 0;
  let genesisId = null;
  let tipId = null;
  let tipHash = null;
  let prev = null;
  let prevWasUnchained = true;
  let failure = null;

  for (const row of scan) {
    if (!row.entryHash) {
      unchainedRows++;
      if (!allowUnchained) {
        failure = { rowId: row.id, reason: "unchained-row", expected: "sha256 hex", actual: null };
        break;
      }
      prev = row;
      prevWasUnchained = true;
      continue;
    }

    const recomputed = computeEntryHash(row.prevHash ?? null, {
      agentId: row.agentId ?? null,
      action: row.action,
      resource: row.resource ?? null,
      resourceId: row.resourceId ?? null,
      ipAddress: row.ipAddress ?? null,
      userAgent: row.userAgent ?? null,
      status: row.status ?? null,
      metadata: row.metadata ?? null,
      tenantId: row.tenantId ?? null,
      createdAt: row.createdAt,
    });
    if (recomputed !== row.entryHash) {
      failure = { rowId: row.id, reason: "entry-hash-mismatch", expected: recomputed, actual: row.entryHash };
      break;
    }

    const expectedPrev = prevWasUnchained ? null : (prev?.entryHash ?? null);
    if ((row.prevHash ?? null) !== expectedPrev) {
      failure = { rowId: row.id, reason: prevWasUnchained ? "bad-genesis" : "prev-hash-mismatch", expected: expectedPrev, actual: row.prevHash ?? null };
      break;
    }

    if (prevWasUnchained && genesisId === null) genesisId = row.id;
    checkedRows++;
    tipId = row.id;
    tipHash = row.entryHash;
    prev = row;
    prevWasUnchained = false;
  }

  const report = {
    ok: failure === null,
    checkedRows,
    unchainedRows,
    totalRows: scan.length,
    genesisId,
    tipId,
    tipHash,
    failure,
    chainVersion: AUDIT_CHAIN_VERSION,
    verifiedAt: new Date().toISOString(),
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    console.log(
      `AUDIT CHAIN OK: ${checkedRows} chained rows verified` +
        (unchainedRows ? ` (${unchainedRows} unchained legacy/bypass rows tolerated)` : "") +
        `, tip id=${tipId} hash=${tipHash}`
    );
  } else {
    console.error(
      `AUDIT CHAIN BROKEN at row id=${failure.rowId}: ${failure.reason}\n` +
        `  expected: ${failure.expected}\n  actual:   ${failure.actual}\n` +
        `  (${checkedRows} rows verified before the break)`
    );
  }
  process.exit(report.ok ? 0 : 1);
} catch (err) {
  console.error(`ERROR: verification failed to run: ${err?.message ?? err}`);
  process.exit(2);
} finally {
  await pool.end().catch(() => {});
}
