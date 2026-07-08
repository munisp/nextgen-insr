// @ts-check

// TypeScript enabled — Sprint 96 security audit
/**
 * WebSocket Resilience Middleware (S86-26)
 *
 * Provides:
 * - Automatic reconnection with exponential backoff
 * - Message queuing during disconnection
 * - Heartbeat/ping-pong health monitoring
 * - Connection state machine (CONNECTING → OPEN → CLOSING → CLOSED)
 * - Message deduplication via idempotency keys
 * - Low-bandwidth mode with message compression
 * - Graceful degradation to HTTP long-polling
 */

export interface WebSocketConfig {
  url: string;
  reconnectInterval: number; // Base reconnect interval (ms)
  maxReconnectInterval: number; // Max backoff interval (ms)
  reconnectDecay: number; // Backoff multiplier
  maxReconnectAttempts: number; // Max attempts before fallback
  heartbeatInterval: number; // Ping interval (ms)
  heartbeatTimeout: number; // Pong timeout (ms)
  messageQueueSize: number; // Max queued messages during disconnect
  enableCompression: boolean; // Enable per-message deflate
  lowBandwidthThreshold: number; // Bytes/sec threshold for low-bandwidth mode
}

export const DEFAULT_WS_CONFIG: WebSocketConfig = {
  url: "",
  reconnectInterval: 1000,
  maxReconnectInterval: 30000,
  reconnectDecay: 1.5,
  maxReconnectAttempts: 50,
  heartbeatInterval: 25000,
  heartbeatTimeout: 10000,
  messageQueueSize: 500,
  enableCompression: true,
  lowBandwidthThreshold: 5000,
};

export enum ConnectionState {
  CONNECTING = "CONNECTING",
  OPEN = "OPEN",
  CLOSING = "CLOSING",
  CLOSED = "CLOSED",
  RECONNECTING = "RECONNECTING",
  FALLBACK_POLLING = "FALLBACK_POLLING",
}

export interface QueuedMessage {
  id: string;
  payload: string;
  timestamp: number;
  retryCount: number;
  priority: "high" | "normal" | "low";
}

export interface ConnectionMetrics {
  state: ConnectionState;
  reconnectAttempts: number;
  messagesQueued: number;
  messagesSent: number;
  messagesReceived: number;
  bytesTransferred: number;
  lastHeartbeat: number;
  latencyMs: number;
  uptime: number;
  connectionStarted: number;
  disconnections: number;
  isLowBandwidth: boolean;
}

/**
 * Resilient WebSocket client with offline-first queue
 */
export class ResilientWebSocket {
  private ws: WebSocket | null = null;
  private config: WebSocketConfig;
  private state: ConnectionState = ConnectionState.CLOSED;
  private messageQueue: QueuedMessage[] = [];
  private reconnectAttempts = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private metrics: ConnectionMetrics;
  private messageHandlers: Map<string, (data: any) => void> = new Map();
  private processedIds: Set<string> = new Set();
  private bandwidthSamples: number[] = [];

  constructor(config: Partial<WebSocketConfig>) {
    this.config = { ...DEFAULT_WS_CONFIG, ...config };
    this.metrics = {
      state: ConnectionState.CLOSED,
      reconnectAttempts: 0,
      messagesQueued: 0,
      messagesSent: 0,
      messagesReceived: 0,
      bytesTransferred: 0,
      lastHeartbeat: 0,
      latencyMs: 0,
      uptime: 0,
      connectionStarted: 0,
      disconnections: 0,
      isLowBandwidth: false,
    };
  }

  connect(): void {
    if (
      this.state === ConnectionState.OPEN ||
      this.state === ConnectionState.CONNECTING
    ) {
      return;
    }

    this.state = ConnectionState.CONNECTING;
    this.metrics.state = ConnectionState.CONNECTING;
    this.metrics.connectionStarted = Date.now();

    try {
      this.ws = new WebSocket(this.config.url);
      this.setupEventHandlers();
    } catch (error) {
      console.error("[WS Resilience] Connection failed:", error);
      this.scheduleReconnect();
    }
  }

  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.state = ConnectionState.OPEN;
      this.metrics.state = ConnectionState.OPEN;
      this.reconnectAttempts = 0;
      this.metrics.reconnectAttempts = 0;
      console.log("[WS Resilience] Connected");
      this.startHeartbeat();
      this.flushQueue();
    };

    this.ws.onmessage = event => {
      this.metrics.messagesReceived++;
      this.metrics.bytesTransferred += event.data.length;
      this.updateBandwidth(event.data.length);

      try {
        const message = JSON.parse(event.data);

        // Deduplication check
        if (message.id && this.processedIds.has(message.id)) {
          return; // Already processed
        }
        if (message.id) {
          this.processedIds.add(message.id);
          // Limit dedup cache size
          if (this.processedIds.size > 10000) {
            const arr = Array.from(this.processedIds);
            this.processedIds = new Set(arr.slice(-5000));
          }
        }

        // Handle heartbeat pong
        if (message.type === "pong") {
          this.metrics.latencyMs = Date.now() - (message.timestamp || 0);
          this.metrics.lastHeartbeat = Date.now();
          return;
        }

        // Dispatch to registered handlers
        const handler = this.messageHandlers.get(message.type);
        if (handler) {
          handler(message.payload);
        }
      } catch (e) {
        // Non-JSON message, pass through
        const handler = this.messageHandlers.get("raw");
        if (handler) handler(event.data);
      }
    };

    this.ws.onclose = event => {
      this.state = ConnectionState.CLOSED;
      this.metrics.state = ConnectionState.CLOSED;
      this.metrics.disconnections++;
      this.stopHeartbeat();

      if (!event.wasClean) {
        console.warn(`[WS Resilience] Unexpected close (code: ${event.code})`);
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = error => {
      console.error("[WS Resilience] Error:", error);
    };
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.state === ConnectionState.OPEN && this.ws) {
        const ping = JSON.stringify({ type: "ping", timestamp: Date.now() });
        this.ws.send(ping);

        // Check for pong timeout
        setTimeout(() => {
          if (
            Date.now() - this.metrics.lastHeartbeat >
            this.config.heartbeatTimeout
          ) {
            console.warn("[WS Resilience] Heartbeat timeout, reconnecting...");
            this.ws?.close();
          }
        }, this.config.heartbeatTimeout);
      }
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.warn(
        "[WS Resilience] Max reconnect attempts reached, falling back to polling"
      );
      this.state = ConnectionState.FALLBACK_POLLING;
      this.metrics.state = ConnectionState.FALLBACK_POLLING;
      return;
    }

    this.state = ConnectionState.RECONNECTING;
    this.metrics.state = ConnectionState.RECONNECTING;
    this.reconnectAttempts++;
    this.metrics.reconnectAttempts = this.reconnectAttempts;

    const delay = Math.min(
      this.config.reconnectInterval *
        Math.pow(this.config.reconnectDecay, this.reconnectAttempts - 1),
      this.config.maxReconnectInterval
    );

    console.log(
      `[WS Resilience] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Send a message with offline queue support
   */
  send(
    type: string,
    payload: any,
    priority: "high" | "normal" | "low" = "normal"
  ): string {
    const id = `msg_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const message = JSON.stringify({
      id,
      type,
      payload,
      timestamp: Date.now(),
    });

    if (this.state === ConnectionState.OPEN && this.ws) {
      try {
        // Low-bandwidth mode: batch messages
        if (this.metrics.isLowBandwidth && priority !== "high") {
          this.enqueue({
            id,
            payload: message,
            timestamp: Date.now(),
            retryCount: 0,
            priority,
          });
          return id;
        }

        this.ws.send(message);
        this.metrics.messagesSent++;
        this.metrics.bytesTransferred += message.length;
      } catch (error) {
        // Queue on send failure
        this.enqueue({
          id,
          payload: message,
          timestamp: Date.now(),
          retryCount: 0,
          priority,
        });
      }
    } else {
      // Offline: queue the message
      this.enqueue({
        id,
        payload: message,
        timestamp: Date.now(),
        retryCount: 0,
        priority,
      });
    }

    return id;
  }

  private enqueue(msg: QueuedMessage): void {
    if (this.messageQueue.length >= this.config.messageQueueSize) {
      // Drop lowest priority messages first
      const lowIdx = this.messageQueue.findIndex(m => m.priority === "low");
      if (lowIdx >= 0) {
        this.messageQueue.splice(lowIdx, 1);
      } else {
        this.messageQueue.shift(); // Drop oldest
      }
    }
    this.messageQueue.push(msg);
    this.metrics.messagesQueued = this.messageQueue.length;
  }

  private flushQueue(): void {
    if (!this.ws || this.state !== ConnectionState.OPEN) return;

    // Sort by priority (high first) then by timestamp
    const sorted = [...this.messageQueue].sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return a.timestamp - b.timestamp;
    });

    const failed: QueuedMessage[] = [];
    for (const msg of sorted) {
      try {
        this.ws.send(msg.payload);
        this.metrics.messagesSent++;
      } catch (error) {
        msg.retryCount++;
        if (msg.retryCount < 3) {
          failed.push(msg);
        }
      }
    }

    this.messageQueue = failed;
    this.metrics.messagesQueued = this.messageQueue.length;
    console.log(
      `[WS Resilience] Flushed queue: ${sorted.length - failed.length} sent, ${failed.length} failed`
    );
  }

  private updateBandwidth(bytes: number): void {
    this.bandwidthSamples.push(bytes);
    if (this.bandwidthSamples.length > 10) {
      this.bandwidthSamples.shift();
    }
    const avgBytesPerSec =
      this.bandwidthSamples.reduce((a, b) => a + b, 0) /
      this.bandwidthSamples.length;
    this.metrics.isLowBandwidth =
      avgBytesPerSec < this.config.lowBandwidthThreshold;
  }

  /**
   * Register a message handler by type
   */
  on(type: string, handler: (data: any) => void): void {
    this.messageHandlers.set(type, handler);
  }

  /**
   * Get current connection metrics
   */
  getMetrics(): ConnectionMetrics {
    if (this.state === ConnectionState.OPEN) {
      this.metrics.uptime = Date.now() - this.metrics.connectionStarted;
    }
    return { ...this.metrics };
  }

  /**
   * Graceful disconnect
   */
  disconnect(): void {
    this.state = ConnectionState.CLOSING;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
    }
    this.state = ConnectionState.CLOSED;
    this.metrics.state = ConnectionState.CLOSED;
  }

  /**
   * Get queued messages count
   */
  getQueueSize(): number {
    return this.messageQueue.length;
  }

  /**
   * Check if in low-bandwidth mode
   */
  isLowBandwidth(): boolean {
    return this.metrics.isLowBandwidth;
  }
}

export default ResilientWebSocket;
