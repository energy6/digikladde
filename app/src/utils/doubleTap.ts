import type { PointerEvent } from 'react';

const DOUBLE_TAP_MS = 350;

export const isInteractiveTarget = (target: EventTarget | null): boolean => (
  target instanceof Element
  && Boolean(target.closest('button, a, input, textarea, select, [role="button"], .ant-checkbox-wrapper'))
);

export const isDoubleTap = (
  event: PointerEvent,
  lastTapRef: { current: number },
): boolean => {
  if (event.pointerType === 'mouse' || isInteractiveTarget(event.target)) {
    return false;
  }

  const now = Date.now();
  const isDouble = now - lastTapRef.current <= DOUBLE_TAP_MS;
  lastTapRef.current = now;

  return isDouble;
};
