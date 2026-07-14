/**
 * Kafka Event Producer for InsurePortal
 * Publishes domain events to Kafka topics for event sourcing
 * 
 * Usage: const producer = require('./event-producer'); 
 *        await producer.publish('claims.submitted', { claimId, policyId, amount });
 */
let kafka = null;
let producer = null;
let connected = false;

async function init() {
  try {
    const { Kafka } = require('kafkajs');
    kafka = new Kafka({
      clientId: 'insureportal',
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
      ssl: process.env.KAFKA_SSL === 'true',
      sasl: process.env.KAFKA_SASL_USERNAME ? {
        mechanism: 'scram-sha-256',
        username: process.env.KAFKA_SASL_USERNAME,
        password: process.env.KAFKA_SASL_PASSWORD,
      } : undefined,
      retry: { initialRetryTime: 300, retries: 5 },
    });
    producer = kafka.producer({ idempotent: true });
    await producer.connect();
    connected = true;
    console.log('✓ Kafka producer connected');
  } catch (err) {
    console.warn(`✗ Kafka not available: ${err.message} — events will be logged only`);
  }
}

async function publish(topic, payload, key) {
  const event = {
    eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    topic,
    ...payload,
  };
  
  if (connected && producer) {
    try {
      await producer.send({
        topic,
        messages: [{ key: key || event.eventId, value: JSON.stringify(event) }],
      });
      return { published: true, eventId: event.eventId };
    } catch (err) {
      console.error(`[KAFKA] Publish failed for ${topic}: ${err.message}`);
    }
  }
  
  // Fallback: log to console
  console.log(`[EVENT] ${topic}:`, JSON.stringify(event).slice(0, 200));
  return { published: false, eventId: event.eventId, fallback: 'console' };
}

async function shutdown() {
  if (producer) {
    await producer.disconnect();
    connected = false;
  }
}

// Domain-specific event helpers
const events = {
  claimSubmitted: (data) => publish('claims.submitted', { type: 'CLAIM_SUBMITTED', claimId: data.claimId, policyId: data.policyId, amount: data.amount, claimant: data.claimant }),
  claimReviewed: (data) => publish('claims.reviewed', { type: 'CLAIM_REVIEWED', claimId: data.claimId, reviewer: data.reviewer, decision: data.decision }),
  claimApproved: (data) => publish('claims.approved', { type: 'CLAIM_APPROVED', claimId: data.claimId, approver: data.approver, approvedAmount: data.amount }),
  claimPaid: (data) => publish('claims.paid', { type: 'CLAIM_PAID', claimId: data.claimId, amount: data.amount, paymentRef: data.paymentRef }),
  claimRejected: (data) => publish('claims.rejected', { type: 'CLAIM_REJECTED', claimId: data.claimId, reason: data.reason }),
  
  policyCreated: (data) => publish('policies.created', { type: 'POLICY_CREATED', policyId: data.policyId, product: data.product, premium: data.premium }),
  policyRenewed: (data) => publish('policies.renewed', { type: 'POLICY_RENEWED', policyId: data.policyId, newPremium: data.premium }),
  policyCancelled: (data) => publish('policies.cancelled', { type: 'POLICY_CANCELLED', policyId: data.policyId, reason: data.reason }),
  
  paymentInitiated: (data) => publish('payments.initiated', { type: 'PAYMENT_INITIATED', reference: data.reference, amount: data.amount, gateway: data.gateway }),
  paymentCompleted: (data) => publish('payments.completed', { type: 'PAYMENT_COMPLETED', reference: data.reference, amount: data.amount }),
  paymentFailed: (data) => publish('payments.failed', { type: 'PAYMENT_FAILED', reference: data.reference, reason: data.reason }),
  
  auditLog: (data) => publish('audit.log', { type: 'AUDIT', action: data.action, userId: data.userId, resource: data.resource, details: data.details }),
  
  fraudAlert: (data) => publish('fraud.alerts', { type: 'FRAUD_ALERT', entityId: data.entityId, score: data.score, factors: data.factors }),
  
  kycSubmitted: (data) => publish('kyc.submitted', { type: 'KYC_SUBMITTED', userId: data.userId, level: data.level }),
  kycVerified: (data) => publish('kyc.verified', { type: 'KYC_VERIFIED', userId: data.userId, level: data.level }),
};

module.exports = { init, publish, shutdown, events };
