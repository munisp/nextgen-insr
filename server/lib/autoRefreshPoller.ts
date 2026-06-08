// TypeScript enabled — Sprint 96 security audit
/**
 * Auto-Refresh Polling Module — InsurePortal Agency Banking Platform
 *
 * Provides configurable polling intervals for real-time dashboard updates.
 * Supports:
 * - Active test detection with 5s polling
 * - Idle state with 30s polling
 * - Exponential backoff on errors
 * - Graceful stop on component unmount
 */

export interface PollerConfig {
  activeIntervalMs: number; // Polling interval during active tests (default: 5000)
  idleIntervalMs: number; // Polling interval when idle (default: 30000)
  maxBackoffMs: number; // Maximum backoff on errors (default: 60000)
  backoffMultiplier: number; // Backoff multiplier (default: 2)
}

const DEFAULT_CONFIG: PollerConfig = {
  activeIntervalMs: 5_000,
  idleIntervalMs: 30_000,
  maxBackoffMs: 60_000,
  backoffMultiplier: 2,
};

export interface PollerState {
  isActive: boolean;
  currentIntervalMs: number;
  consecutiveErrors: number;
  lastPollAt: number;
  totalPolls: number;
}

export function createPoller(config: Partial<PollerConfig> = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let state: PollerState = {
    isActive: false,
    currentIntervalMs: cfg.idleIntervalMs,
    consecutiveErrors: 0,
    lastPollAt: 0,
    totalPolls: 0,
  };
  let timer: ReturnType<typeof setTimeout> | null = null;

  function calculateInterval(
    hasActiveTest: boolean,
    errorCount: number
  ): number {
    const baseInterval = hasActiveTest
      ? cfg.activeIntervalMs
      : cfg.idleIntervalMs;
    if (errorCount === 0) return baseInterval;
    const backoff = baseInterval * Math.pow(cfg.backoffMultiplier, errorCount);
    return Math.min(backoff, cfg.maxBackoffMs);
  }

  function start(pollFn: () => Promise<{ hasActiveTest: boolean }>) {
    state.isActive = true;
    async function tick() {
      if (!state.isActive) return;
      try {
        const result = await pollFn();
        state.consecutiveErrors = 0;
        state.currentIntervalMs = calculateInterval(result.hasActiveTest, 0);
      } catch {
        state.consecutiveErrors++;
        state.currentIntervalMs = calculateInterval(
          false,
          state.consecutiveErrors
        );
      }
      state.lastPollAt = Date.now();
      state.totalPolls++;
      if (state.isActive) {
        timer = setTimeout(tick, state.currentIntervalMs);
      }
    }
    tick();
  }

  function stop() {
    state.isActive = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function getState(): PollerState {
    return { ...state };
  }

  return { start, stop, getState, calculateInterval };
}
