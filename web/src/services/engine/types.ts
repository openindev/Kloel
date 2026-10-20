export type EngineRole = 'owner' | 'admin' | 'editor' | 'builder' | 'member' | 'viewer'
export interface ExpectedContext { readonly userId: string; readonly tenantId: string | null; readonly membershipId: string | null; readonly authorityVersion: string }
export interface EngineOrganization {
  id: string; tenantId: string; name: string; status: 'active'; createdAt: string
  membershipId: string; role: EngineRole; joinedAt: string
}
export interface Identity {
  userId: string; email: string; tenantId: string | null; role: EngineRole | null
  permissions: string[]; organizations: EngineOrganization[]; context: ExpectedContext
}
export interface Profile {
  id: string; email: string; firstName: string; lastName: string; language: string
  phone: string | null; revision: number; profileCreatedAt: string | null; updatedAt: string | null
}
export interface BootstrapData {
  identity: Identity; profile: Profile
  settings?: { name: string; timezone: string }
  capabilities?: { role: EngineRole; permissions: string[]; items: unknown[] }
}
export interface SessionState {
  phase: 'loading' | 'anonymous' | 'authenticated' | 'organization_required' | 'error'
  validation: 'ready' | 'checking' | 'error'; validationError?: string
  generation: number; data?: BootstrapData; error?: string
}
