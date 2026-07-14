#!/usr/bin/env node
/**
 * Database Migration Runner
 * 
 * Runs SQL migration files from ./migrations/ in order.
 * Tracks applied migrations in the _migrations table.
 * 
 * Usage:
 *   node migrate.cjs              # Run pending migrations
 *   node migrate.cjs --status     # Show migration status
 *   node migrate.cjs --rollback   # Rollback last migration (not implemented)
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'ngapp',
  user: process.env.PGUSER || 'ngapp',
  password: process.env.PGPASSWORD || 'ngapp',
});

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT NOW(),
      checksum VARCHAR(64)
    )
  `);
}

async function getAppliedMigrations() {
  const { rows } = await pool.query('SELECT name, applied_at, checksum FROM _migrations ORDER BY id');
  return new Map(rows.map(r => [r.name, r]));
}

function getMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
}

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

async function runMigrations() {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();
  const files = getMigrationFiles();
  
  let pending = 0;
  let ran = 0;
  
  for (const file of files) {
    const name = file.replace('.sql', '');
    if (applied.has(name)) continue;
    
    pending++;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const hash = checksum(sql);
    
    console.log(`  Running: ${file} ...`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO _migrations (name, checksum) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
        [name, hash]
      );
      await client.query('COMMIT');
      console.log(`  ✓ ${file} applied`);
      ran++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ✗ ${file} FAILED: ${err.message}`);
      process.exit(1);
    } finally {
      client.release();
    }
  }
  
  if (ran === 0) console.log('  No pending migrations.');
  else console.log(`  ${ran} migration(s) applied.`);
}

async function showStatus() {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();
  const files = getMigrationFiles();
  
  console.log('\nMigration Status:');
  console.log('─'.repeat(60));
  for (const file of files) {
    const name = file.replace('.sql', '');
    const info = applied.get(name);
    const status = info ? `✓ Applied at ${new Date(info.applied_at).toISOString()}` : '○ Pending';
    console.log(`  ${file}: ${status}`);
  }
  console.log('─'.repeat(60));
  console.log(`  Total: ${files.length} | Applied: ${applied.size} | Pending: ${files.length - applied.size}\n`);
}

async function main() {
  const cmd = process.argv[2];
  try {
    if (cmd === '--status') {
      await showStatus();
    } else {
      console.log('\nRunning database migrations...');
      await runMigrations();
    }
  } catch (err) {
    console.error('Migration error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
