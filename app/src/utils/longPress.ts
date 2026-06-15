import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { isInteractiveTarget } from './doubleTap';

const LONG_PRESS_MS = 550;
const MOVE_CANCEL_PX = 10;

type UseLongPressOptions = {
  disabled?: boolean;
  delayMs?: number;
};

export const useLongPress = (
  onLongPress: () => void,
  { disabled = false, delayMs = LONG_PRESS_MS }: UseLongPressOptions = {},
) => {
  const timerRef = useRef<number | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);
  const suppressClickRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    clearTimer();
    pointerIdRef.current = null;
    startPointRef.current = null;
  }, [clearTimer]);

  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback((event: ReactPointerEvent) => {
    if (disabled || !event.isPrimary || isInteractiveTarget(event.target)) return;

    cancel();
    firedRef.current = false;
    pointerIdRef.current = event.pointerId;
    startPointRef.current = { x: event.clientX, y: event.clientY };
    timerRef.current = window.setTimeout(() => {
      firedRef.current = true;
      suppressClickRef.current = true;
      onLongPress();
      cancel();
    }, delayMs);
  }, [cancel, delayMs, disabled, onLongPress]);

  const onPointerMove = useCallback((event: ReactPointerEvent) => {
    if (pointerIdRef.current !== event.pointerId || !startPointRef.current) return;

    const deltaX = event.clientX - startPointRef.current.x;
    const deltaY = event.clientY - startPointRef.current.y;
    if ((deltaX ** 2) + (deltaY ** 2) > MOVE_CANCEL_PX ** 2) {
      cancel();
    }
  }, [cancel]);

  const onPointerUp = useCallback((event: ReactPointerEvent) => {
    if (pointerIdRef.current === event.pointerId) {
      cancel();
    }
  }, [cancel]);

  const onPointerLeave = useCallback(() => {
    cancel();
  }, [cancel]);

  const onPointerCancel = useCallback(() => {
    cancel();
  }, [cancel]);

  const consumeLongPressClick = useCallback(() => {
    const shouldSuppress = suppressClickRef.current;
    suppressClickRef.current = false;
    firedRef.current = false;
    return shouldSuppress;
  }, []);

  const didLongPressFire = useCallback(() => firedRef.current, []);

  return {
    longPressHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerLeave,
      onPointerCancel,
    },
    consumeLongPressClick,
    didLongPressFire,
  };
};
