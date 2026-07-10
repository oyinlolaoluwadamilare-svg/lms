import 'server-only';
import { db } from '@/db';
import { auditLog } from '@/db/schema';
import type { CurrentUser } from './session';

/** Append to the audit trail. Never throws: an audit failure must not block
 *  the action it records, but it is logged loudly. */
export async function writeAudit(
  actor: CurrentUser,
  action: string,
  entity: string,
  entityId: string | null,
  detail?: Record<string, unknown>,
) {
  try {
    await db.insert(auditLog).values({
      actorUserId: actor.userId,
      actorRole: actor.role,
      action,
      entity,
      entityId,
      detail: detail ?? null,
    });
  } catch (err) {
    console.error('Audit write failed', { action, entity, entityId }, err);
  }
}
