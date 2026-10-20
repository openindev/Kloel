import type { Store } from '../store.js';

// Process state is deliberately separate from a persisted authorization grant.
const schedulers = new WeakMap<Store, Set<object>>();
export function setAutomationScheduler(store: Store, worker: object, running: boolean) {
  const active = schedulers.get(store) ?? new Set<object>();
  if (running) active.add(worker); else active.delete(worker);
  if (active.size) schedulers.set(store, active); else schedulers.delete(store);
}
export function automationRuntime(store: Store) { return { schedulerRunning: Boolean(schedulers.get(store)?.size) }; }
