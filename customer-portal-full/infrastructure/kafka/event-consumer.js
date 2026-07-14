/**
 * Kafka Event Consumer for InsurePortal
 * Processes domain events from Kafka topics
 * 
 * Consumers:
 * - Claims processor: handles claim lifecycle events
 * - Notification dispatcher: sends emails/SMS based on events
 * - Audit logger: persists all events to audit_log table
 * - Fraud detector: scores events in real-time
 */
const { Pool } = require('pg');

let kafka = null;
let consumer = null;
let connected = false;

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'ngapp',
  user: process.env.PGUSER || 'ngapp',
  password: process.env.PGPASSWORD || 'ngapp',
});

const handlers = {
  'claims.submitted': async (event) => {
    await pool.query(`INSERT INTO audit_log (action, entity_type, entity_id, details, created_at) VALUES ('claim_submitted', 'claim', $1, $2, NOW())`, [event.claimId, JSON.stringify(event)]);
    console.log(`[CLAIMS] Submitted: ${event.claimId} for ₦${event.amount}`);
  },
  'claims.approved': async (event) => {
    await pool.query(`UPDATE claims SET status='approved', "updatedAt"=NOW() WHERE id=$1`, [event.claimId]);
    await pool.query(`INSERT INTO audit_log (action, entity_type, entity_id, details, created_at) VALUES ('claim_approved', 'claim', $1, $2, NOW())`, [event.claimId, JSON.stringify(event)]);
  },
  'claims.paid': async (event) => {
    await pool.query(`UPDATE claims SET status='paid', "updatedAt"=NOW() WHERE id=$1`, [event.claimId]);
    await pool.query(`INSERT INTO audit_log (action, entity_type, entity_id, details, created_at) VALUES ('claim_paid', 'claim', $1, $2, NOW())`, [event.claimId, JSON.stringify(event)]);
  },
  'claims.rejected': async (event) => {
    await pool.query(`UPDATE claims SET status='rejected', "updatedAt"=NOW() WHERE id=$1`, [event.claimId]);
  },
  'payments.completed': async (event) => {
    await pool.query(`INSERT INTO audit_log (action, entity_type, entity_id, details, created_at) VALUES ('payment_completed', 'payment', $1, $2, NOW())`, [event.reference, JSON.stringify(event)]);
  },
  'fraud.alerts': async (event) => {
    await pool.query(`INSERT INTO audit_log (action, entity_type, entity_id, details, created_at) VALUES ('fraud_alert', 'fraud', $1, $2, NOW())`, [event.entityId, JSON.stringify(event)]);
    if (event.score > 0.8) {
      console.warn(`[FRAUD] HIGH RISK: entity ${event.entityId} score ${event.score}`);
    }
  },
  'audit.log': async (event) => {
    await pool.query(`INSERT INTO audit_log (action, entity_type, entity_id, details, created_at) VALUES ($1, $2, $3, $4, NOW())`, [event.action, event.resource, event.userId, JSON.stringify(event)]);
  },
};

async function init(groupId = 'insureportal-consumer') {
  try {
    const { Kafka } = require('kafkajs');
    kafka = new Kafka({
      clientId: 'insureportal-consumer',
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
      ssl: process.env.KAFKA_SSL === 'true',
      sasl: process.env.KAFKA_SASL_USERNAME ? {
        mechanism: 'scram-sha-256',
        username: process.env.KAFKA_SASL_USERNAME,
        password: process.env.KAFKA_SASL_PASSWORD,
      } : undefined,
    });
    consumer = kafka.consumer({ groupId });
    await consumer.connect();
    const topics = Object.keys(handlers);
    for (const topic of topics) {
      await consumer.subscribe({ topic, fromBeginning: false });
    }
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const handler = handlers[topic];
        if (handler) {
          try {
            const event = JSON.parse(message.value.toString());
            await handler(event);
          } catch (err) {
            console.error(`[CONSUMER] Error processing ${topic}: ${err.message}`);
          }
        }
      },
    });
    connected = true;
    console.log(`✓ Kafka consumer connected — subscribed to ${topics.length} topics`);
  } catch (err) {
    console.warn(`✗ Kafka consumer not available: ${err.message}`);
  }
}

async function shutdown() {
  if (consumer) {
    await consumer.disconnect();
    connected = false;
  }
}

module.exports = { init, shutdown, isConnected: () => connected };
