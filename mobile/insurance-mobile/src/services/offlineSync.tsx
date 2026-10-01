import React, { createContext, useContext, useEffect, useCallback, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import SQLite from 'react-native-sqlite-storage';

SQLite.enablePromise(true);

interface QueuedOperation {
  id: string;
  type: 'CREATE' | 'UPDATE' | 'DELETE';
  entity: string;
  payload: Record<string, unknown>;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
  priority: 'critical' | 'high' | 'normal' | 'low';
  conflictStrategy: 'client-wins' | 'server-wins' | 'manual';
}

interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncAt: number | null;
  syncErrors: Array<{ operationId: string; error: string; timestamp: number }>;
  bandwidthMode: 'full' | 'reduced' | 'minimal';
}

interface OfflineSyncContextType {
  state: SyncState;
  enqueue: (op: Omit<QueuedOperation, 'id' | 'timestamp' | 'retryCount'>) => Promise<void>;
  syncNow: () => Promise<void>;
  clearQueue: () => Promise<void>;
  getCachedData: <T>(key: string) => Promise<T | null>;
  setCachedData: <T>(key: string, data: T, ttl?: number) => Promise<void>;
}

const OfflineSyncContext = createContext<OfflineSyncContextType | null>(null);

const QUEUE_KEY = '@insureportal/offline_queue';
const CACHE_PREFIX = '@insureportal/cache/';
const SYNC_INTERVAL = 30_000;
// 2026-10-01 (R1c): endpoint from centralized config; no envless default.
import { API_BASE_URL } from '../config';

const API_BASE = API_BASE_URL;

export function OfflineSyncProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SyncState>({
    isOnline: true,
    isSyncing: false,
    pendingCount: 0,
    lastSyncAt: null,
    syncErrors: [],
    bandwidthMode: 'full',
  });
  const dbRef = useRef<SQLite.SQLiteDatabase | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    initializeDB();
    const unsubscribe = NetInfo.addEventListener(handleConnectivityChange);
    syncTimerRef.current = setInterval(attemptSync, SYNC_INTERVAL);
    return () => {
      unsubscribe();
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    };
  }, []);

  async function initializeDB() {
    const db = await SQLite.openDatabase({ name: 'insureportal_offline.db', location: 'default' });
    await db.executeSql(`
      CREATE TABLE IF NOT EXISTS offline_queue (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        entity TEXT NOT NULL,
        payload TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 5,
        priority TEXT DEFAULT 'normal',
        conflict_strategy TEXT DEFAULT 'client-wins',
        status TEXT DEFAULT 'pending'
      )
    `);
    await db.executeSql(`
      CREATE TABLE IF NOT EXISTS cache_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER,
        version INTEGER DEFAULT 1
      )
    `);
    await db.executeSql(`
      CREATE TABLE IF NOT EXISTS sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_id TEXT,
        direction TEXT,
        status TEXT,
        timestamp INTEGER,
        details TEXT
      )
    `);
    dbRef.current = db;
    await refreshPendingCount();
  }

  function handleConnectivityChange(netState: NetInfoState) {
    const isOnline = !!netState.isConnected;
    let bandwidthMode: SyncState['bandwidthMode'] = 'full';
    if (netState.type === 'cellular') {
      const details = netState.details as { cellularGeneration?: string } | null;
      if (details?.cellularGeneration === '2g') bandwidthMode = 'minimal';
      else if (details?.cellularGeneration === '3g') bandwidthMode = 'reduced';
    }
    setState((prev) => ({ ...prev, isOnline, bandwidthMode }));
    if (isOnline) attemptSync();
  }

  async function refreshPendingCount() {
    if (!dbRef.current) return;
    const [result] = await dbRef.current.executeSql(
      "SELECT COUNT(*) as cnt FROM offline_queue WHERE status = 'pending'"
    );
    setState((prev) => ({ ...prev, pendingCount: result.rows.item(0).cnt }));
  }

  const enqueue = useCallback(async (op: Omit<QueuedOperation, 'id' | 'timestamp' | 'retryCount'>) => {
    if (!dbRef.current) return;
    const id = `op_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await dbRef.current.executeSql(
      `INSERT INTO offline_queue (id, type, entity, payload, timestamp, max_retries, priority, conflict_strategy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, op.type, op.entity, JSON.stringify(op.payload), Date.now(), op.maxRetries, op.priority, op.conflictStrategy]
    );
    await refreshPendingCount();
    if (state.isOnline) attemptSync();
  }, [state.isOnline]);

  async function attemptSync() {
    if (!dbRef.current || state.isSyncing || !state.isOnline) return;
    setState((prev) => ({ ...prev, isSyncing: true }));

    try {
      const [results] = await dbRef.current.executeSql(
        "SELECT * FROM offline_queue WHERE status = 'pending' ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, timestamp ASC LIMIT 20"
      );

      const errors: SyncState['syncErrors'] = [];

      for (let i = 0; i < results.rows.length; i++) {
        const row = results.rows.item(i);
        try {
          const response = await fetch(`${API_BASE}/api/v1/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              operationId: row.id,
              type: row.type,
              entity: row.entity,
              payload: JSON.parse(row.payload),
              conflictStrategy: row.conflict_strategy,
              clientTimestamp: row.timestamp,
            }),
          });

          // 2026-10-01 (R1c) CRITICAL data-loss fix: HTTP 200 alone is NOT
          // proof of persistence. The BFF now returns per-item statuses;
          // only mark the op synced when the server confirms THIS operation
          // persisted. synced:false (with a reason) keeps the item queued
          // for retry instead of being silently dropped.
          const body = await response.json().catch(() => null);
          const itemResult = body?.results?.find?.((r: any) => r.operationId === row.id);
          const confirmed = response.ok && (itemResult ? itemResult.synced === true : body?.synced === true);
          if (confirmed) {
            await dbRef.current!.executeSql("UPDATE offline_queue SET status = 'synced' WHERE id = ?", [row.id]);
            await dbRef.current!.executeSql(
              "INSERT INTO sync_log (operation_id, direction, status, timestamp, details) VALUES (?, 'up', 'success', ?, ?)",
              [row.id, Date.now(), `Synced ${row.entity} ${row.type}`]
            );
          } else if (response.status === 409) {
            if (row.conflict_strategy === 'server-wins') {
              await dbRef.current!.executeSql("UPDATE offline_queue SET status = 'conflict-resolved' WHERE id = ?", [row.id]);
            } else {
              await dbRef.current!.executeSql("UPDATE offline_queue SET status = 'conflict' WHERE id = ?", [row.id]);
              errors.push({ operationId: row.id, error: 'Conflict detected', timestamp: Date.now() });
            }
          } else {
            // 2026-10-01 (R1c): surface the server's per-item reason so the
            // sync log and retry path reflect the real failure.
            throw new Error(itemResult?.error || body?.error || `HTTP ${response.status}`);
          }
        } catch (err) {
          const newRetry = row.retry_count + 1;
          if (newRetry >= row.max_retries) {
            await dbRef.current!.executeSql("UPDATE offline_queue SET status = 'failed' WHERE id = ?", [row.id]);
            errors.push({ operationId: row.id, error: `Max retries (${row.max_retries}) exceeded`, timestamp: Date.now() });
          } else {
            await dbRef.current!.executeSql("UPDATE offline_queue SET retry_count = ? WHERE id = ?", [newRetry, row.id]);
          }
        }
      }

      setState((prev) => ({
        ...prev, lastSyncAt: Date.now(), syncErrors: errors, isSyncing: false,
      }));
    } catch {
      setState((prev) => ({ ...prev, isSyncing: false }));
    }
    await refreshPendingCount();
  }

  const syncNow = useCallback(async () => { await attemptSync(); }, []);

  const clearQueue = useCallback(async () => {
    if (!dbRef.current) return;
    await dbRef.current.executeSql("DELETE FROM offline_queue WHERE status IN ('synced', 'failed', 'conflict-resolved')");
    await refreshPendingCount();
  }, []);

  const getCachedData = useCallback(async <T,>(key: string): Promise<T | null> => {
    if (!dbRef.current) {
      const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    }
    const [result] = await dbRef.current.executeSql(
      'SELECT value, expires_at FROM cache_store WHERE key = ?', [key]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows.item(0);
    if (row.expires_at && row.expires_at < Date.now()) {
      await dbRef.current.executeSql('DELETE FROM cache_store WHERE key = ?', [key]);
      return null;
    }
    return JSON.parse(row.value);
  }, []);

  const setCachedData = useCallback(async <T,>(key: string, data: T, ttl?: number) => {
    const expiresAt = ttl ? Date.now() + ttl : null;
    if (!dbRef.current) {
      await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify(data));
      return;
    }
    await dbRef.current.executeSql(
      'INSERT OR REPLACE INTO cache_store (key, value, expires_at) VALUES (?, ?, ?)',
      [key, JSON.stringify(data), expiresAt]
    );
  }, []);

  return (
    <OfflineSyncContext.Provider value={{ state, enqueue, syncNow, clearQueue, getCachedData, setCachedData }}>
      {children}
    </OfflineSyncContext.Provider>
  );
}

export function useOfflineSync() {
  const ctx = useContext(OfflineSyncContext);
  if (!ctx) throw new Error('useOfflineSync must be used within OfflineSyncProvider');
  return ctx;
}
