import { query as pgQuery } from "./db";
import type { ProductDefinition } from "./engine/builder";

/**
 * Postgres-backed persistence for Product Builder definitions.
 * Fixes persistence-audit item A1 (2026-10-01, C2d): previously all
 * ProductDefinitions lived in an in-process Map and vanished on restart.
 *
 * Fail-closed contract: every method throws on database error. Callers
 * (routes) must surface failures as 500s; there is NO in-memory fallback.
 */

// Minimal query interface so the store can run against pg.Pool in production
// and @electric-sql/pglite in tests (both return { rows }).
export interface QueryResult<R> {
  rows: R[];
}
export type RunQuery = <R>(text: string, params?: unknown[]) => Promise<QueryResult<R>>;

interface ProductRow {
  id: string;
  payload: ProductDefinition;
  status: string;
  version: number;
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS product_definitions (
    id TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    status TEXT NOT NULL,
    version INTEGER NOT NULL,
    regulatory_approval_ref TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const CREATE_STATUS_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS product_definitions_status_idx
    ON product_definitions (status)
`;

const defaultRunQuery: RunQuery = async <R>(text: string, params?: unknown[]) => {
  // pg's QueryResult is structurally compatible with QueryResult<R>.
  const res = await pgQuery(text, params as unknown[] | undefined);
  return { rows: res.rows as R[] };
};

export class ProductStore {
  constructor(private readonly runQuery: RunQuery = defaultRunQuery) {}

  /**
   * Idempotent schema bootstrap (2026-10-01, C2d). No migration tool exists in
   * this service, so we use CREATE TABLE IF NOT EXISTS in the spirit of db.ts
   * initDB — but unlike initDB this THROWS on failure (fail-closed).
   */
  async init(): Promise<void> {
    await this.runQuery(CREATE_TABLE_SQL);
    await this.runQuery(CREATE_STATUS_INDEX_SQL);
  }

  async insert(product: ProductDefinition): Promise<void> {
    await this.runQuery(
      `INSERT INTO product_definitions
         (id, payload, status, version, regulatory_approval_ref, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        product.id,
        JSON.stringify(product),
        product.status,
        product.version,
        product.regulatoryApproval || null,
        product.createdBy || null,
        product.createdAt,
        product.updatedAt,
      ]
    );
  }

  async update(product: ProductDefinition): Promise<void> {
    const res = await this.runQuery(
      `UPDATE product_definitions
         SET payload = $2,
             status = $3,
             version = $4,
             regulatory_approval_ref = $5,
             created_by = $6,
             updated_at = $7
       WHERE id = $1`,
      [
        product.id,
        JSON.stringify(product),
        product.status,
        product.version,
        product.regulatoryApproval || null,
        product.createdBy || null,
        product.updatedAt,
      ]
    );
    // pg/PGlite rowCount parity differs; existence is verified by callers via get().
    void res;
  }

  async get(id: string): Promise<ProductDefinition | undefined> {
    const res = await this.runQuery<ProductRow>(
      `SELECT id, payload, status, version FROM product_definitions WHERE id = $1`,
      [id]
    );
    const row = res.rows[0];
    if (!row) return undefined;
    return rowToProduct(row);
  }

  async list(status?: string): Promise<ProductDefinition[]> {
    const res = status
      ? await this.runQuery<ProductRow>(
          `SELECT id, payload, status, version FROM product_definitions WHERE status = $1 ORDER BY created_at`,
          [status]
        )
      : await this.runQuery<ProductRow>(
          `SELECT id, payload, status, version FROM product_definitions ORDER BY created_at`
        );
    return res.rows.map(rowToProduct);
  }
}

function rowToProduct(row: ProductRow): ProductDefinition {
  const payload: ProductDefinition =
    typeof row.payload === "string" ? (JSON.parse(row.payload) as ProductDefinition) : row.payload;
  // Columns are authoritative for lifecycle state (2026-10-01, C2d).
  return {
    ...payload,
    status: row.status as ProductDefinition["status"],
    version: row.version,
  };
}
