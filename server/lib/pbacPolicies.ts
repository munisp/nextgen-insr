/**
 * pbacPolicies.ts — B1: PBAC policy store backed by the REAL Permify schema.
 *
 * Design decision (documented per Wave-2a scope): the Permify deployment
 * client in server/_core/permify.ts exposes only the permissions/check
 * endpoint — the deployed schema-write path is the in-repo DSL file
 * (infra/permify/schema.perm, version 3.0.0) applied at deploy time, and the
 * Permify schema-read API (v1/tenants/{id}/schemas/list) is not wired into
 * this deployment's client. The policy store is therefore a real table
 * (pbac_policies, migration 0057) seeded by PARSING the actual schema file —
 * one row per entity action declared in the DSL, expression preserved
 * verbatim — never invented content. getPolicies reads that table and fails
 * loud with the exact reason when it is empty (sync never ran).
 *
 * syncPoliciesFromSchema re-parses the file on every call and upserts by
 * (entity, permission), so the store tracks the real schema file.
 */
import fs from "fs";
import path from "path";

import { and, desc, eq, sql } from "drizzle-orm";

import {
  pbacAccessEvaluations,
  pbacPolicies,
  type PbacAccessEvaluation,
  type PbacPolicy,
} from "../../drizzle/schema.additions";
import type { getDb } from "../db";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export const PERMIFY_SCHEMA_PATH = path.resolve(
  import.meta.dirname,
  "../../infra/permify/schema.perm"
);

export interface ParsedPolicy {
  entity: string;
  permission: string;
  expression: string;
}

export interface ParsedSchema {
  version: string;
  policies: ParsedPolicy[];
}

/**
 * Parse the Permify DSL into policy rows. Extracts the version from the
 * header banner ("Version: X.Y.Z") and every `action|permission name = expr`
 * declaration inside each `entity <name> { ... }` block. Throws (fail loud)
 * when the file declares no policies — a schema file that parses to zero
 * policies is a broken source, not an empty store.
 */
export function parsePermifySchema(schemaText: string): ParsedSchema {
  const versionMatch = schemaText.match(/Version:\s*([0-9][^\s|]*)/);
  const version = versionMatch ? versionMatch[1] : "unversioned";

  const policies: ParsedPolicy[] = [];
  // Strip line comments so commented-out declarations are not parsed.
  const stripped = schemaText
    .split("\n")
    .map(line => {
      const idx = line.indexOf("//");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");

  const entityRe = /entity\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\}/g;
  let entityMatch: RegExpExecArray | null;
  while ((entityMatch = entityRe.exec(stripped)) !== null) {
    const [, entity, body] = entityMatch;
    const actionRe =
      /(?:action|permission)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\n]+)/g;
    let actionMatch: RegExpExecArray | null;
    while ((actionMatch = actionRe.exec(body)) !== null) {
      policies.push({
        entity,
        permission: actionMatch[1],
        expression: actionMatch[2].trim().replace(/\s+/g, " "),
      });
    }
  }
  if (policies.length === 0) {
    throw new Error(
      "parsePermifySchema: parsed 0 policies from schema text — the Permify schema source is empty or unrecognisable"
    );
  }
  return { version, policies };
}

/** Read and parse the real in-repo schema file. Fails loud when absent. */
export function loadPermifySchema(
  schemaPath: string = PERMIFY_SCHEMA_PATH
): ParsedSchema {
  if (!fs.existsSync(schemaPath)) {
    throw new Error(
      `loadPermifySchema: Permify schema file not found at ${schemaPath} — cannot seed the policy store without the real schema`
    );
  }
  return parsePermifySchema(fs.readFileSync(schemaPath, "utf-8"));
}

export interface SyncResult {
  schemaVersion: string;
  parsed: number;
  inserted: number;
  updated: number;
}

/**
 * Re-parse the real schema file and upsert every declared policy into
 * pbac_policies (key: entity+permission). Returns real counts.
 */
export async function syncPoliciesFromSchema(
  db: Db,
  schemaPath: string = PERMIFY_SCHEMA_PATH
): Promise<SyncResult> {
  const { version, policies } = loadPermifySchema(schemaPath);
  let inserted = 0;
  let updated = 0;
  for (const p of policies) {
    const name = `${p.entity}.${p.permission}`;
    const description =
      `Permify policy ${name} — grants: ${p.expression} ` +
      `(schema v${version})`;
    const [existing] = await db
      .select({ id: pbacPolicies.id })
      .from(pbacPolicies)
      .where(
        and(
          eq(pbacPolicies.entity, p.entity),
          eq(pbacPolicies.permission, p.permission)
        )
      )
      .limit(1);
    if (existing) {
      await db
        .update(pbacPolicies)
        .set({
          name,
          description,
          expression: p.expression,
          permifySchemaVersion: version,
          updatedAt: new Date(),
        })
        .where(eq(pbacPolicies.id, existing.id));
      updated++;
    } else {
      await db.insert(pbacPolicies).values({
        entity: p.entity,
        permission: p.permission,
        name,
        description,
        expression: p.expression,
        permifySchemaVersion: version,
      });
      inserted++;
    }
  }
  return { schemaVersion: version, parsed: policies.length, inserted, updated };
}

/** Paginated read of the policy store, newest first. */
export async function listPolicies(
  db: Db,
  opts: { page?: number; limit?: number }
): Promise<PbacPolicy[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const page = Math.max(opts.page ?? 1, 1);
  return db
    .select()
    .from(pbacPolicies)
    .orderBy(desc(pbacPolicies.createdAt), desc(pbacPolicies.id))
    .limit(limit)
    .offset((page - 1) * limit);
}

export async function countPolicies(db: Db): Promise<number> {
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(pbacPolicies);
  return Number(total ?? 0);
}

/** Append a real access-evaluation verdict to the log. */
export async function recordAccessEvaluation(
  db: Db,
  entry: {
    subjectType: string;
    subjectId: string;
    entityType: string;
    entityId: string;
    permission: string;
    allowed: boolean;
    source: string;
    evaluatedBy?: number | null;
  }
): Promise<PbacAccessEvaluation> {
  const [row] = await db
    .insert(pbacAccessEvaluations)
    .values({
      subjectType: entry.subjectType,
      subjectId: entry.subjectId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      permission: entry.permission,
      allowed: entry.allowed,
      source: entry.source,
      evaluatedBy: entry.evaluatedBy ?? null,
    })
    .returning();
  return row;
}

/** Paginated read of the evaluation log, newest first. */
export async function listAccessEvaluations(
  db: Db,
  opts: { page?: number; limit?: number }
): Promise<PbacAccessEvaluation[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const page = Math.max(opts.page ?? 1, 1);
  return db
    .select()
    .from(pbacAccessEvaluations)
    .orderBy(
      desc(pbacAccessEvaluations.createdAt),
      desc(pbacAccessEvaluations.id)
    )
    .limit(limit)
    .offset((page - 1) * limit);
}
