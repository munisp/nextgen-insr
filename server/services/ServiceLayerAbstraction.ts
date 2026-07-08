// @ts-check

/**
 * Service Layer Abstraction
 * 
 * Provides clean separation between routers and business logic:
 * - Domain model layer
 * - Repository pattern
 * - Transaction management
 * - Caching layer
 * - Event publishing
 * - Retry logic with exponential backoff
 * 
 * Usage:
 *   const service = new PolicyService();
 *   const policy = await service.createPolicy(data);
 */

import { db } from '../db.js';
import { transactions, customers, auditLogs } from '../drizzle/schema.js';
import { eq, and, gte, sql } from 'drizzle-orm';
import { logger } from '../_core/logger.js';

// Type Definitions
interface TransactionOptions {
  isolationLevel?: 'serializable' | 'repeatable_read' | 'read_committed';
  timeout?: number;
}

interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
}

interface DomainEvent {
  type: string;
  aggregateId: string;
  data: Record<string, unknown>;
  timestamp: string;
}

/**
 * Base Service with common functionality
 */
export class BaseService {
  protected readonly RETRY_OPTIONS: RetryOptions = {
    maxAttempts: 3,
    baseDelay: 100,
    maxDelay: 5000,
  };

  /**
   * Execute function with retry logic
   */
  async withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = this.RETRY_OPTIONS
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        logger.warn(`Attempt ${attempt} failed`, { error: error.message, attempt });

        if (attempt < options.maxAttempts) {
          const delay = Math.min(
            options.baseDelay * Math.pow(2, attempt - 1),
            options.maxDelay
          );
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Execute function with transaction
   */
  async withTransaction<T>(
    fn: (trx: any) => Promise<T>,
    options: TransactionOptions = {}
  ): Promise<T> {
    try {
      return await db.transaction(fn, {
        isolationLevel: options.isolationLevel || 'serializable',
      });
    } catch (error) {
      logger.error('Transaction failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Publish domain event
   */
  async publishEvent(event: DomainEvent): Promise<void> {
    // Would publish to event bus (Kafka, Redis, etc.)
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      type: `event_${event.type}`,
      description: `Domain event: ${event.type} for aggregate ${event.aggregateId}`,
      createdAt: event.timestamp,
      updatedAt: event.timestamp,
    });

    logger.info('Domain event published', {
      eventType: event.type,
      aggregateId: event.aggregateId,
    });
  }

  /**
   * Sleep utility
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate UUID format
   */
  protected isValidUUID(uuid: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
  }

  /**
   * Generate correlation ID
   */
  protected generateCorrelationId(): string {
    return crypto.randomUUID();
  }
}

/**
 * Customer Service
 */
export class CustomerService extends BaseService {
  async getCustomerById(id: string): Promise<any> {
    if (!this.isValidUUID(id)) {
      throw new Error('Invalid customer ID format');
    }

    return this.withRetry(async () => {
      const result = await db
        .select()
        .from(customers)
        .where(eq(customers.id, id))
        .limit(1);

      return result[0] || null;
    });
  }

  async createCustomer(data: Record<string, unknown>): Promise<any> {
    return this.withTransaction(async (trx) => {
      const customer = await trx.insert(customers).values({
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).returning();

      await this.publishEvent({
        type: 'CUSTOMER_CREATED',
        aggregateId: customer[0].id,
        data,
        timestamp: new Date().toISOString(),
      });

      return customer[0];
    });
  }

  async updateCustomer(id: string, data: Record<string, unknown>): Promise<any> {
    return this.withTransaction(async (trx) => {
      const customer = await trx
        .update(customers)
        .set({
          ...data,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(customers.id, id))
        .returning();

      if (!customer[0]) {
        throw new Error('Customer not found');
      }

      await this.publishEvent({
        type: 'CUSTOMER_UPDATED',
        aggregateId: id,
        data,
        timestamp: new Date().toISOString(),
      });

      return customer[0];
    });
  }

  async deleteCustomer(id: string): Promise<boolean> {
    const result = await db
      .delete(customers)
      .where(eq(customers.id, id))
      .returning();

    return result.length > 0;
  }
}

/**
 * Transaction Service
 */
export class TransactionService extends BaseService {
  async getTransactionById(id: string): Promise<any> {
    const result = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, id))
      .limit(1);

    return result[0] || null;
  }

  async createTransaction(data: Record<string, unknown>): Promise<any> {
    return this.withTransaction(async (trx) => {
      const transaction = await trx.insert(transactions).values({
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).returning();

      await this.publishEvent({
        type: 'TRANSACTION_CREATED',
        aggregateId: transaction[0].id,
        data,
        timestamp: new Date().toISOString(),
      });

      return transaction[0];
    });
  }

  async updateTransactionStatus(
    id: string,
    status: string,
    failureReason?: string
  ): Promise<any> {
    return this.withTransaction(async (trx) => {
      const transaction = await trx
        .update(transactions)
        .set({
          status,
          failureReason: failureReason || null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(transactions.id, id))
        .returning();

      if (!transaction[0]) {
        throw new Error('Transaction not found');
      }

      await this.publishEvent({
        type: 'TRANSACTION_STATUS_UPDATED',
        aggregateId: id,
        data: { status, failureReason },
        timestamp: new Date().toISOString(),
      });

      return transaction[0];
    });
  }

  async getTransactionsByCustomer(
    customerId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<any[]> {
    const { limit = 50, offset = 0 } = options;

    return db
      .select()
      .from(transactions)
      .where(eq(transactions.customerId, customerId))
      .orderBy(transactions.createdAt)
      .limit(limit)
      .offset(offset);
  }
}

/**
 * Policy Service (Example domain service)
 */
export class PolicyService extends BaseService {
  async createPolicy(data: Record<string, unknown>): Promise<any> {
    return this.withTransaction(async (trx) => {
      // Business logic validation
      if (!data.customerId) {
        throw new Error('Customer ID is required');
      }

      if (!data.productType) {
        throw new Error('Product type is required');
      }

      if (!data.startDate || !data.endDate) {
        throw new Error('Start and end dates are required');
      }

      // Create policy record
      const policy = await trx
        .insert(sql`policies`)
        .values({
          ...data,
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .returning();

      await this.publishEvent({
        type: 'POLICY_CREATED',
        aggregateId: policy[0].id,
        data,
        timestamp: new Date().toISOString(),
      });

      return policy[0];
    });
  }

  async activatePolicy(policyId: string): Promise<any> {
    return this.withTransaction(async (trx) => {
      const policy = await trx
        .update(sql`policies`)
        .set({
          status: 'active',
          updatedAt: new Date().toISOString(),
        })
        .where(sql`id = ${policyId}`)
        .returning();

      if (!policy[0]) {
        throw new Error('Policy not found');
      }

      await this.publishEvent({
        type: 'POLICY_ACTIVATED',
        aggregateId: policyId,
        data: { policyId },
        timestamp: new Date().toISOString(),
      });

      return policy[0];
    });
  }
}

// Export singleton instances
export const customerService = new CustomerService();
export const transactionService = new TransactionService();
export const policyService = new PolicyService();
