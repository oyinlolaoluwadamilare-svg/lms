# 00 — Product Brief

## Vision

A business development organisation does not win work by recording deals. It wins by engaging the
right stakeholders repeatedly, by never dropping a commitment, and by learning honestly from what
it loses. Pipeline Intelligence exists to make that behaviour the path of least resistance.

Most pipeline tools record **state**: which stage, what value, whose name is on it. State is easy to
store and nearly useless for management, because it tells you nothing about whether anyone is
actually working. This product treats **activity and ownership** as the primary objects and derives
state from them.

## Who it is for

A multi-practice professional-services firm — consulting and advisory, learning and development,
outsourcing and managed services, recruitment and executive search, plus regional and sector units.
Deals are consultative, six figures and upward in local currency, run three to twelve months, and
involve four to eight stakeholders on the client side. Sellers are subject-matter practitioners who
sell part-time, which means administrative burden is the single greatest adoption risk.

## Personas

**BDM (Business Development Manager).** Owns deals within one practice line. Wants credit for work
done and no duplicate data entry. Will abandon the product if logging an engagement takes longer
than writing the same note in a notebook.

**Team Lead.** Runs a squad inside a practice. Needs to see who is busy, who is stuck, and which
deals have gone quiet. Assigns and reassigns work.

**Practice Director.** Owns the practice number. Needs a defensible forecast, an escalation queue,
and evidence when coaching. Reviews and comments on deals.

**Executive.** Reads the entire business, writes nothing, ever. Needs roll-ups and trends, not
narrative detail.

**Tenant Admin / Sales Operations.** Configures stages, practice lines, custom fields, roles, seats,
automation rules and targets. Owns data quality and governs the audit trail.

## Product principles

**Activity before analytics.** No metric ships before the event stream that makes it true.

**Three interactions, maximum.** Logging an engagement or creating a task must be achievable in
three interactions from the deal page. This is a hard constraint on every design.

**Automate capture, don't mandate typing.** Email and calendar synchronisation exist so that the
majority of engagement is recorded without a human deciding to record it.

**Every open deal has a next step.** A deal without a scheduled next action is treated as an
exception requiring attention, not as a normal state.

**Losses are data.** Closing is impossible without a structured reason. The loss report is a
first-class deliverable, not an afterthought.

**The organisation owns the relationship.** When a seller leaves, the engagement history,
stakeholder map and open commitments remain intact and legible to their successor.

**Read-only means read-only.** The Executive role can never write, and that is enforced in the
database, not in the interface.

## Scope

**In scope, in dependency order:** tenancy and roles; deals and pipeline; engagement timeline;
tasks and delegation; accounts and contacts with buying-committee roles; stage-event history;
email and calendar synchronisation; win and loss discipline; forecasting, quotas and attainment;
automation and stage gates; leads and qualification; documents, templates and sequences; data
quality and governance; public API and webhooks; responsive PWA; AI assistance last.

**Out of scope:** marketing campaign execution, support ticketing, delivery and project management,
invoicing and collections, native mobile applications.

## Success metrics with targets

| Metric | Target |
|---|---|
| Active deals engaged within the last 14 days | 85% or better |
| Active deals carrying a scheduled next action | 95% or better |
| Deals with an owner and an expected close date | 100%, enforced at write time |
| Tasks completed on or before due date | 75% or better |
| Closed deals with a structured win or loss reason | 100%, enforced at write time |
| Median hours from engagement occurring to being logged | Under 24 |
| Forecast accuracy, commit versus actual, per quarter | Within plus or minus 10% |
| Weekly active usage among seller seats | 90% or better |
| Time to log an engagement, measured in interactions | 3 or fewer |

## The failure mode to design against

This product's most likely cause of death is not a technical failure. It is sellers experiencing
activity logging as surveillance and administrative tax, logging nothing, and leadership concluding
the tool does not work. Three counter-measures are requirements, not niceties: automatic capture via
mail and calendar synchronisation shipped as early as dependencies allow; a genuinely three-interaction
logging path; and visible leadership use of the data in pipeline reviews from the first fortnight.
