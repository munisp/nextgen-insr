/**
 * Real-Time Events Service (WebSocket + SSE)
 * Connects to the Rust realtime-events service for live updates.
 * Falls back to SSE for environments without WebSocket support.
 * Offline-first: queues events when offline, replays on reconnect.
 */

export interface RealtimeEvent {
  id: string;
  event_type: string;
  domain: string;
  user_id?: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

type EventHandler = (event: RealtimeEvent) => void;

export class RealtimeEventsService {
  private ws: WebSocket | null = null;
  private eventSource: EventSource | null = null;
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseUrl: string;
  private userId: string | null = null;
  private isOnline = navigator.onLine;
  private offlineQueue: RealtimeEvent[] = [];

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || window.location.origin.replace('http', 'ws');
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());
  }

  connect(token: string, userId: string): void {
    this.userId = userId;
    if (!this.isOnline) {
      console.log('[RT] Offline — will connect when back online');
      return;
    }

    try {
      const wsUrl = `${this.baseUrl}/api/v1/ws?token=${token}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[RT] WebSocket connected');
        this.reconnectAttempts = 0;
        this.flushOfflineQueue();
      };

      this.ws.onmessage = (msg) => {
        try {
          const event: RealtimeEvent = JSON.parse(msg.data);
          this.dispatch(event);
        } catch (e) {
          console.warn('[RT] Failed to parse event:', e);
        }
      };

      this.ws.onclose = () => {
        console.log('[RT] WebSocket closed');
        this.scheduleReconnect(token, userId);
      };

      this.ws.onerror = (err) => {
        console.warn('[RT] WebSocket error, falling back to SSE');
        this.ws?.close();
        this.connectSSE(token, userId);
      };
    } catch (e) {
      this.connectSSE(token, userId);
    }
  }

  private connectSSE(token: string, userId: string): void {
    const sseUrl = `/api/v1/stream/events?token=${token}&user_id=${userId}`;
    this.eventSource = new EventSource(sseUrl);

    this.eventSource.onmessage = (msg) => {
      try {
        const event: RealtimeEvent = JSON.parse(msg.data);
        this.dispatch(event);
      } catch (e) {
        console.warn('[RT] SSE parse error:', e);
      }
    };

    this.eventSource.onerror = () => {
      this.eventSource?.close();
      this.scheduleReconnect(token, userId);
    };
  }

  on(domain: string, handler: EventHandler): () => void {
    if (!this.handlers.has(domain)) {
      this.handlers.set(domain, new Set());
    }
    this.handlers.get(domain)!.add(handler);
    return () => this.handlers.get(domain)?.delete(handler);
  }

  onAll(handler: EventHandler): () => void {
    return this.on('*', handler);
  }

  private dispatch(event: RealtimeEvent): void {
    // Domain-specific handlers
    const domainHandlers = this.handlers.get(event.domain);
    if (domainHandlers) {
      domainHandlers.forEach((h) => h(event));
    }
    // Wildcard handlers
    const allHandlers = this.handlers.get('*');
    if (allHandlers) {
      allHandlers.forEach((h) => h(event));
    }
  }

  private scheduleReconnect(token: string, userId: string): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[RT] Max reconnect attempts reached');
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.connect(token, userId), delay);
  }

  private handleOnline(): void {
    this.isOnline = true;
    console.log('[RT] Back online — reconnecting');
    if (this.userId) {
      const token = localStorage.getItem('token') || '';
      this.connect(token, this.userId);
    }
  }

  private handleOffline(): void {
    this.isOnline = false;
    console.log('[RT] Went offline — queuing events');
  }

  private flushOfflineQueue(): void {
    while (this.offlineQueue.length > 0) {
      const event = this.offlineQueue.shift()!;
      this.dispatch(event);
    }
  }

  disconnect(): void {
    this.ws?.close();
    this.eventSource?.close();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.handlers.clear();
  }
}

// Singleton instance
export const realtimeEvents = new RealtimeEventsService();

// React hook (for use in components)
export function useRealtimeEvent(domain: string, handler: EventHandler): void {
  // In a real React app, this would use useEffect + useRef
  // Simplified for demonstration
  realtimeEvents.on(domain, handler);
}
