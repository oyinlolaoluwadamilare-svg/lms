# 08 — Prompt Playbook for Claude Code

How to actually drive the build. The failure mode to avoid is handing over the whole kit and saying
"build this" — you will get a large, plausible, unreviewable codebase with subtle authorisation holes.

## Ground rules

**One task per session.** Sessions map to backlog task ids. Long sessions accumulate unreviewed
decisions.

**Every session starts by re-reading the constitution.** Context degrades; the guardrails must be
reloaded.

**Review each slice before starting the next.** Especially anything marked ⚑. A permission bug merged
in M1 will be inherited by every later milestone.

**Answer decisions before they block.** Work through `DECISIONS.md` Part A ahead of the milestone that
needs each answer. When Claude Code stops and asks, that is the process working, not a failure.

**Never accept "tests pass" as evidence of correctness for permissions.** Ask to see the deny-case
assertions. The predecessor's tests passed while the feature was unusable.

---

## Session 0 — Orientation

```
Read CLAUDE.md, docs/00-product-brief.md, docs/01-domain-model.md,
docs/02-permission-matrix.md, docs/03-architecture.md, docs/07-build-backlog.md
and docs/DECISIONS.md in full.

Do not write any code yet. Instead:
1. Summarise the product in five sentences, in your own words.
2. List every invariant you must never violate.
3. List the decisions in DECISIONS.md Part A that block milestones M0 and M1, and tell me
   which ones I must answer before you can start.
4. Tell me anything in these documents that is internally inconsistent, technically unwise,
   or likely to cause a data-integrity problem. Be blunt. I would rather hear it now.
5. Propose the concrete file list for task M0.1 only.
```

Point 4 matters. If it returns nothing, push: "Nothing at all? Look again at the derived-field
triggers and the RLS helper functions."

---

## Session 1 — Scaffold (M0.1)

```
Implement M0.1 only: repository scaffold per docs/03-architecture.md.

Requirements:
- Next.js App Router, TypeScript strict with noUncheckedIndexedAccess.
- Tailwind wired to the tokens in docs/06-ui-spec.md. No inline hex anywhere.
- Vitest, Playwright, and empty but wired suites for tests/permissions and tests/rls.
- ESLint rules that FAIL the build if src/domain imports from data, services, app or ui.
- CI running typecheck, lint and all suites.

Do not create any product tables, routes or features. Stop when CI is green on an empty project
and show me the layering lint rule failing on a deliberate violation.
```

The last clause matters: proving a guardrail fires is worth more than being told it exists.

---

## Session 2 — Tenancy and RLS foundation (M0.2)

```
Implement M0.2: tenants, practice_lines, users, user_roles from db/schema.sql, as a reversible
migration, with RLS enabled and the helper functions current_tenant_id, has_role,
entitled_practices and can_write.

Then write tests/rls/foundation.spec that prove, connecting as each role's database identity
with the application layer bypassed:
- tenant A reads zero rows of tenant B on every table
- the executive identity fails on insert, update and delete
- a suspended user is denied everything despite holding role rows
- the role_scope_valid constraint rejects a tenant_admin row carrying a practice_line_id
  and a bdm row without one

Show me the failing output first, then the passing output. Do not proceed to M0.3.
```

---

## Session 3 — The permission matrix (M0.4) ⚑ most important session

```
Implement M0.4: docs/02-permission-matrix.md as typed data in src/auth/permissions.ts, plus the
can(user, action, resource) guard.

Hard requirements:
- The matrix is DATA. No role names hard-coded in components or route handlers.
- Every action string in the document appears in the type union. Missing one is a compile error.
- tests/permissions/matrix.spec.ts iterates every role and every action and FAILS if any pair
  is undefined.
- Named deny tests, all of which must exist:
  * bdm CAN create an activity on a deal they own      <- the predecessor's exact defect
  * bdm CAN create an activity on a deal they co-own
  * bdm CAN assign a task to a practice-line peer
  * executive CANNOT perform any write action, iterated over every write action
  * NO role can delete an activity
  * NO role can update an audit entry or stage event
  * NO role can connect another user's mailbox

Then deliberately remove one action from the matrix and show me the completeness test failing.
Restore it and show it passing.
```

The deliberate-break demonstration is the whole point of this session. Do not skip it.

---

## Sessions 4 onward — the repeating pattern

Use this template for every subsequent task.

```
Re-read CLAUDE.md and docs/DECISIONS.md, then implement <TASK ID> only.

Before coding:
1. Restate the acceptance criteria in your own words.
2. List the files you will create or change.
3. Name the invariants this touches and how you will preserve them.
4. Tell me if any open decision blocks this. If so, stop and ask.

Then implement as a vertical slice: migration, RLS policy, repository, domain logic, service,
API, UI, tests.

Definition of done for this task:
- acceptance criteria met
- unit tests on domain logic
- integration tests on repository and any trigger
- permission tests, allow AND deny, for all five roles
- an RLS test
- audit rows written and asserted
- timezone correctness verified against a non-UTC user
- responsive at 375px
- migration tested forward and backward
- zero type errors, zero lint errors, no skipped tests

Show me a diff summary and the test output. Do not start the next task.
```

---

## The session that matters most: M3.3

```
Implement M3.3: the RLS insert policy for activities.

Context you must understand before writing anything: the predecessor product shipped an activity
logger that was invisible and unusable to the bdm role — the only role that performs client
engagement. Every test passed. The feature was around seventy per cent built and the defect went
unnoticed for months, which is why every notes panel in that product reads "no notes captured yet".

Therefore:
- Write the policy so a bdm can insert an activity on a deal they own, co-own or authored.
- Write the named test "a user holding ONLY the bdm role can create an activity on a deal they own".
- Also assert the UI: render the deal page as a bdm and assert the Log Activity button is present.
  A server-side permission that the interface never exposes is the same defect wearing a different hat.
- Then verify the reverse: a bdm cannot insert on a deal in a practice line they are not entitled to.

Show me all four tests failing before implementation, then passing.
```

---

## Prompts for when things drift

**Scope creep:** "You have implemented more than <TASK ID> asked for. List what is beyond scope, and
tell me whether to revert it or move it to its own task. Do not add anything further."

**A guardrail was weakened:** "You changed a check to make a test pass. Revert that. The check is
correct; the approach is wrong. Explain what the check was protecting and propose a compliant design."

**Silent default on a decision:** "You chose a default for an open question in DECISIONS.md. Which
question, what did you assume, and what breaks if I decide otherwise? Stop and wait for my answer."

**Metric invented:** "That formula is not in docs/04-metric-definitions.md. Do not invent metrics.
Either cite the definition or tell me the definition is missing so I can add it."

**Quality drift after a long session:** "Re-read CLAUDE.md. Audit your last three commits against the
definition of done and list every gap. Then fix them before doing anything new."

**Before every merge of a ⚑ task:** "Produce a self-review: which invariants does this touch, which
permission pairs are newly covered, what is the worst thing that happens if this has a bug, and what
did you choose not to test and why?"

---

## What you must review personally, no matter how good the code looks

Every RLS policy, line by line, and the tests that prove them — including the deny cases. Every
migration touching existing data, especially any de-duplication or merge. The `changeStage`,
`logActivity`, `assignTask` and `closeDeal` services, since these are the single paths every
invariant depends on. Anything touching money, FX or the forecast. The audit write path, including
what happens when the audit insert itself fails. Every deny assertion in the permission suite,
because that is the exact class of defect that produced this rebuild.

## Honest expectation setting

This kit will get you a well-architected, well-tested product substantially faster than building it
unaided. It will not get you a perfect product, because "perfect" is not a property software has.
What it does give you is a codebase whose failure modes are the ones you chose knowingly, documented
in `DECISIONS.md`, rather than the ones that emerge silently from a thousand small unreviewed
assumptions. That difference is the whole game.
