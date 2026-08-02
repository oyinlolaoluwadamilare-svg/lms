# 02 — Permission Matrix

## Why this file exists

The predecessor product shipped an engagement logger that was invisible to the BDE role — the only
role that needed it. Every test passed, because the tests asserted what roles *could* do and never
what they *could not*. The feature was roughly seventy per cent built and nobody noticed for months,
which is why every notes panel in that product read "no notes captured yet".

This file is the antidote. It is the **single source of truth** for authorisation and must be
implemented as data, not as scattered conditionals.

## Implementation requirements

1. Implement as a typed structure in `src/auth/permissions.ts` derived directly from this table.
2. Every server action and every route handler calls `can(user, action, resource)`. No ad-hoc checks.
3. RLS policies enforce the same rules at the database level, independently.
4. `tests/permissions/matrix.spec.ts` iterates **every role and every action** and asserts both
   allow and deny. The suite **fails if any role-action pair is untested.**
5. UI visibility derives from the same `can()` function. A component never hard-codes a role name.

## Roles

| Role | Scope | Write? |
|---|---|---|
| `tenant_admin` | Whole tenant | Yes, plus configuration |
| `executive` | Whole tenant | **Never. Read-only, enforced in RLS.** |
| `director` | One or more practice lines | Yes, within practice |
| `team_lead` | One practice line | Yes, within practice |
| `bde` | One practice line, own deals | Yes, own records |

**Scope tokens:** `own` = user is owner, co-owner or author · `practice` = any record in an
entitled practice line · `tenant` = anything in the tenant · `—` = denied.

## Matrix

### Deals
| Action | bde | team_lead | director | executive | tenant_admin |
|---|---|---|---|---|---|
| deal.view | practice¹ | practice | practice | tenant | tenant |
| deal.create | practice | practice | practice | — | tenant |
| deal.update | own | practice | practice | — | tenant |
| deal.change_stage | own | practice | practice | — | tenant |
| deal.change_owner | — | practice | practice | — | tenant |
| deal.add_co_owner | own | practice | practice | — | tenant |
| deal.mark_won | own | practice | practice | — | tenant |
| deal.mark_lost | own | practice | practice | — | tenant |
| deal.escalate | own | practice | practice | — | tenant |
| deal.override_forecast_category | own | practice | practice | — | tenant |
| deal.override_stage_gate | — | — | practice | — | tenant |
| deal.soft_delete | — | — | practice | — | tenant |
| deal.restore | — | — | — | — | tenant |

¹ Confirmed by decision **D-02** (`docs/DECISIONS.md`): practice-wide read. Write actions on the
same table remain scoped to `own` for a BDE, as shown below.

### Activities — the critical rows
| Action | bde | team_lead | director | executive | tenant_admin |
|---|---|---|---|---|---|
| **activity.create** | **own** | **practice** | **practice** | **—** | **tenant** |
| activity.view | practice | practice | practice | tenant² | tenant |
| activity.update (own, within 24h) | own | own | own | — | own |
| activity.update (others') | — | — | — | — | — |
| activity.retract | — | — | practice | — | tenant |
| activity.delete | **— (no role, ever)** | — | — | — | — |
| activity.attach_file | own | practice | practice | — | tenant |

² Confirmed by decision **D-06** (`docs/DECISIONS.md`): Executive reads full narratives, not only
aggregates.

**Regression test that must exist:** *"a user holding only the bde role can create an activity on a
deal they own."* This single assertion would have caught the predecessor's most damaging defect.

### Tasks
| Action | bde | team_lead | director | executive | tenant_admin |
|---|---|---|---|---|---|
| task.create | practice | practice | practice | — | tenant |
| task.view | own+assigned+practice | practice | practice | tenant | tenant |
| task.assign_to_self | yes | yes | yes | — | yes |
| task.assign_to_other | practice³ | practice | practice | — | tenant |
| task.reassign | own_assigned | practice | practice | — | tenant |
| task.update | own+assigned | practice | practice | — | tenant |
| task.complete | assigned+own | practice | practice | — | tenant |
| task.cancel | own_created | practice | practice | — | tenant |
| task.comment | visible | visible | visible | — | visible |
| task.mention_user | practice | practice | practice | — | tenant |
| task.watch | visible | visible | visible | — | visible |
| task.add_watcher | practice | practice | practice | — | tenant |
| task.resolve_comment | own+assigned | practice | practice | — | tenant |

³ A BDE may assign to deal co-owners, their team lead, and practice-line peers.

⁴ M4.9 additions, none named in the original matrix (`task_watchers`/`task_comments.resolved_at`
shipped as schema in M4.1 with these three actions explicitly deferred to this milestone). Watchers
are both automatic (a task's assignee and assigner are watchers from creation; reassignment adds the
new assignee; an @mention adds the mentioned user) and manual: `task.watch` is self-add ("watch this
task"), scoped identically to `task.comment` - the same "visible" population, since watching is no
more privileged than viewing. `task.add_watcher` (adding someone ELSE) is scoped identically to
`task.mention_user` - both are "pick another in-scope user" actions, so both use the same picker
population and the same scope shape. `task.resolve_comment` is scoped identically to `task.update` -
resolving feedback on a task is treated as changing the task's own state, not a property of the
comment's original author, so the task's assignee/assigner (or a practice lead) may resolve a
comment even if someone else wrote it. There is still no "remove watcher"/"unwatch" action - not
named by this milestone, the same "not invented here" reasoning migration 0005's
`deal_co_owners_insert` comment already gave for the analogous `deal.remove_co_owner` gap.

### Accounts and contacts
| Action | bde | team_lead | director | executive | tenant_admin |
|---|---|---|---|---|---|
| account.view | practice | practice | practice | tenant | tenant |
| account.create / update | practice | practice | practice | — | tenant |
| account.merge | — | — | — | — | tenant |
| contact.view | practice | practice | practice | tenant | tenant |
| contact.create / update | practice | practice | practice | — | tenant |
| contact.link_to_deal | own | practice | practice | — | tenant |

### Analytics, forecast and quotas
| Action | bde | team_lead | director | executive | tenant_admin |
|---|---|---|---|---|---|
| analytics.view_own | yes | yes | yes | yes | yes |
| analytics.view_team | — | practice | practice | tenant | tenant |
| analytics.view_practice | — | practice | practice | tenant | tenant |
| analytics.view_tenant | — | — | — | tenant | tenant |
| analytics.export | — | practice | practice | tenant | tenant |
| quota.view | own | practice | practice | tenant | tenant |
| quota.set | — | — | practice | — | tenant |
| forecast.commit | own | practice | practice | — | tenant |
| forecast.override_others | — | practice | practice | — | tenant |

### Files and documents
| Action | bde | team_lead | director | executive | tenant_admin |
|---|---|---|---|---|---|
| document.view | practice | practice | practice | tenant | tenant |
| document.upload | practice | practice | practice | — | tenant |
| document.new_version | uploader+own_deal | practice | practice | — | tenant |
| document.soft_delete | uploader | practice | practice | — | tenant |

### Administration
| Action | bde | team_lead | director | executive | tenant_admin |
|---|---|---|---|---|---|
| admin.view_panel | — | — | — | — | tenant |
| admin.manage_stages | — | — | — | — | tenant |
| admin.manage_practice_lines | — | — | — | — | tenant |
| admin.manage_custom_fields | — | — | — | — | tenant |
| admin.manage_outcome_reasons | — | — | — | — | tenant |
| admin.manage_automation_rules | — | — | — | — | tenant |
| admin.invite_user | — | practice⁴ | practice | — | tenant |
| admin.assign_role | — | — | — | — | tenant |
| admin.suspend_user | — | — | — | — | tenant |
| admin.view_audit_log | — | — | practice | tenant (read) | tenant |
| admin.run_backup / export | — | — | — | — | tenant |
| admin.request_restore | — | — | — | — | tenant |
| admin.purge (hard delete) | **— (platform super admin only, out of band)** | — | — | — | — |

⁴ Only when the tenant-level "Team Lead practice invites" setting is enabled, and only for the `bde`
role within the lead's own practice line, and only within the seat cap.

### Integrations
| Action | bde | team_lead | director | executive | tenant_admin |
|---|---|---|---|---|---|
| integration.connect_own_mailbox | yes (self only) | yes | yes | — | yes |
| integration.connect_for_other_user | **— (no role, ever)** | — | — | — | — |
| integration.manage_api_keys | — | — | — | — | tenant |

## Hard rules that override any table row

1. `executive` has **no write capability anywhere**, enforced by RLS policies granting select only.
2. No role may hard delete any record through the application.
3. No role may edit another user's activity entry.
4. No role may connect another user's mailbox; OAuth is always initiated by the mailbox owner.
5. No role may mutate an audit entry.
6. Cross-tenant access is impossible for every role, including `tenant_admin`.
7. A suspended or inactive user is denied everything regardless of role rows.

## Required test shape

```ts
// tests/permissions/matrix.spec.ts
const ROLES = ['bde','team_lead','director','executive','tenant_admin'] as const;
const ACTIONS = [/* every action string in this document */] as const;

describe('permission matrix completeness', () => {
  it('covers every role-action pair', () => {
    for (const role of ROLES)
      for (const action of ACTIONS)
        expect(MATRIX[role]?.[action], \`untested: \${role}/\${action}\`).toBeDefined();
  });
});

describe('deny cases', () => {
  it('executive cannot write anything', async () => {
    for (const action of ACTIONS.filter(isWrite))
      expect(can(executiveUser, action, anyResource)).toBe(false);
  });
  it('bde CAN create an activity on an owned deal', async () => {
    expect(can(bdmUser, 'activity.create', ownedDeal)).toBe(true); // the regression guard
  });
  it('no role can delete an activity', async () => {
    for (const role of ROLES)
      expect(can(userWith(role), 'activity.delete', anyActivity)).toBe(false);
  });
});
```

## RLS parity requirement

Every rule above must also hold with the application layer bypassed. `tests/rls` connects as each
role's database identity and asserts that cross-tenant reads return zero rows, cross-practice reads
respect entitlement, the executive identity cannot insert, update or delete in any table, and no
identity can update or delete `audit_entries`, `stage_events` or retracted activities.
