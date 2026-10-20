import type { EngineContext } from '../engine/session'

/** The catalog is shipped with the shell. Account mail is loaded only in its own area. */
export async function loadIntegrations(context: EngineContext) { context.assertCurrent(); return {} }
