# 06 — Interface Specification

## Design tokens

Inherit the predecessor's visual language so existing users are not retrained.

```
--ink        #1b1917    text
--muted      #6b6560    secondary text
--line       #e5e1dc    borders
--surface    #fffefb    page
--raised     #f6f3ef    cards, table headers
--accent     #7A77CF    primary interactive
--won        #0F766E
--risk       #B45309
--lost       #9F1239
Stage age:   green ≤7d · blue 8–21d · amber 22–45d · red 46d+
Radius 9–14px · Type: system sans · Base 16px, tables 13.5px
```

## Navigation, per role

| Role | Primary nav |
|---|---|
| BDM | My Work · Business Lines · Pipeline Deals · Accounts · Files · Analytics |
| Team Lead | My Work · Team · Pipeline Deals · Accounts · Files · Analytics |
| Director | Dashboard · Pipeline Deals · Accounts · Reviews · Analytics · Files |
| Executive | Dashboard · Analytics · Pipeline (read) |
| Tenant Admin | Dashboard · All Deals · Accounts · Analytics · Admin |

**My Work is the default landing screen for BDM and Team Lead.** Landing on a task list rather than a
record list is the strongest single nudge toward the behaviour this product is trying to create.

## Screen: Deal detail

The most important screen in the product. Layout, top to bottom, left column:

**Header** — deal name, reference, stage chip, account link, and a **next-action strip** showing the
next task and its due date, or a prominent amber "No next step — add one" call to action. A
last-engaged chip reads "Last engaged 12 days ago" in the staleness colour, or "Never engaged" in red.

**Primary actions, visible to every writing role including BDM** — Log Activity, Add Task, Edit Deal,
Advance Stage, and under a menu: Mark Won, Mark Lost, Escalate, Add Contact.

**Engagement timeline** — the centre of gravity of the page, not a footnote. Newest first, merging
activities and stage events into one stream. Each entry shows type icon, engagement date, author,
summary, outcome with disposition, attributed contacts, and an "edited" marker with revision history
where applicable. Retracted entries appear struck through with the reason, never removed. Filter by
type and author. An empty state reads "No engagement logged yet — log the first conversation", with
the button inline.

**Stakeholders** — contact cards with decision-role badges, primary flag, and each contact's own
last-engaged value. If fewer than two contacts and the deal is past Discovery, show a single-threading
warning.

**Open tasks** — inline list with assignee avatar, due date, priority, and inline complete.

Right column: financial summary with proposal, negotiated, probability, weighted forecast and forecast
category; deal details with owner, co-owners, author, practice, dates and status; custom fields;
documents; and the review thread.

## Log Activity modal — the three-interaction constraint

Reachable by one click from the deal page, and by keyboard shortcut. Fields in order: **Type**
(segmented control, not a dropdown — types are few and clicking is faster), **Activity date**
(defaults today, future dates rejected inline with "future intent is a task, not an engagement"),
**Summary** (autofocused, the only mandatory text), then collapsed-by-default optional fields:
outcome, disposition, contacts present, attachments. Primary button "Save activity"; secondary "Save
and add task", which carries the context forward. Ctrl+Enter saves.

Path to a saved activity: open modal, type summary, save. Three interactions. **This is a hard
constraint — any design that exceeds it is rejected.**

## Add Task modal

Title autofocused, assignee defaulting to self with a scope-filtered picker showing avatar, name and
role, due date with quick options (today, tomorrow, next week, custom), priority defaulting to normal,
optional description and linked deal. Assigning to someone else surfaces "They will be notified" so
the user knows delegation is real.

## Screen: My Work

Grouped as Overdue (red, collapsed only if empty), Due today, This week, Later, and No date. Each row:
priority indicator, title, deal and client, assignee if not self, due date. Inline actions: complete,
snooze with reason after two snoozes, reassign, open deal. Tabs: **Assigned to me** and **Assigned by
me** — the second is what makes delegation trackable. Leaders see a third **Team** tab with per-person
open, overdue and completed counts.

Empty state: "Nothing due. Deals without a next step" plus a count and a link — turning an empty queue
into the next useful action.

## Screen: Pipeline

Board and table, as today. Additions to both: a last-engaged column and sort in the table, staleness
colour on the board card's left edge, a next-action due date on the card, and a stakeholder count
badge. Advanced filters gain "days since last engagement", "has no next step", "assigned to me",
"stage regression" and "forecast category". Filters are savable as named views.

Board drag calls the single `changeStage` service path and optimistically updates, rolling back
visibly on failure.

## Screen: Account 360

Header with account, industry, region, parent group, owner. Tiles: open pipeline, won revenue,
active deals, last engagement across the account. Tabs: Deals (across practice lines, respecting
entitlement), Contacts with decision roles, Merged timeline, Documents.

## Screen: Analytics

Every panel carries: period label, comparison basis, sample size, and a footnote on exclusions.
Panels showing insufficient data say so explicitly. New panels: engagement coverage, activity volume
by type paired with conversion, logging latency, next-action coverage, time in stage with median
headline, cohort conversion funnel, stage regression, forecast accuracy, attainment and pace.

## Screen: Admin

Tabs mirroring the predecessor so admins are not retrained: Pipeline Stages, Practice Lines, Custom
Fields, Roles & Permissions, Outcome Reasons, Automation Rules, Audit Log, Data & Backup. The stage
editor warns that renaming preserves history while reordering affects reporting.

## Cross-cutting states

Every list defines loading (skeleton matching final layout, never a spinner alone), empty (explains
the next action), error (states what failed and offers retry), and permission-denied (explains that
access is limited by role, never a blank screen).

## Responsive

Single column below 768px. Deal detail collapses the right column into accordions beneath the
timeline. My Work and Log Activity are fully usable at 375px — these two screens are the mobile
priority, because field logging is where compliance is won or lost.
