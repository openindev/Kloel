import type { Entity } from './store.js';

/** An uncertain remote move owns both intervals until its outcome is confirmed. */
export function appointmentBlocks(item: Entity, start: number, end: number, buffer = 0): boolean {
  const blocks = (interval: Record<string, unknown>) => {
    const rawStart = Date.parse(String(interval.startAt)), rawEnd = Date.parse(String(interval.endAt));
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) return false;
    const storedStart = Date.parse(String(interval.bufferStartAt)), storedEnd = Date.parse(String(interval.bufferEndAt));
    const blockedStart = Number.isFinite(storedStart) ? Math.min(rawStart, storedStart) : rawStart;
    const blockedEnd = Number.isFinite(storedEnd) ? Math.max(rawEnd, storedEnd) : rawEnd;
    return start < blockedEnd + buffer && end + buffer > blockedStart;
  };
  if (blocks(item)) return true;
  const previous = item.previousSyncInterval;
  return ['pending', 'pending_reconciliation'].includes(String(item.syncStatus)) && !!previous && typeof previous === 'object' && !Array.isArray(previous) && blocks(previous as Record<string, unknown>);
}
