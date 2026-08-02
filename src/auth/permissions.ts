import type { Role, RoleGrant } from "@/domain/role";
import type { UserStatus } from "@/domain/user";

// docs/02-permission-matrix.md is the single source of truth this file implements. Every action
// string in that document appears in ACTIONS below - typed as a literal union, so removing or
// misspelling one is a compile error in the MATRIX definitions further down (each role's action
// map is annotated as Record<Action, PermissionEntry>, which requires every key to be present).
export const ACTIONS = [
  // Deals
  "deal.view",
  "deal.create",
  "deal.update",
  "deal.change_stage",
  "deal.change_owner",
  "deal.add_co_owner",
  "deal.mark_won",
  "deal.mark_lost",
  "deal.escalate",
  "deal.override_forecast_category",
  "deal.override_stage_gate",
  "deal.soft_delete",
  "deal.restore",
  // Activities - the critical rows (docs/02-permission-matrix.md's own heading)
  "activity.create",
  "activity.view",
  "activity.update",
  "activity.retract",
  "activity.delete",
  "activity.attach_file",
  // Tasks
  "task.create",
  "task.view",
  "task.assign_to_self",
  "task.assign_to_other",
  "task.reassign",
  "task.update",
  "task.complete",
  "task.cancel",
  "task.comment",
  "task.mention_user",
  "task.watch",
  "task.add_watcher",
  "task.resolve_comment",
  // Accounts and contacts
  "account.view",
  "account.create",
  "account.update",
  "account.merge",
  "contact.view",
  "contact.create",
  "contact.update",
  "contact.link_to_deal",
  // Analytics, forecast and quotas
  "analytics.view_own",
  "analytics.view_team",
  "analytics.view_practice",
  "analytics.view_tenant",
  "analytics.export",
  "quota.view",
  "quota.set",
  "forecast.commit",
  "forecast.override_others",
  // Files and documents
  "document.view",
  "document.upload",
  "document.new_version",
  "document.soft_delete",
  // Administration
  "admin.view_panel",
  "admin.manage_stages",
  "admin.manage_practice_lines",
  "admin.manage_custom_fields",
  "admin.manage_outcome_reasons",
  "admin.manage_automation_rules",
  "admin.invite_user",
  "admin.assign_role",
  "admin.suspend_user",
  "admin.view_audit_log",
  "admin.run_backup",
  "admin.export",
  "admin.request_restore",
  "admin.purge",
  // Integrations
  "integration.connect_own_mailbox",
  "integration.connect_for_other_user",
  "integration.manage_api_keys",
] as const;

export type Action = (typeof ACTIONS)[number];

// Beyond the four formally-defined scope tokens (own/practice/tenant/denied), the Tasks and
// Documents rows use extra shorthand the document's own "Scope tokens" legend never defines
// (own+assigned, own_assigned, own_created, uploader, uploader+own_deal, self only, visible).
// Tasks have no owner/co-owner/author field at all (docs/01-domain-model.md: assignee_id,
// assigned_by) - "own" in those rows evidently means "assigned_by = you", distinct from
// "assigned" ("assignee_id = you"). This mapping is an interpretation of that shorthand, not
// something the source document states explicitly - flagged here and in the M0.4 summary rather
// than silently assumed. "own+assigned" style compounds became arrays (OR semantics); "visible"
// was expanded to the literal set of tokens that action's own view-row grants for that role,
// rather than adding a token that means "look up a different permission."
export type ScopeToken =
  | "own" // owner, co-owner or author (docs/02-permission-matrix.md's own definition)
  | "practice" // any record in an entitled practice line
  | "tenant" // anything in the tenant
  | "assigned" // task assignee_id = actor
  | "assigned_by" // task assigned_by = actor (task.model calls this "own_created"/"own_assigned")
  | "uploader" // document uploaded_by = actor
  | "self"; // the record's own subject is the actor (own mailbox, own analytics slice)

// null = "-" (denied) in the source document. A cell is never *absent* - every role has an entry
// for every action, even if that entry is null - so the completeness test can distinguish "denied"
// (defined, null) from "forgotten" (undefined).
export type PermissionEntry = readonly ScopeToken[] | null;

export interface Actor {
  id: string;
  tenantId: string;
  status: UserStatus;
  // A user may hold multiple role rows; effective permission is the union (docs/01-domain-model.md
  // user_roles invariant).
  roleGrants: readonly RoleGrant[];
}

// Deliberately generic and not tied to a concrete Deal/Task/Document domain type - those don't
// exist yet (M1+). Callers shape this from whatever entity they're checking; unused fields are
// simply omitted and their tokens will not match.
export interface Resource {
  tenantId: string;
  practiceLineId?: string;
  ownerId?: string;
  coOwnerIds?: readonly string[];
  authorId?: string;
  assigneeId?: string;
  assignedById?: string;
  uploaderId?: string;
  userId?: string;
}

const DEAL: Record<Action, PermissionEntry> = {
  "deal.view": ["practice"],
  "deal.create": ["practice"],
  "deal.update": ["own"],
  "deal.change_stage": ["own"],
  "deal.change_owner": null,
  "deal.add_co_owner": ["own"],
  "deal.mark_won": ["own"],
  "deal.mark_lost": ["own"],
  "deal.escalate": ["own"],
  "deal.override_forecast_category": ["own"],
  "deal.override_stage_gate": null,
  "deal.soft_delete": null,
  "deal.restore": null,
  "activity.create": ["own"],
  "activity.view": ["practice"],
  "activity.update": ["own"],
  "activity.retract": null,
  "activity.delete": null,
  "activity.attach_file": ["own"],
  "task.create": ["practice"],
  "task.view": ["assigned_by", "assigned", "practice"],
  "task.assign_to_self": ["assigned"],
  "task.assign_to_other": ["practice"], // footnote 3: co-owners, own team lead, practice peers
  "task.reassign": ["assigned"],
  "task.update": ["assigned_by", "assigned"],
  "task.complete": ["assigned", "assigned_by"],
  "task.cancel": ["assigned_by"],
  "task.comment": ["assigned_by", "assigned", "practice"], // "visible" = same set as task.view
  "task.mention_user": ["practice"],
  "task.watch": ["assigned_by", "assigned", "practice"], // "visible" = same set as task.comment
  "task.add_watcher": ["practice"], // same shape as task.mention_user - both "pick another in-scope user"
  "task.resolve_comment": ["assigned_by", "assigned"], // same shape as task.update
  "account.view": ["practice"],
  "account.create": ["practice"],
  "account.update": ["practice"],
  "account.merge": null,
  "contact.view": ["practice"],
  "contact.create": ["practice"],
  "contact.update": ["practice"],
  "contact.link_to_deal": ["own"],
  "analytics.view_own": ["self"],
  "analytics.view_team": null,
  "analytics.view_practice": null,
  "analytics.view_tenant": null,
  "analytics.export": null,
  "quota.view": ["own"],
  "quota.set": null,
  "forecast.commit": ["own"],
  "forecast.override_others": null,
  "document.view": ["practice"],
  "document.upload": ["practice"],
  "document.new_version": ["uploader", "own"], // "uploader+own_deal"
  "document.soft_delete": ["uploader"],
  "admin.view_panel": null,
  "admin.manage_stages": null,
  "admin.manage_practice_lines": null,
  "admin.manage_custom_fields": null,
  "admin.manage_outcome_reasons": null,
  "admin.manage_automation_rules": null,
  "admin.invite_user": null,
  "admin.assign_role": null,
  "admin.suspend_user": null,
  "admin.view_audit_log": null,
  "admin.run_backup": null,
  "admin.export": null,
  "admin.request_restore": null,
  "admin.purge": null,
  "integration.connect_own_mailbox": ["self"],
  "integration.connect_for_other_user": null,
  "integration.manage_api_keys": null,
};

const TEAM_LEAD: Record<Action, PermissionEntry> = {
  ...DEAL,
  "deal.view": ["practice"],
  "deal.create": ["practice"],
  "deal.update": ["practice"],
  "deal.change_stage": ["practice"],
  "deal.change_owner": ["practice"],
  "deal.add_co_owner": ["practice"],
  "deal.mark_won": ["practice"],
  "deal.mark_lost": ["practice"],
  "deal.escalate": ["practice"],
  "deal.override_forecast_category": ["practice"],
  "deal.override_stage_gate": null,
  "deal.soft_delete": null,
  "deal.restore": null,
  "activity.create": ["practice"],
  "activity.update": ["own"],
  "activity.retract": null,
  "activity.attach_file": ["practice"],
  "task.create": ["practice"],
  "task.view": ["practice"],
  "task.assign_to_self": ["assigned"],
  "task.assign_to_other": ["practice"],
  "task.reassign": ["practice"],
  "task.update": ["practice"],
  "task.complete": ["practice"],
  "task.cancel": ["practice"],
  "task.comment": ["practice"],
  "task.mention_user": ["practice"],
  "task.watch": ["practice"],
  "task.add_watcher": ["practice"],
  "task.resolve_comment": ["practice"],
  "account.create": ["practice"],
  "account.update": ["practice"],
  "contact.create": ["practice"],
  "contact.update": ["practice"],
  "contact.link_to_deal": ["practice"],
  "analytics.view_team": ["practice"],
  "analytics.view_practice": ["practice"],
  "analytics.export": ["practice"],
  "quota.view": ["practice"],
  "quota.set": null,
  "forecast.commit": ["practice"],
  "forecast.override_others": ["practice"],
  "document.upload": ["practice"],
  "document.new_version": ["practice"],
  "document.soft_delete": ["practice"],
  // Footnote 4: only when the tenant's "Team Lead practice invites" setting is enabled, only
  // within the lead's own practice, only within seat cap - can() alone cannot evaluate a tenant
  // config toggle or a seat count, so this "practice" grant is necessary but not sufficient. The
  // RLS layer (db/migrations/0003_rls_foundation.up.sql, users_insert policy) is tenant_admin-only
  // for now precisely because that toggle isn't modelled yet; a caller must not treat can()===true
  // here as license to skip checking the toggle once it exists.
  "admin.invite_user": ["practice"],
};

const DIRECTOR: Record<Action, PermissionEntry> = {
  ...TEAM_LEAD,
  "deal.override_stage_gate": ["practice"],
  "deal.soft_delete": ["practice"],
  "activity.retract": ["practice"],
  "quota.set": ["practice"],
  "admin.invite_user": ["practice"],
  "admin.view_audit_log": ["practice"],
};

const EXECUTIVE: Record<Action, PermissionEntry> = {
  "deal.view": ["tenant"],
  "deal.create": null,
  "deal.update": null,
  "deal.change_stage": null,
  "deal.change_owner": null,
  "deal.add_co_owner": null,
  "deal.mark_won": null,
  "deal.mark_lost": null,
  "deal.escalate": null,
  "deal.override_forecast_category": null,
  "deal.override_stage_gate": null,
  "deal.soft_delete": null,
  "deal.restore": null,
  "activity.create": null,
  "activity.view": ["tenant"], // D-06: full narratives, not only aggregates
  "activity.update": null,
  "activity.retract": null,
  "activity.delete": null,
  "activity.attach_file": null,
  "task.create": null,
  "task.view": ["tenant"],
  "task.assign_to_self": null,
  "task.assign_to_other": null,
  "task.reassign": null,
  "task.update": null,
  "task.complete": null,
  "task.cancel": null,
  "task.comment": null,
  "task.mention_user": null,
  "task.watch": null,
  "task.add_watcher": null,
  "task.resolve_comment": null,
  "account.view": ["tenant"],
  "account.create": null,
  "account.update": null,
  "account.merge": null,
  "contact.view": ["tenant"],
  "contact.create": null,
  "contact.update": null,
  "contact.link_to_deal": null,
  "analytics.view_own": ["self"],
  "analytics.view_team": ["tenant"],
  "analytics.view_practice": ["tenant"],
  "analytics.view_tenant": ["tenant"],
  "analytics.export": ["tenant"],
  "quota.view": ["tenant"],
  "quota.set": null,
  "forecast.commit": null,
  "forecast.override_others": null,
  "document.view": ["tenant"],
  "document.upload": null,
  "document.new_version": null,
  "document.soft_delete": null,
  "admin.view_panel": null,
  "admin.manage_stages": null,
  "admin.manage_practice_lines": null,
  "admin.manage_custom_fields": null,
  "admin.manage_outcome_reasons": null,
  "admin.manage_automation_rules": null,
  "admin.invite_user": null,
  "admin.assign_role": null,
  "admin.suspend_user": null,
  "admin.view_audit_log": ["tenant"], // read-only, matches "tenant (read)"
  "admin.run_backup": null,
  "admin.export": null,
  "admin.request_restore": null,
  "admin.purge": null,
  "integration.connect_own_mailbox": null,
  "integration.connect_for_other_user": null,
  "integration.manage_api_keys": null,
};

const TENANT_ADMIN: Record<Action, PermissionEntry> = {
  "deal.view": ["tenant"],
  "deal.create": ["tenant"],
  "deal.update": ["tenant"],
  "deal.change_stage": ["tenant"],
  "deal.change_owner": ["tenant"],
  "deal.add_co_owner": ["tenant"],
  "deal.mark_won": ["tenant"],
  "deal.mark_lost": ["tenant"],
  "deal.escalate": ["tenant"],
  "deal.override_forecast_category": ["tenant"],
  "deal.override_stage_gate": ["tenant"],
  "deal.soft_delete": ["tenant"],
  "deal.restore": ["tenant"],
  "activity.create": ["tenant"],
  "activity.view": ["tenant"],
  "activity.update": ["own"], // even tenant_admin may only edit their own, within the window
  "activity.retract": ["tenant"],
  "activity.delete": null, // no role, ever - CLAUDE.md #3, never a hard delete
  "activity.attach_file": ["tenant"],
  "task.create": ["tenant"],
  "task.view": ["tenant"],
  "task.assign_to_self": ["assigned"],
  "task.assign_to_other": ["tenant"],
  "task.reassign": ["tenant"],
  "task.update": ["tenant"],
  "task.complete": ["tenant"],
  "task.cancel": ["tenant"],
  "task.comment": ["tenant"],
  "task.mention_user": ["tenant"],
  "task.watch": ["tenant"],
  "task.add_watcher": ["tenant"],
  "task.resolve_comment": ["tenant"],
  "account.view": ["tenant"],
  "account.create": ["tenant"],
  "account.update": ["tenant"],
  "account.merge": ["tenant"],
  "contact.view": ["tenant"],
  "contact.create": ["tenant"],
  "contact.update": ["tenant"],
  "contact.link_to_deal": ["tenant"],
  "analytics.view_own": ["self"],
  "analytics.view_team": ["tenant"],
  "analytics.view_practice": ["tenant"],
  "analytics.view_tenant": ["tenant"],
  "analytics.export": ["tenant"],
  "quota.view": ["tenant"],
  "quota.set": ["tenant"],
  "forecast.commit": ["tenant"],
  "forecast.override_others": ["tenant"],
  "document.view": ["tenant"],
  "document.upload": ["tenant"],
  "document.new_version": ["tenant"],
  "document.soft_delete": ["tenant"],
  "admin.view_panel": ["tenant"],
  "admin.manage_stages": ["tenant"],
  "admin.manage_practice_lines": ["tenant"],
  "admin.manage_custom_fields": ["tenant"],
  "admin.manage_outcome_reasons": ["tenant"],
  "admin.manage_automation_rules": ["tenant"],
  "admin.invite_user": ["tenant"],
  "admin.assign_role": ["tenant"],
  "admin.suspend_user": ["tenant"],
  "admin.view_audit_log": ["tenant"],
  "admin.run_backup": ["tenant"],
  "admin.export": ["tenant"],
  "admin.request_restore": ["tenant"],
  "admin.purge": null, // platform super admin only, out of band - not even tenant_admin
  "integration.connect_own_mailbox": ["self"],
  "integration.connect_for_other_user": null,
  "integration.manage_api_keys": ["tenant"],
};

export const MATRIX: Record<Role, Record<Action, PermissionEntry>> = {
  bde: DEAL,
  team_lead: TEAM_LEAD,
  director: DIRECTOR,
  executive: EXECUTIVE,
  tenant_admin: TENANT_ADMIN,
};

function tokenMatches(token: ScopeToken, actorId: string, grant: RoleGrant, resource?: Resource): boolean {
  if (!resource) return true; // no specific record to check - "can this role act in principle"
  switch (token) {
    case "tenant":
      return true; // tenant match already enforced by the caller before reaching here
    case "practice":
      return grant.practiceLineId !== null && resource.practiceLineId === grant.practiceLineId;
    case "own":
      return (
        resource.ownerId === actorId ||
        resource.authorId === actorId ||
        (resource.coOwnerIds?.includes(actorId) ?? false)
      );
    case "assigned":
      return resource.assigneeId === actorId;
    case "assigned_by":
      return resource.assignedById === actorId;
    case "uploader":
      return resource.uploaderId === actorId;
    case "self":
      return resource.userId === actorId || resource.assigneeId === actorId;
  }
}

// The single path for every authorisation check (docs/02-permission-matrix.md implementation
// requirement #2: "No ad-hoc checks"). RLS enforces the same rules independently at the database
// level (requirement #3) - this function is not the only control, and must never become one.
export function can(actor: Actor, action: Action, resource?: Resource): boolean {
  // Hard rule 7: a suspended or inactive user is denied everything, regardless of role rows.
  if (actor.status !== "active") return false;

  // Hard rule 6: cross-tenant access is impossible for every role, including tenant_admin.
  if (resource && resource.tenantId !== actor.tenantId) return false;

  for (const grant of actor.roleGrants) {
    const entry = MATRIX[grant.role][action];
    if (!entry) continue;
    if (entry.some((token) => tokenMatches(token, actor.id, grant, resource))) return true;
  }

  return false;
}
