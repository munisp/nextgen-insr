/**
 * auditChain.ts — tamper-evident hash chain for the audit_log table.
 *
 * Design (F-08 engineering remediation):
 *   Every audit row written through writeAuditLog carries two extra columns:
 *     - prevHash  : the entryHash of the immediately preceding row (by id),
 *                   or NULL for the genesis row of a chain segment.
 *     - entryHash : SHA-256 over the canonical serialization of the row's
 *                   content fields, chained to prevHash:
 *
 *       entryHash = sha256_hex(
 *         "insureportal-audit-v1\n" + (prevHash ?? "GENESIS") + "\n" + canonicalJson(fields)
 *       )
 *
 *   fields = { agentId, action, resource, resourceId, ipAddress, userAgent,
 *              status, metadata, tenantId, createdAt }
 *   createdAt is set by the application at write time (not by the DB default)
 *   so the hash input is fully known before insert.
 *
 * Writers are serialized with pg_advisory_xact_lock so the (prevHash ->
 * entryHash) link is race-free under concurrent writers.
 *
 * HONEST LIMITS (do not overstate):
 *   - The chain DETECTS modification or deletion of stored rows (any change
 *     breaks a link) but it does NOT prevent a database superuser from
 *     rewriting the entire chain from the point of compromise onward.
 *     Defence against that requires anchoring the tip hash to an external
 *     WORM store (e.g. signed daily tip published off-cluster) — OPEN ITEM.
 *   - Deleting the CURRENT TIP row is not detectable by recompute alone
 *     (there is no successor link). External tip anchoring addresses this.
 *   - Rows written by code paths that bypass writeAuditLog (direct
 *     db.insert(auditLog)) carry NULL hashes and are outside the
 *     tamper-evidence boundary; verification reports them as "unchained".
 *
 * NOTE: createdAt round-trips through `timestamp without time zone`; the
 * canonical form uses Date.toISOString(), so writers and verifiers must run
 * with TZ=UTC (the test harness and production containers both do).
 */
import { createHash } from "node:crypto";
import { asc } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { auditLog, type AuditLog } from "../../drizzle/schema";

export const AUDIT_CHAIN_VERSION = "insureportal-audit-v1";
export const AUDIT_CHAIN_GENESIS = "GENESIS";

/** Advisory lock key serializing audit-chain writers (arbitrary constant). */
export const AUDIT_CHAIN_LOCK_KEY = 727_272;

/** Fields that participate in the entry hash. */
export interface AuditEntryFields {
  agentId: number | null;
  action: string;
  resource: string | null;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  status: string | null;
  metadata: unknown;
  tenantId: number | null;
  createdAt: Date;
}

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

/** Serialize the hash-input fields deterministically. */
export function canonicalEntry(fields: AuditEntryFields): string {
  return canonicalJson({
    agentId: fields.agentId,
    action: fields.action,
    resource: fields.resource,
    resourceId: fields.resourceId,
    ipAddress: fields.ipAddress,
    userAgent: fields.userAgent,
    status: fields.status,
    metadata: fields.metadata ?? null,
    tenantId: fields.tenantId,
    createdAt: fields.createdAt.toISOString(),
  });
}

/** Compute the entry hash for a row given its predecessor's hash. */
export function computeEntryHash(
  prevHash: string | null,
  fields: AuditEntryFields
): string {
  const input = `${AUDIT_CHAIN_VERSION}\n${prevHash ?? AUDIT_CHAIN_GENESIS}\n${canonicalEntry(fields)}`;
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function entryFieldsFromRow(row: AuditLog): AuditEntryFields {
  return {
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
  };
}

export interface AuditChainFailure {
  /** Id of the row at which verification failed. */
  rowId: number;
  reason:
    | "entry-hash-mismatch" // row content (incl. prevHash) modified after write
    | "prev-hash-mismatch" // predecessor row was modified/deleted/inserted
    | "unchained-row" // row has NULL hashes (bypass / legacy) in strict mode
    | "bad-genesis"; // chained row opens a segment with non-null prevHash
  expected: string | null;
  actual: string | null;
}

export interface AuditChainVerification {
  ok: boolean;
  /** Chained rows whose entryHash recomputed AND linked correctly. */
  checkedRows: number;
  /** Rows with NULL hashes (legacy or direct-insert bypass). */
  unchainedRows: number;
  /** Total rows examined (capped by maxRows). */
  totalRows: number;
  genesisId: number | null;
  tipId: number | null;
  tipHash: string | null;
  failure: AuditChainFailure | null;
}

/** Minimal db surface needed for verification (drizzle node-postgres). */
export type AuditChainDb = Pick<NodePgDatabase<Record<string, never>>, "select">;

/**
 * Recompute and verify the hash chain over audit_log, ascending by id.
 *
 * Semantics (mirrors writeAuditLog):
 *  - A row with NULL entryHash is "unchained" (legacy / bypass writer). The
 *    next chained row after an unchained row (or at table start) MUST have
 *    prevHash NULL — it opens a new segment.
 *  - Modification of a chained row's content => entry-hash-mismatch at that row.
 *  - Deletion (or modification) of a chained row => prev-hash-mismatch at its
 *    successor — the exact broken link.
 *  - strict (default true): any unchained row fails verification. Pass
 *    strict:false to tolerate legacy/bypass rows while still verifying every
 *    chained segment.
 */
export async function verifyAuditChain(
  db: AuditChainDb,
  opts: { maxRows?: number; strict?: boolean } = {}
): Promise<AuditChainVerification> {
  const maxRows = opts.maxRows ?? 50_000;
  const strict = opts.strict ?? true;

  const rows: AuditLog[] = await db
    .select()
    .from(auditLog)
    .orderBy(asc(auditLog.id))
    .limit(maxRows + 1);

  const scan = rows.slice(0, maxRows);

  let checkedRows = 0;
  let unchainedRows = 0;
  let genesisId: number | null = null;
  let tipId: number | null = null;
  let tipHash: string | null = null;
  let prev: AuditLog | null = null;
  let prevWasUnchained = true; // table start behaves like "after unchained"

  const result = (failure: AuditChainFailure | null): AuditChainVerification => ({
    ok: failure === null,
    checkedRows,
    unchainedRows,
    totalRows: scan.length,
    genesisId,
    tipId,
    tipHash,
    failure,
  });

  for (const row of scan) {
    if (!row.entryHash) {
      unchainedRows++;
      if (strict) {
        return result({
          rowId: row.id,
          reason: "unchained-row",
          expected: "sha256 hex",
          actual: null,
        });
      }
      prev = row;
      prevWasUnchained = true;
      continue;
    }

    // 1. Content integrity: recompute the entry hash from stored fields.
    const recomputed = computeEntryHash(row.prevHash ?? null, entryFieldsFromRow(row));
    if (recomputed !== row.entryHash) {
      return result({
        rowId: row.id,
        reason: "entry-hash-mismatch",
        expected: recomputed,
        actual: row.entryHash,
      });
    }

    // 2. Link integrity: prevHash must reference the immediately preceding
    //    row's entryHash, or be NULL when opening a new segment.
    const expectedPrev = prevWasUnchained ? null : (prev?.entryHash ?? null);
    if ((row.prevHash ?? null) !== expectedPrev) {
      return result({
        rowId: row.id,
        reason: prevWasUnchained ? "bad-genesis" : "prev-hash-mismatch",
        expected: expectedPrev,
        actual: row.prevHash ?? null,
      });
    }

    if (prevWasUnchained) genesisId = genesisId ?? row.id;
    checkedRows++;
    tipId = row.id;
    tipHash = row.entryHash;
    prev = row;
    prevWasUnchained = false;
  }

  return result(null);
}
