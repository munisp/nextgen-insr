/**
 * useLongPress — Long press gesture detection for mobile interactions
 * 
 * Provides:
 * - Long press detection with configurable duration
 * - Callback on press start, press end, and long press trigger
 * - Visual feedback during long press
 * - Touch and mouse support
 */
import { useCallback, useEffect, useRef } from "react";

export interface LongPressCallbacks {
  onPressStart?: () => void;
  onPressEnd?: () => void;
  onLongPress?: () => void;
}

export interface LongPressConfig {
  duration?: number; // Milliseconds before long press triggers (default: 500)
  threshold?: number; // Maximum movement threshold (default: 10px)
  callbacks?: LongPressCallbacks;
}

const DEFAULT_CONFIG: Required<LongPressConfig> = {
  duration: 500,
  threshold: 10,
  callbacks: {},
};

export function useLongPress(
  elementRef: React.RefObject<HTMLElement | null>,
  config: LongPressConfig = {}
) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const isLongPressedRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    startPosRef.current = null;
    isLongPressedRef.current = false;
  }, []);

  const handlePressStart = useCallback(
    (e: TouchEvent | MouseEvent) => {
      e.preventDefault();
      clearTimers();

      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

      startPosRef.current = { x: clientX, y: clientY };

      mergedConfig.callbacks?.onPressStart?.();

      timeoutRef.current = setTimeout(() => {
        isLongPressedRef.current = true;
        mergedConfig.callbacks?.onLongPress?.();
      }, mergedConfig.duration);
    },
    [clearTimers, mergedConfig.callbacks, mergedConfig.duration]
  );

  const handlePressMove = useCallback(
    (e: TouchEvent | MouseEvent) => {
      if (!startPosRef.current) return;

      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

      const deltaX = Math.abs(clientX - startPosRef.current.x);
      const deltaY = Math.abs(clientY - startPosRef.current.y);
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      if (distance > mergedConfig.threshold) {
        clearTimers();
        mergedConfig.callbacks?.onPressEnd?.();
      }
    },
    [clearTimers, mergedConfig.callbacks, mergedConfig.threshold]
  );

  const handlePressEnd = useCallback(
    (e: TouchEvent | MouseEvent) => {
      e.preventDefault();
      clearTimers();
      if (!isLongPressedRef.current) {
        mergedConfig.callbacks?.onPressEnd?.();
      }
    },
    [clearTimers, mergedConfig.callbacks]
  );

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    element.addEventListener("touchstart", handlePressStart, {
      passive: false,
    });
    element.addEventListener("touchmove", handlePressMove, { passive: true });
    element.addEventListener("touchend", handlePressEnd);
    element.addEventListener("touchcancel", handlePressEnd);

    // Also handle mouse events for desktop testing
    element.addEventListener("mousedown", handlePressStart);
    element.addEventListener("mousemove", handlePressMove);
    element.addEventListener("mouseup", handlePressEnd);
    element.addEventListener("mouseleave", handlePressEnd);

    return () => {
      element.removeEventListener("touchstart", handlePressStart);
      element.removeEventListener("touchmove", handlePressMove);
      element.removeEventListener("touchend", handlePressEnd);
      element.removeEventListener("touchcancel", handlePressEnd);
      element.removeEventListener("mousedown", handlePressStart);
      element.removeEventListener("mousemove", handlePressMove);
      element.removeEventListener("mouseup", handlePressEnd);
      element.removeEventListener("mouseleave", handlePressEnd);
      clearTimers();
    };
  }, [
    elementRef,
    handlePressStart,
    handlePressMove,
    handlePressEnd,
    clearTimers,
  ]);

  return {
    isLongPressed: isLongPressedRef.current,
    cancel: clearTimers,
  };
}
