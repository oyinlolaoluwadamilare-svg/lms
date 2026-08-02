-- M4.9 (docs/07-build-backlog.md): "Comments, watchers and @mention with an in-scope user picker."
-- Fills the two gaps migration 0011 deliberately left open, each named explicitly in its own header
-- comment as this milestone's job: task_watchers had no INSERT policy at all (no "add watcher"
-- action existed in the permission matrix), and task_comments had no UPDATE policy for
-- resolved_at/resolved_by (no documented owner for "who may resolve a comment").
--
-- Design decisions made explicitly by user choice rather than guessed, matching
-- docs/02-permission-matrix.md's own new footnote 4:
-- - Watchers are BOTH automatic (a task's assignee and assigner become watchers from creation;
--   reassignment adds the new assignee; an @mention adds the mentioned user - all written by the
--   application service layer, through the caller's own session) AND manual (task.watch - self-add;
--   task.add_watcher - add someone else, re-validated server-side against the same in-scope picker
--   population the assignee/mention pickers already use, the same "you can only pick who the picker
--   offered" discipline createTask's own assignee re-check already established - RLS alone cannot
--   verify a SECOND person's own role, so this policy is deliberately coarse, same as
--   task_comments_insert's own shape).
-- - Comment resolution IS built now (resolved_at/resolved_by), scoped identically to task.update
--   (task.resolve_comment) - resolving feedback is treated as changing the task's own state, not a
--   property of the comment's original author, so the task's assignee/assigner (or a practice lead)
--   may resolve a comment even if someone else wrote it. RLS cannot restrict an UPDATE to specific
--   COLUMNS (resolved_at/resolved_by only, never body/author_id) - that precision is the SERVICE
--   layer's job (src/services/taskComments.ts's resolveTaskComment only ever sets those two
--   columns), the same "RLS is coarse, the service is precise" split this codebase already
--   established for notifications_mark_read and tasks_update.
-- - There is still no "remove watcher"/"unwatch" action - not named by this milestone, the same
--   "not invented here" reasoning migration 0005's deal_co_owners_insert comment already gave for
--   the analogous deal.remove_co_owner gap.

create policy task_watchers_insert on task_watchers for insert with check (
  can_write() and added_by = auth.uid() and task_tenant_id(task_id) = current_tenant_id() and (
    has_role('tenant_admin') or has_role('executive')
    or task_assignee_id(task_id) = auth.uid() or task_assigned_by(task_id) = auth.uid()
    or (task_deal_id(task_id) is not null and deal_practice_line_id(task_deal_id(task_id)) in (select entitled_practices()))
  )
);

-- Scoped identically to tasks_update (task.resolve_comment's own shape: assigned_by/assigned for
-- bde, practice for team_lead/director, tenant for tenant_admin, denied for executive) - narrower
-- than task_comments_select/_insert's own visibility-only shape, which still includes executive.
create policy task_comments_resolve on task_comments for update using (
  task_tenant_id(task_id) = current_tenant_id() and can_write() and (
    has_role('tenant_admin') or task_assignee_id(task_id) = auth.uid() or task_assigned_by(task_id) = auth.uid()
    or ((has_role('director') or has_role('team_lead'))
        and task_deal_id(task_id) is not null and deal_practice_line_id(task_deal_id(task_id)) in (select entitled_practices()))
  )
);
