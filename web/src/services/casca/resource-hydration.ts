import type { Agent } from '@/domain/types'
import type { EngineContext } from '../engine/session'
import { hydrateBaserow } from './baserow'
import { hydrateSheets } from './sheets'
import { hydrateHttpResources } from './http-resources'
import { hydrateAirtable } from './airtable'
import { hydrateWebchat } from './webchat'
import { engineSession } from '../engine/session'
import { hydrateBeforeFields } from './before-context';
import { hydrateCommercial } from './commercial'
import { createBaserowService } from '../engine/baserow'
import { createAirtableService } from '../engine/airtable'
import { createIntegrationService } from '../engine/integrations'
import { createAfterHttpService } from '../engine/after-http'

/** Starts a read now and marks its rejection as observed; the awaiting step still receives the original error. */
function early<T>(read: () => Promise<T>): Promise<T> { const promise = read(); promise.catch(() => undefined); return promise }

export async function hydrateAgentResources(context: EngineContext, agents: Agent[], userId: string) {
  // The organization-wide lists are independent GETs: fetch them while the per-agent context loads,
  // then apply every projection in the original order so the merged agent is unchanged.
  const after = createAfterHttpService(context)
  const prefetched = {
    baserow: early(() => createBaserowService(context).list()),
    airtable: early(() => createAirtableService(context).list()),
    http: { actions: early(() => createIntegrationService(context).actions()), after: new Map(agents.map(agent => [agent.id, early(() => after.config(agent.id))])) },
  }
  const before = await hydrateBeforeFields(context, agents, engineSession.can('integrations:manage'))
  const hydrated = await hydrateCommercial(context, await hydrateHttpResources(context, await hydrateSheets(context, await hydrateAirtable(context, await hydrateBaserow(context, before, prefetched.baserow), prefetched.airtable), userId), prefetched.http))
  return engineSession.can('channels:read') ? hydrateWebchat(context, hydrated) : hydrated
}
