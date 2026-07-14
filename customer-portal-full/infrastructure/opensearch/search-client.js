/**
 * OpenSearch Client for InsurePortal
 * Replaces ILIKE queries with full-text search for policies, claims, customers
 */
let osClient = null;
let connected = false;

async function init() {
  try {
    const { Client } = require('@opensearch-project/opensearch');
    osClient = new Client({
      node: process.env.OPENSEARCH_URL || 'https://localhost:9200',
      auth: {
        username: process.env.OPENSEARCH_USER || 'admin',
        password: process.env.OPENSEARCH_PASSWORD || 'admin',
      },
      ssl: { rejectUnauthorized: false },
    });
    await osClient.cluster.health();
    connected = true;
    console.log('✓ OpenSearch connected');
    await createIndices();
  } catch (err) {
    console.warn(`✗ OpenSearch not available: ${err.message} — using PostgreSQL ILIKE fallback`);
  }
}

async function createIndices() {
  const config = require('./index-config.json');
  for (const [indexName, indexConfig] of Object.entries(config.indices)) {
    try {
      const exists = await osClient.indices.exists({ index: indexName });
      if (!exists.body) {
        await osClient.indices.create({ index: indexName, body: { settings: indexConfig.settings, mappings: indexConfig.mappings } });
        console.log(`  Created index: ${indexName}`);
      }
    } catch (err) {
      console.warn(`  Index ${indexName} setup: ${err.message}`);
    }
  }
}

// Full-text search across all indices
async function search(query, options = {}) {
  if (!connected) return fallbackSearch(query, options);
  const { index = ['policies', 'claims', 'customers'], size = 20, from = 0, filters = {} } = options;
  const must = [{ multi_match: { query, fields: ['*'], fuzziness: 'AUTO', type: 'best_fields' } }];
  for (const [field, value] of Object.entries(filters)) {
    must.push({ term: { [field]: value } });
  }
  try {
    const result = await osClient.search({
      index: Array.isArray(index) ? index.join(',') : index,
      body: { query: { bool: { must } }, size, from, highlight: { fields: { '*': {} } } },
    });
    return {
      total: result.body.hits.total.value,
      hits: result.body.hits.hits.map(h => ({ index: h._index, id: h._id, score: h._score, source: h._source, highlights: h.highlight })),
      took: result.body.took,
      source: 'opensearch',
    };
  } catch (err) {
    console.error(`[OPENSEARCH] Search failed: ${err.message}`);
    return fallbackSearch(query, options);
  }
}

// Search within a specific index
async function searchIndex(indexName, query, options = {}) {
  return search(query, { ...options, index: [indexName] });
}

// Index a document
async function indexDocument(indexName, id, document) {
  if (!connected) return { indexed: false, fallback: true };
  try {
    await osClient.index({ index: indexName, id: String(id), body: document, refresh: true });
    return { indexed: true };
  } catch (err) {
    console.error(`[OPENSEARCH] Index failed: ${err.message}`);
    return { indexed: false, error: err.message };
  }
}

// Bulk index documents
async function bulkIndex(indexName, documents) {
  if (!connected) return { indexed: 0, fallback: true };
  const body = documents.flatMap(doc => [{ index: { _index: indexName, _id: String(doc.id) } }, doc]);
  try {
    const result = await osClient.bulk({ body, refresh: true });
    return { indexed: documents.length, errors: result.body.errors, took: result.body.took };
  } catch (err) {
    return { indexed: 0, error: err.message };
  }
}

// Sync from PostgreSQL
async function syncFromDB(pool) {
  if (!connected) return { synced: false };
  console.log('[OPENSEARCH] Starting DB sync...');
  // Sync policies
  const policies = await pool.query('SELECT * FROM policies LIMIT 10000');
  if (policies.rows.length > 0) await bulkIndex('policies', policies.rows);
  // Sync claims
  const claims = await pool.query('SELECT * FROM claims LIMIT 10000');
  if (claims.rows.length > 0) await bulkIndex('claims', claims.rows);
  // Sync users as customers
  const users = await pool.query(`SELECT u.id, u.name, u.email, u.phone, k."kycLevel", k."riskRating" FROM users u LEFT JOIN kyc_profiles k ON k."userId"=u.id LIMIT 10000`);
  if (users.rows.length > 0) await bulkIndex('customers', users.rows);
  console.log(`[OPENSEARCH] Synced: ${policies.rows.length} policies, ${claims.rows.length} claims, ${users.rows.length} customers`);
  return { synced: true, policies: policies.rows.length, claims: claims.rows.length, customers: users.rows.length };
}

function fallbackSearch(query, options) {
  return { total: 0, hits: [], took: 0, source: 'fallback', message: 'OpenSearch not available — use PostgreSQL ILIKE' };
}

async function shutdown() {
  if (osClient) osClient.close();
  connected = false;
}

module.exports = { init, shutdown, search, searchIndex, indexDocument, bulkIndex, syncFromDB, isConnected: () => connected };
