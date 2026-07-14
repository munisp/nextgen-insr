/**
 * useSwipeGestures — Mobile touch gesture handling for swipe actions
 * 
 * Provides:
 * - Swipe detection (left, right, up, down)
 * - Swipe threshold configuration
 * - Callback for swipe actions
 * - Touch move feedback
 */
import { useCallback, useEffect, useRef } from "react";

export type SwipeDirection = "left" | "right" | "up" | "down";

export interface SwipeCallbacks {
  onSwipe?: (direction: SwipeDirection) => void;
  onSwipeStart?: (direction: SwipeDirection) => void;
  onSwipeEnd?: (direction: SwipeDirection) => void;
  onDrag?: (deltaX: number, deltaY: number) => void;
}

export interface SwipeConfig {
  threshold?: number; // Minimum distance for swipe (default: 50)
  cancelThreshold?: number; // Angle threshold in degrees (default: 45)
  minVelocity?: number; // Minimum swipe velocity (default: 0.3)
  callbacks?: SwipeCallbacks;
}

export interface SwipeState {
  isDragging: boolean;
  startX: number;
  startY: number;
  deltaX: number;
  deltaY: number;
  currentDirection: SwipeDirection | null;
}

const DEFAULT_CONFIG: Required<SwipeConfig> = {
  threshold: 50,
  cancelThreshold: 45,
  minVelocity: 0.3,
  callbacks: {},
};

function getSwipeDirection(
  deltaX: number,
  deltaY: number,
  cancelThreshold: number
): SwipeDirection | null {
  const absDeltaX = Math.abs(deltaX);
  const absDeltaY = Math.abs(deltaY);
  const angle =
    (Math.atan2(absDeltaY, absDeltaX) * 180) / Math.PI;

  if (angle > cancelThreshold) {
    return deltaY > 0 ? "down" : "up";
  }
  return deltaX > 0 ? "right" : "left";
}

export function useSwipeGestures(
  elementRef: React.RefObject<HTMLElement | null>,
  config: SwipeConfig = {}
) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const state = useRef<SwipeState>({
    isDragging: false,
    startX: 0,
    startY: 0,
    deltaX: 0,
    deltaY: 0,
    currentDirection: null,
  });

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!elementRef.current?.contains(e.target as Node)) return;

      const touch = e.touches[0];
      state.current = {
        isDragging: true,
        startX: touch.clientX,
        startY: touch.clientY,
        deltaX: 0,
        deltaY: 0,
        currentDirection: null,
      };

      mergedConfig.callbacks?.onSwipeStart?.(
        state.current.currentDirection || "left"
      );
    },
    [elementRef, mergedConfig.callbacks]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!state.current.isDragging) return;

      const touch = e.touches[0];
      const deltaX = touch.clientX - state.current.startX;
      const deltaY = touch.clientY - state.current.startY;

      state.current.deltaX = deltaX;
      state.current.deltaY = deltaY;

      const direction = getSwipeDirection(
        deltaX,
        deltaY,
        mergedConfig.cancelThreshold
      );
      state.current.currentDirection = direction;

      mergedConfig.callbacks?.onDrag?.(deltaX, deltaY);
    },
    [elementRef, mergedConfig]
  );

  const handleTouchEnd = useCallback(() => {
    if (!state.current.isDragging) return;

    const { deltaX, deltaY, startX, startY } = state.current;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const duration = Date.now() - (handleTouchMove.startTime || Date.now());
    const velocity = distance / (duration || 1);

    if (distance >= mergedConfig.threshold && velocity >= mergedConfig.minVelocity) {
      const direction = getSwipeDirection(
        deltaX,
        deltaY,
        mergedConfig.cancelThreshold
      );
      if (direction) {
        mergedConfig.callbacks?.onSwipe?.(direction);
        mergedConfig.callbacks?.onSwipeEnd?.(direction);
      }
    }

    state.current.isDragging = false;
    state.current.deltaX = 0;
    state.current.deltaY = 0;
    state.current.currentDirection = null;
  }, [elementRef, mergedConfig]);

  // Store start time for velocity calculation
  const originalHandleTouchStart = handleTouchStart;
  const wrappedHandleTouchStart = useCallback(
    (e: TouchEvent) => {
      (handleTouchMove as any).startTime = Date.now();
      originalHandleTouchStart(e);
    },
    [originalHandleTouchStart, handleTouchMove]
  );

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    element.addEventListener("touchstart", wrappedHandleTouchStart, {
      passive: true,
    });
    element.addEventListener("touchmove", handleTouchMove, { passive: true });
    element.addEventListener("touchend", handleTouchEnd);
    element.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      element.removeEventListener("touchstart", wrappedHandleTouchStart);
      element.removeEventListener("touchmove", handleTouchMove);
      element.removeEventListener("touchend", handleTouchEnd);
      element.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [
    elementRef,
    wrappedHandleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  ]);

  return {
    state: state.current,
    reset: () => {
      state.current = {
        isDragging: false,
        startX: 0,
        startY: 0,
        deltaX: 0,
        deltaY: 0,
        currentDirection: null,
      };
    },
  };
}
