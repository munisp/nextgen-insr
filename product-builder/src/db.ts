import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://ngapp:ngapp@localhost:5432/ngapp";

const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });

export async function query(text: string, params?: any[]) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

export async function initDB(tableName: string) {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id SERIAL PRIMARY KEY,
        data JSONB NOT NULL DEFAULT '{}',
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        tenant_id INTEGER DEFAULT 1
      )
    `);
    console.log(`Table ${tableName} initialized`);
  } catch (e) {
    console.warn(`Table creation warning: ${e}`);
  }
}

export default pool;
