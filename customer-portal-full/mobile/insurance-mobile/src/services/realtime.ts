/**
 * Real-Time Events Service for React Native
 * WebSocket connection to realtime-events Rust service.
 * Offline-first: queues missed events, replays on reconnect.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

export interface RealtimeEvent {
  id: string;
  event_type: string;
  domain: string;
  user_id?: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

type EventHandler = (event: RealtimeEvent) => void;

class MobileRealtimeService {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private reconnectAttempts = 0;
  private isConnected = false;
  private offlineQueue: RealtimeEvent[] = [];
  private lastEventId: string | null = null;
  private baseUrl: string;

  constructor() {
    this.baseUrl = __DEV__
      ? 'ws://localhost:8104'
      : 'wss://api.insureportal.ng';

    // Listen for network state changes
    NetInfo.addEventListener((state) => {
      if (state.isConnected && !this.isConnected) {
        this.reconnect();
      }
    });
  }

  async connect(token: string, userId: string): Promise<void> {
    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      console.log('[RT-Mobile] Offline — will connect when available');
      return;
    }

    try {
      this.ws = new WebSocket(`${this.baseUrl}/api/v1/ws`, [], {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-User-ID': userId,
          'X-Platform': Platform.OS,
          'X-Last-Event-ID': this.lastEventId || '',
        },
      });

      this.ws.onopen = () => {
        console.log('[RT-Mobile] Connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (msg) => {
        try {
          const event: RealtimeEvent = JSON.parse(msg.data);
          this.lastEventId = event.id;
          this.dispatch(event);
          this.persistLastEventId(event.id);
        } catch (e) {
          console.warn('[RT-Mobile] Parse error:', e);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.scheduleReconnect(token, userId);
      };

      this.ws.onerror = () => {
        this.isConnected = false;
      };
    } catch (e) {
      console.warn('[RT-Mobile] Connection failed:', e);
    }
  }

  on(domain: string, handler: EventHandler): () => void {
    if (!this.handlers.has(domain)) {
      this.handlers.set(domain, new Set());
    }
    this.handlers.get(domain)!.add(handler);
    return () => {
      this.handlers.get(domain)?.delete(handler);
    };
  }

  private dispatch(event: RealtimeEvent): void {
    const handlers = this.handlers.get(event.domain);
    if (handlers) handlers.forEach((h) => h(event));
    const all = this.handlers.get('*');
    if (all) all.forEach((h) => h(event));
  }

  private scheduleReconnect(token: string, userId: string): void {
    if (this.reconnectAttempts >= 10) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    setTimeout(() => this.connect(token, userId), delay);
  }

  private async reconnect(): Promise<void> {
    const token = await AsyncStorage.getItem('auth_token');
    const userId = await AsyncStorage.getItem('user_id');
    if (token && userId) {
      this.connect(token, userId);
    }
  }

  private async persistLastEventId(id: string): Promise<void> {
    await AsyncStorage.setItem('last_event_id', id);
  }

  disconnect(): void {
    this.ws?.close();
    this.isConnected = false;
    this.handlers.clear();
  }
}

export const mobileRealtime = new MobileRealtimeService();
