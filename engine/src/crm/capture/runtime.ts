import type { Store } from '../../store.js';

const enabled = new WeakSet<Store>();
const schedulers = new WeakMap<Store, Set<object>>();
export function enableCapture(store: Store) { enabled.add(store); }
export function captureAvailable(store: Store) { return enabled.has(store); }
export function setCaptureScheduler(store: Store, worker: object, active: boolean) {
  const set = schedulers.get(store) ?? new Set<object>();
  if (active) set.add(worker); else set.delete(worker); schedulers.set(store, set);
}
export const captureSchedulerRunning = (store: Store) => !!schedulers.get(store)?.size;
