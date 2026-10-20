import { z } from 'zod';

export const roleSchema = z.enum(['owner', 'admin', 'editor', 'builder', 'member', 'viewer']);
export type Role = z.infer<typeof roleSchema>;
export const permissions = [
  'agents:read', 'agents:write', 'knowledge:read', 'knowledge:write',
  'phones:read', 'phones:write', 'channels:read', 'channels:write',
  'conversations:read', 'conversations:write', 'recordings:manage',
  'contacts:read', 'contacts:write', 'contacts:delete', 'contacts:bulk', 'contacts:settings', 'contacts:consent',
  'calendars:read', 'calendars:write', 'appointments:read', 'appointments:write',
  'api_keys:manage', 'integrations:manage', 'integrations:execute', 'organization:read', 'organization:write',
  'billing:manage', 'team:read', 'team:manage', 'owners:manage',
  'campaigns:read', 'campaigns:write', 'referrals:read', 'referrals:write',
] as const;
export type Permission = typeof permissions[number];

const view: Permission[] = ['agents:read', 'knowledge:read', 'phones:read', 'conversations:read', 'organization:read'];
const grants: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set<Permission>(permissions),
  admin: new Set<Permission>(permissions.filter(permission => permission !== 'owners:manage')),
  editor: new Set<Permission>([...view, 'agents:write', 'knowledge:write', 'channels:read', 'channels:write', 'phones:write', 'recordings:manage', 'api_keys:manage']),
  builder: new Set<Permission>([...view, 'agents:write', 'knowledge:write']),
  member: new Set<Permission>([...view, 'channels:read', 'contacts:read', 'contacts:write', 'calendars:read', 'appointments:read', 'appointments:write', 'conversations:write', 'team:read', 'integrations:execute']),
  viewer: new Set<Permission>(view),
};

/** These are organization capabilities, never authority to change host credentials. */
export function hasPermission(role: string, permission: string): boolean {
  const parsed = roleSchema.safeParse(role);
  return parsed.success && grants[parsed.data].has(permission as Permission);
}

export function capabilitiesFor(role: Role): Permission[] {
  return permissions.filter(permission => hasPermission(role, permission));
}

export function canManageRole(actorRole: Role, targetRole: Role, nextRole?: Role): boolean {
  if (actorRole === 'owner') return true;
  return actorRole === 'admin' && !['owner', 'admin'].includes(targetRole) && (!nextRole || !['owner', 'admin'].includes(nextRole));
}
