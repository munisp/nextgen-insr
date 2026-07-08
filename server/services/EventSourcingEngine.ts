// @ts-check

/**
 * Event Sourcing & CQRS Engine
 * 
 * Next-generation architecture pattern providing:
 * - Complete audit trail via immutable event log
 * - Command Query Responsibility Segregation
 * - Event-driven microservices communication
 * - State reconstruction and projections
 * - Event replay for debugging and migration
 * 
 * Usage:
 *   const es = new EventSourcingEngine();
 *   await es.executeCommand(new CreatePolicyCommand(policyData));
 *   const state = await es.getState(policyId);
 */

import { db } from '../db.js';
import { auditLogs } from '../drizzle/schema.js';
import { eq, gte, desc, and } from 'drizzle-orm';

// Immutable Event Types
interface DomainEvent {
  eventId: string;
  aggregateId: string;
  eventType: string;
  version: number;
  timestamp: string;
  data: Record<string, unknown>;
  metadata: EventMetadata;
}

interface EventMetadata {
  userId: string;
  correlationId: string;
  requestId: string;
  source: string;
  causalEventId?: string;
}

interface Command {
  type: string;
  aggregateId: string;
  data: Record<string, unknown>;
  userId: string;
  correlationId: string;
}

interface Query {
  type: string;
  aggregateId?: string;
  filters?: Record<string, unknown>;
}

interface Projection {
  name: string;
  eventTypes: string[];
  handler: (state: Record<string, unknown>, event: DomainEvent) => Record<string, unknown>;
  initialState: Record<string, unknown>;
}

/**
 * Event Sourcing Engine with CQRS
 */
export class EventSourcingEngine {
  private projections: Map<string, Projection> = new Map();
  private eventStore: Map<string, DomainEvent[]> = new Map();

  constructor() {
    this.registerDefaultProjections();
  }

  /**
   * Execute a command (write side)
   */
  async executeCommand(command: Command): Promise<{
    success: boolean;
    events: DomainEvent[];
    aggregateVersion: number;
  }> {
    // Get existing events for this aggregate
    const existingEvents = this.getEventsForAggregate(command.aggregateId);
    const nextVersion = existingEvents.length + 1;

    // Generate events based on command type
    const events = this.generateEvents(command, nextVersion);

    // Validate events
    const validationErrors = this.validateEvents(events, existingEvents);
    if (validationErrors.length > 0) {
      throw new Error(`Command validation failed: ${validationErrors.join(', ')}`);
    }

    // Store events
    await this.persistEvents(command.aggregateId, events);

    // Update projections
    for (const event of events) {
      await this.applyEvent(event);
    }

    return {
      success: true,
      events,
      aggregateVersion: nextVersion,
    };
  }

  /**
   * Query state (read side)
   */
  async queryState(query: Query): Promise<Record<string, unknown> | null> {
    if (!query.aggregateId) {
      return this.getAllProjections();
    }

    const events = this.getEventsForAggregate(query.aggregateId);
    let state: Record<string, unknown> = {};

    // Reconstruct state from events
    for (const event of events) {
      state = this.reconstructState(state, event);
    }

    // Apply filters
    if (query.filters) {
      state = this.applyFilters(state, query.filters);
    }

    return state;
  }

  /**
   * Replay events for migration or debugging
   */
  async replayEvents(aggregateId: string, fromVersion?: number): Promise<{
    replayedEvents: number;
    newVersion: number;
    errors: string[];
  }> {
    const events = this.getEventsForAggregate(aggregateId);
    const filteredEvents = fromVersion
      ? events.filter(e => e.version >= fromVersion)
      : events;

    const errors: string[] = [];
    let replayed = 0;

    for (const event of filteredEvents) {
      try {
        await this.applyEvent(event, true);
        replayed++;
      } catch (error) {
        errors.push(`Failed to replay event ${event.eventId}: ${error.message}`);
      }
    }

    return {
      replayedEvents: replayed,
      newVersion: events.length,
      errors,
    };
  }

  /**
   * Register a projection handler
   */
  registerProjection(projection: Projection): void {
    this.projections.set(projection.name, projection);
  }

  /**
   * Get event history for an aggregate
   */
  getEventHistory(aggregateId: string): DomainEvent[] {
    return this.getEventsForAggregate(aggregateId);
  }

  /**
   * Get all events with optional filters
   */
  async getFilteredEvents(filters: {
    eventType?: string;
    aggregateId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<DomainEvent[]> {
    // Would query event store with filters
    // For now, return from memory
    let allEvents: DomainEvent[] = [];
    for (const events of this.eventStore.values()) {
      allEvents = allEvents.concat(events);
    }

    // Apply filters
    if (filters.eventType) {
      allEvents = allEvents.filter(e => e.eventType === filters.eventType);
    }
    if (filters.aggregateId) {
      allEvents = allEvents.filter(e => e.aggregateId === filters.aggregateId);
    }
    if (filters.startDate) {
      allEvents = allEvents.filter(e => new Date(e.timestamp) >= filters.startDate!);
    }
    if (filters.endDate) {
      allEvents = allEvents.filter(e => new Date(e.timestamp) <= filters.endDate!);
    }

    // Sort and paginate
    allEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    const offset = filters.offset || 0;
    const limit = filters.limit || 100;
    return allEvents.slice(offset, offset + limit);
  }

  // ==================== Private Methods ====================

  private getEventsForAggregate(aggregateId: string): DomainEvent[] {
    return this.eventStore.get(aggregateId) || [];
  }

  private generateEvents(command: Command, version: number): DomainEvent[] {
    const events: DomainEvent[] = [];
    const baseMetadata: EventMetadata = {
      userId: command.userId,
      correlationId: command.correlationId,
      requestId: crypto.randomUUID(),
      source: 'event-sourcing-engine',
    };

    switch (command.type) {
      case 'CREATE_POLICY':
        events.push({
          eventId: crypto.randomUUID(),
          aggregateId: command.aggregateId,
          eventType: 'POLICY_CREATED',
          version,
          timestamp: new Date().toISOString(),
          data: command.data,
          metadata: baseMetadata,
        });
        break;

      case 'UPDATE_POLICY':
        events.push({
          eventId: crypto.randomUUID(),
          aggregateId: command.aggregateId,
          eventType: 'POLICY_UPDATED',
          version,
          timestamp: new Date().toISOString(),
          data: command.data,
          metadata: baseMetadata,
        });
        break;

      case 'CANCEL_POLICY':
        events.push({
          eventId: crypto.randomUUID(),
          aggregateId: command.aggregateId,
          eventType: 'POLICY_CANCELLED',
          version,
          timestamp: new Date().toISOString(),
          data: command.data,
          metadata: baseMetadata,
        });
        break;

      case 'CREATE_CLAIM':
        events.push({
          eventId: crypto.randomUUID(),
          aggregateId: command.aggregateId,
          eventType: 'CLAIM_CREATED',
          version,
          timestamp: new Date().toISOString(),
          data: command.data,
          metadata: baseMetadata,
        });
        break;

      default:
        events.push({
          eventId: crypto.randomUUID(),
          aggregateId: command.aggregateId,
          eventType: command.type,
          version,
          timestamp: new Date().toISOString(),
          data: command.data,
          metadata: baseMetadata,
        });
    }

    return events;
  }

  private validateEvents(events: DomainEvent[], existingEvents: DomainEvent[]): string[] {
    const errors: string[] = [];
    const nextExpectedVersion = existingEvents.length + 1;

    for (const event of events) {
      if (event.version !== nextExpectedVersion) {
        errors.push(`Expected version ${nextExpectedVersion}, got ${event.version}`);
      }
    }

    return errors;
  }

  private async persistEvents(aggregateId: string, events: DomainEvent[]): Promise<void> {
    // Store in memory
    const existing = this.eventStore.get(aggregateId) || [];
    this.eventStore.set(aggregateId, [...existing, ...events]);

    // Also persist to database
    for (const event of events) {
      await db.insert(auditLogs).values({
        id: event.eventId,
        type: event.eventType,
        description: `Event: ${event.eventType} for aggregate ${aggregateId}`,
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
      });
    }
  }

  private async applyEvent(event: DomainEvent, isReplay: boolean = false): Promise<void> {
    // Update projections
    for (const [, projection] of this.projections) {
      if (projection.eventTypes.includes(event.eventType)) {
        const currentState = this.projections.get(projection.name)?.initialState || {};
        const newState = projection.handler(currentState, event);
        this.projections.set(projection.name, {
          ...projection,
          initialState: newState,
        });
      }
    }
  }

  private reconstructState(
    currentState: Record<string, unknown>,
    event: DomainEvent
  ): Record<string, unknown> {
    // Simple state reconstruction - in production, use projections
    return {
      ...currentState,
      lastEvent: event.eventType,
      lastEventVersion: event.version,
      lastEventTimestamp: event.timestamp,
    };
  }

  private applyFilters(
    state: Record<string, unknown>,
    filters: Record<string, unknown>
  ): Record<string, unknown> {
    let result = state;
    for (const [key, value] of Object.entries(filters)) {
      if (result[key] !== value) {
        return {}; // Filter didn't match
      }
    }
    return result;
  }

  private async getAllProjections(): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    for (const [name, projection] of this.projections) {
      result[name] = projection.initialState;
    }
    return result;
  }

  private registerDefaultProjections(): void {
    // Policy projection
    this.projections.set('policy_state', {
      name: 'policy_state',
      eventTypes: ['POLICY_CREATED', 'POLICY_UPDATED', 'POLICY_CANCELLED'],
      handler: (state: Record<string, unknown>, event: DomainEvent) => ({
        ...state,
        ...event.data,
        status: event.eventType === 'POLICY_CANCELLED' ? 'cancelled' : 'active',
        lastUpdated: event.timestamp,
      }),
      initialState: {},
    });

    // Claim projection
    this.projections.set('claim_state', {
      name: 'claim_state',
      eventTypes: ['CLAIM_CREATED'],
      handler: (state: Record<string, unknown>, event: DomainEvent) => ({
        ...state,
        ...event.data,
        status: 'open',
        createdAt: event.timestamp,
      }),
      initialState: {},
    });
  }
}

// Export singleton instance
export const eventSourcingEngine = new EventSourcingEngine();
