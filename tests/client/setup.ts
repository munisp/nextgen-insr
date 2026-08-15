/**
 * Client test setup: jest-dom matchers, timezone, and DOM stubs that
 * happy-dom does not implement but charting/UI libs probe for.
 */
import "@testing-library/jest-dom/vitest";
import { afterAll } from "vitest";

process.env.TZ = "UTC";

// happy-dom 20 keeps a window-level handle open that prevents the vitest
// worker from exiting after the run; close the virtual browser explicitly.
afterAll(() => {
  (window as unknown as { happyDOM?: { close?: () => void } }).happyDOM?.close?.();
});

// happy-dom lacks layout metrics; recharts' ResponsiveContainer warns on
// zero-size containers. Keep the console output focused on real failures.
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const first = String(args[0] ?? "");
  if (first.includes("The width(0) and height(0) of chart should be greater")) {
    return;
  }
  originalWarn(...args);
};

// matchMedia is not implemented in happy-dom (used by useIsMobile etc.)
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// ResizeObserver is not implemented in happy-dom (recharts/radix rely on it).
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
