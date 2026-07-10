/* Seed the CPMS demo: users through Better Auth, then the 2026 scorecard.
 * Run with: npm run seed
 * Idempotent: wipes and reloads all domain and auth data. */
import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { sql } from 'drizzle-orm';
import { db } from '../src/db';
import { auth } from '../src/lib/auth';
import {
  annualTargets,
  aspirations,
  auditLog,
  fiscalYears,
  initiatives,
  keyResults,
  kpis,
  monthlyActuals,
  monthlyTargets,
  objectives,
  perspectives,
  profiles,
  submissions,
  units,
} from '../src/db/schema';

const YEAR = 2026;
const PASSWORD = 'wfg2026';
/** Actuals exist for January through June; today is July in the demo. */
const REPORTED_MONTHS = 6;

type Phasing = 'even' | 'seasonal' | 'ramp';

interface KpiSeed {
  name: string;
  uom: string;
  direction: 'higher' | 'lower';
  weight: number;
  cadence: 'continuous' | 'one_off';
  aggregation: 'sum' | 'average' | 'end';
  perspective: string;
  objective: string;
  annualTarget: number;
  phasing: Phasing;
  /** Actual = monthly target x multiplier, per reported month. null = not reported. */
  actualMultipliers: (number | null)[];
  /** For one-off KPIs: the month the deliverable landed (1-12), if it has. */
  achievedInMonth?: number;
}

interface UnitSeed {
  name: string;
  slug: string;
  type: 'LOB' | 'AOB';
  weight: number;
  aspiration: string;
  objectives: { title: string; group: string; perspective: string; framework?: 'MBO' | 'OKR'; weight?: number }[];
  kpis: KpiSeed[];
  initiatives: { title: string; kpi: string; owner: string; due: string; status: 'not_started' | 'in_progress' | 'done' | 'blocked'; note?: string }[];
}

/** Seasonal revenue phasing: softer start, steady from Q2. Sums to 100. */
const SEASONAL = [6, 7, 8, 8, 9, 9, 9, 8, 9, 9, 9, 9];

function monthlyTargetFor(seed: KpiSeed, month: number): number {
  if (seed.aggregation === 'sum') {
    if (seed.phasing === 'seasonal') return (seed.annualTarget * SEASONAL[month - 1]) / 100;
    return seed.annualTarget / 12;
  }
  if (seed.aggregation === 'end' && seed.phasing === 'ramp') {
    // Stock measures build towards the year-end level.
    return Math.round(seed.annualTarget * (0.88 + 0.01 * month) * 100) / 100;
  }
  // Rates and levels hold the annual figure every month.
  return seed.annualTarget;
}

const GROUP_OBJECTIVES: { key: string; title: string; perspective: string; framework: 'MBO' | 'OKR'; weight: number }[] = [
  { key: 'revenue', title: 'Grow group revenue to N1.2bn', perspective: 'Financial', framework: 'MBO', weight: 3 },
  { key: 'clients', title: 'Deepen client relationships across Nigeria and Africa', perspective: 'Client and Market', framework: 'MBO', weight: 2 },
  { key: 'talent', title: 'Build the talent engine that powers our clients', perspective: 'People and Capability', framework: 'OKR', weight: 2 },
  { key: 'operations', title: 'Run a disciplined, efficient operation', perspective: 'Operational Excellence', framework: 'MBO', weight: 2 },
  { key: 'innovation', title: 'Open new products and markets', perspective: 'Growth and Innovation', framework: 'OKR', weight: 1 },
];

const UNITS: UnitSeed[] = [
  {
    name: 'Workforce Consulting',
    slug: 'consulting',
    type: 'LOB',
    weight: 2,
    aspiration:
      'To be the advisory partner Nigerian boards call first when strategy has to survive contact with reality.',
    objectives: [
      { title: 'Grow advisory revenue', group: 'revenue', perspective: 'Financial', weight: 3 },
      { title: 'Win multi-year transformation mandates', group: 'clients', perspective: 'Client and Market', weight: 2 },
      { title: 'Deepen the senior consulting bench', group: 'talent', perspective: 'People and Capability', framework: 'OKR', weight: 1 },
    ],
    kpis: [
      { name: 'Advisory revenue', uom: 'NGN m', direction: 'higher', weight: 3, cadence: 'continuous', aggregation: 'sum', perspective: 'Financial', objective: 'Grow advisory revenue', annualTarget: 220, phasing: 'seasonal', actualMultipliers: [1.05, 1.08, 1.1, 1.04, 1.12, 1.06] },
      { name: 'Gross margin', uom: '%', direction: 'higher', weight: 2, cadence: 'continuous', aggregation: 'average', perspective: 'Financial', objective: 'Grow advisory revenue', annualTarget: 38, phasing: 'even', actualMultipliers: [1.02, 1.0, 1.05, 1.03, 1.08, 1.04] },
      { name: 'New mandates won', uom: 'count', direction: 'higher', weight: 2, cadence: 'continuous', aggregation: 'sum', perspective: 'Client and Market', objective: 'Win multi-year transformation mandates', annualTarget: 24, phasing: 'even', actualMultipliers: [1.0, 1.5, 1.0, 0.5, 1.5, 1.0] },
      { name: 'Client NPS', uom: 'score', direction: 'higher', weight: 1, cadence: 'continuous', aggregation: 'average', perspective: 'Client and Market', objective: 'Win multi-year transformation mandates', annualTarget: 60, phasing: 'even', actualMultipliers: [1.05, 1.02, 1.08, 1.1, 1.05, 1.07] },
      { name: 'Senior consultants on bench', uom: 'count', direction: 'higher', weight: 1, cadence: 'continuous', aggregation: 'end', perspective: 'People and Capability', objective: 'Deepen the senior consulting bench', annualTarget: 25, phasing: 'ramp', actualMultipliers: [0.98, 1.0, 1.0, 1.02, 1.03, 1.02] },
      { name: 'ISO 9001 recertification', uom: 'count', direction: 'higher', weight: 0.5, cadence: 'one_off', aggregation: 'end', perspective: 'Operational Excellence', objective: 'Deepen the senior consulting bench', annualTarget: 1, phasing: 'even', actualMultipliers: [], achievedInMonth: 5 },
    ],
    initiatives: [
      { title: 'Convert Q2 pipeline of three bank transformation mandates', kpi: 'New mandates won', owner: 'Head, Advisory Sales', due: `${YEAR}-08-31`, status: 'in_progress' },
      { title: 'Launch alumni referral programme for senior hires', kpi: 'Senior consultants on bench', owner: 'Practice Lead, People', due: `${YEAR}-09-30`, status: 'not_started' },
    ],
  },
  {
    name: 'Workforce Outsourcing',
    slug: 'outsourcing',
    type: 'LOB',
    weight: 3,
    aspiration:
      'To run the largest, best-governed outsourced workforce in West Africa, trusted with 20,000 careers.',
    objectives: [
      { title: 'Grow managed headcount revenue', group: 'revenue', perspective: 'Financial', weight: 3 },
      { title: 'Keep deployed talent engaged and retained', group: 'talent', perspective: 'People and Capability', weight: 2 },
      { title: 'Bill and collect on time', group: 'operations', perspective: 'Operational Excellence', weight: 2 },
    ],
    kpis: [
      { name: 'Outsourcing revenue', uom: 'NGN m', direction: 'higher', weight: 3, cadence: 'continuous', aggregation: 'sum', perspective: 'Financial', objective: 'Grow managed headcount revenue', annualTarget: 480, phasing: 'seasonal', actualMultipliers: [0.98, 1.0, 1.02, 0.99, 1.03, 1.01] },
      { name: 'Headcount deployed', uom: 'count', direction: 'higher', weight: 2, cadence: 'continuous', aggregation: 'end', perspective: 'Financial', objective: 'Grow managed headcount revenue', annualTarget: 18000, phasing: 'ramp', actualMultipliers: [1.0, 1.0, 1.01, 1.01, 1.02, 1.02] },
      { name: 'Staff retention rate', uom: '%', direction: 'higher', weight: 2, cadence: 'continuous', aggregation: 'average', perspective: 'People and Capability', objective: 'Keep deployed talent engaged and retained', annualTarget: 90, phasing: 'even', actualMultipliers: [1.0, 0.99, 1.0, 1.01, 0.99, 1.0] },
      { name: 'Payroll accuracy', uom: '%', direction: 'higher', weight: 1, cadence: 'continuous', aggregation: 'average', perspective: 'Operational Excellence', objective: 'Bill and collect on time', annualTarget: 99.5, phasing: 'even', actualMultipliers: [1.0, 1.0, 0.995, 1.0, 1.0, 1.0] },
      { name: 'Debtor days', uom: 'days', direction: 'lower', weight: 2, cadence: 'continuous', aggregation: 'average', perspective: 'Operational Excellence', objective: 'Bill and collect on time', annualTarget: 45, phasing: 'even', actualMultipliers: [1.05, 1.1, 1.08, 1.15, 1.2, 1.18] },
      { name: 'HMO onboarding within 30 days', uom: '%', direction: 'higher', weight: 1, cadence: 'continuous', aggregation: 'average', perspective: 'People and Capability', objective: 'Keep deployed talent engaged and retained', annualTarget: 95, phasing: 'even', actualMultipliers: [0.95, 0.97, 0.99, 1.0, 1.01, 1.0] },
    ],
    initiatives: [
      { title: 'Escalation desk with top five debtor clients on collections', kpi: 'Debtor days', owner: 'Head, Client Finance', due: `${YEAR}-08-15`, status: 'in_progress', note: 'Two of five clients now on direct debit.' },
      { title: 'Quarterly engagement pulse for deployed staff', kpi: 'Staff retention rate', owner: 'HR Business Partner', due: `${YEAR}-07-31`, status: 'done' },
    ],
  },
  {
    name: 'Workforce Resourcing',
    slug: 'resourcing',
    type: 'LOB',
    weight: 1.5,
    aspiration:
      'To fill every critical role in corporate Nigeria faster than any rival, without compromising on quality.',
    objectives: [
      { title: 'Grow permanent placement revenue', group: 'revenue', perspective: 'Financial', weight: 3 },
      { title: 'Place faster than the market', group: 'operations', perspective: 'Operational Excellence', weight: 2 },
    ],
    kpis: [
      { name: 'Placement revenue', uom: 'NGN m', direction: 'higher', weight: 3, cadence: 'continuous', aggregation: 'sum', perspective: 'Financial', objective: 'Grow permanent placement revenue', annualTarget: 150, phasing: 'seasonal', actualMultipliers: [0.72, 0.78, 1.45, 0.75, 0.8, 0.82] },
      { name: 'Placements completed', uom: 'count', direction: 'higher', weight: 2, cadence: 'continuous', aggregation: 'sum', perspective: 'Client and Market', objective: 'Grow permanent placement revenue', annualTarget: 360, phasing: 'even', actualMultipliers: [0.8, 0.83, 1.3, 0.77, 0.8, 0.87] },
      { name: 'Time to fill', uom: 'days', direction: 'lower', weight: 2, cadence: 'continuous', aggregation: 'average', perspective: 'Operational Excellence', objective: 'Place faster than the market', annualTarget: 30, phasing: 'even', actualMultipliers: [1.2, 1.15, 1.1, 1.25, 1.3, 1.22] },
      { name: 'Offer acceptance rate', uom: '%', direction: 'higher', weight: 1, cadence: 'continuous', aggregation: 'average', perspective: 'Client and Market', objective: 'Place faster than the market', annualTarget: 85, phasing: 'even', actualMultipliers: [0.95, 0.96, 0.98, 0.93, 0.94, 0.95] },
    ],
    initiatives: [
      { title: 'Rebuild the executive search pipeline after Q1 shortfall', kpi: 'Placement revenue', owner: 'MD, Resourcing', due: `${YEAR}-09-30`, status: 'in_progress', note: 'March spike was the NNPC subsidiary bulk placement; core pipeline still thin.' },
      { title: 'Automate candidate screening with structured assessments', kpi: 'Time to fill', owner: 'Head, Delivery', due: `${YEAR}-10-31`, status: 'not_started' },
    ],
  },
  {
    name: 'Workforce Learning',
    slug: 'learning',
    type: 'LOB',
    weight: 1.5,
    aspiration:
      'To be the academy where African corporates build the capabilities their strategies depend on.',
    objectives: [
      { title: 'Grow learning revenue', group: 'revenue', perspective: 'Financial', weight: 3 },
      { title: 'Prove learning works', group: 'clients', perspective: 'Client and Market', weight: 2 },
      { title: 'Publish thought leadership', group: 'innovation', perspective: 'Growth and Innovation', framework: 'OKR', weight: 1 },
    ],
    kpis: [
      { name: 'Learning revenue', uom: 'NGN m', direction: 'higher', weight: 3, cadence: 'continuous', aggregation: 'sum', perspective: 'Financial', objective: 'Grow learning revenue', annualTarget: 120, phasing: 'seasonal', actualMultipliers: [0.88, 0.9, 0.92, 0.87, 0.93, 0.9] },
      { name: 'Learners trained', uom: 'count', direction: 'higher', weight: 2, cadence: 'continuous', aggregation: 'sum', perspective: 'Client and Market', objective: 'Prove learning works', annualTarget: 9600, phasing: 'even', actualMultipliers: [0.92, 0.95, 0.9, 0.93, 0.96, 0.94] },
      { name: 'Post-training competency uplift', uom: '%', direction: 'higher', weight: 2, cadence: 'continuous', aggregation: 'average', perspective: 'Client and Market', objective: 'Prove learning works', annualTarget: 25, phasing: 'even', actualMultipliers: [0.96, 1.0, 1.04, 1.0, 1.08, 1.04] },
      { name: 'Course utilisation rate', uom: '%', direction: 'higher', weight: 1, cadence: 'continuous', aggregation: 'average', perspective: 'Operational Excellence', objective: 'Grow learning revenue', annualTarget: 80, phasing: 'even', actualMultipliers: [0.85, 0.88, 0.9, 0.86, 0.92, 0.9] },
      { name: 'Publish the sector HR benchmark report', uom: 'count', direction: 'higher', weight: 0.5, cadence: 'one_off', aggregation: 'end', perspective: 'Growth and Innovation', objective: 'Publish thought leadership', annualTarget: 1, phasing: 'even', actualMultipliers: [] },
    ],
    initiatives: [
      { title: 'Bundle open programmes into corporate academies', kpi: 'Learning revenue', owner: 'MD, Learning', due: `${YEAR}-08-31`, status: 'in_progress' },
      { title: 'Field the benchmark survey to 200 HR leaders', kpi: 'Publish the sector HR benchmark report', owner: 'Research Lead', due: `${YEAR}-09-15`, status: 'in_progress', note: '118 responses in; need 200 before drafting.' },
    ],
  },
  {
    name: 'Workforce Energies',
    slug: 'energies',
    type: 'LOB',
    weight: 1,
    aspiration:
      'To be the technical manpower partner of record for the Gulf of Guinea energy corridor.',
    objectives: [
      { title: 'Grow energy sector revenue', group: 'revenue', perspective: 'Financial', weight: 3 },
      { title: 'Operate safely, always', group: 'operations', perspective: 'Operational Excellence', weight: 2 },
      { title: 'Retain scarce technical talent', group: 'talent', perspective: 'People and Capability', weight: 2 },
    ],
    kpis: [
      { name: 'Energies revenue', uom: 'NGN m', direction: 'higher', weight: 3, cadence: 'continuous', aggregation: 'sum', perspective: 'Financial', objective: 'Grow energy sector revenue', annualTarget: 130, phasing: 'seasonal', actualMultipliers: [0.9, 0.85, 0.88, 0.92, 0.86, 0.84] },
      { name: 'Technical staff deployed', uom: 'count', direction: 'higher', weight: 2, cadence: 'continuous', aggregation: 'end', perspective: 'Financial', objective: 'Grow energy sector revenue', annualTarget: 850, phasing: 'ramp', actualMultipliers: [0.99, 0.98, 0.99, 1.0, 0.98, 0.97] },
      { name: 'Lost-time incidents', uom: 'count', direction: 'lower', weight: 2, cadence: 'continuous', aggregation: 'sum', perspective: 'Operational Excellence', objective: 'Operate safely, always', annualTarget: 6, phasing: 'even', actualMultipliers: [0, 2, 0, 2, 0, 2] },
      { name: 'Technical staff attrition', uom: '%', direction: 'lower', weight: 2, cadence: 'continuous', aggregation: 'average', perspective: 'People and Capability', objective: 'Retain scarce technical talent', annualTarget: 8, phasing: 'even', actualMultipliers: [1.0, 1.05, 1.1, 1.15, 1.65, 1.5] },
      { name: 'HSE training compliance', uom: '%', direction: 'higher', weight: 1, cadence: 'continuous', aggregation: 'average', perspective: 'Operational Excellence', objective: 'Operate safely, always', annualTarget: 100, phasing: 'even', actualMultipliers: [0.97, 0.98, 0.99, 0.97, 0.96, 0.98] },
    ],
    initiatives: [
      { title: 'Counter-offer framework for rig-experienced engineers', kpi: 'Technical staff attrition', owner: 'MD, Energies', due: `${YEAR}-07-31`, status: 'blocked', note: 'Awaiting group approval of the revised pay bands.' },
      { title: 'Win the Bonga field manpower renewal', kpi: 'Energies revenue', owner: 'BD Lead, Energies', due: `${YEAR}-09-30`, status: 'in_progress' },
    ],
  },
  {
    name: 'Workforce Africa',
    slug: 'africa',
    type: 'AOB',
    weight: 1,
    aspiration:
      'To make expanding into any African market as simple as opening an office in Lagos.',
    objectives: [
      { title: 'Grow pan-African EOR revenue', group: 'revenue', perspective: 'Financial', weight: 3 },
      { title: 'Expand the country footprint', group: 'innovation', perspective: 'Growth and Innovation', framework: 'OKR', weight: 2 },
    ],
    kpis: [
      { name: 'EOR revenue', uom: 'NGN m', direction: 'higher', weight: 3, cadence: 'continuous', aggregation: 'sum', perspective: 'Financial', objective: 'Grow pan-African EOR revenue', annualTarget: 80, phasing: 'seasonal', actualMultipliers: [1.1, 1.15, 1.2, 1.18, 1.22, 1.25] },
      { name: 'Active countries', uom: 'count', direction: 'higher', weight: 2, cadence: 'continuous', aggregation: 'end', perspective: 'Growth and Innovation', objective: 'Expand the country footprint', annualTarget: 18, phasing: 'ramp', actualMultipliers: [0.95, 0.95, 1.0, 1.0, 1.05, 1.05] },
      { name: 'Client onboarding time', uom: 'days', direction: 'lower', weight: 1, cadence: 'continuous', aggregation: 'average', perspective: 'Operational Excellence', objective: 'Grow pan-African EOR revenue', annualTarget: 14, phasing: 'even', actualMultipliers: [1.0, 0.95, 0.9, 0.92, 0.88, 0.85] },
      { name: 'Cross-border payroll accuracy', uom: '%', direction: 'higher', weight: 1, cadence: 'continuous', aggregation: 'average', perspective: 'Operational Excellence', objective: 'Grow pan-African EOR revenue', annualTarget: 99, phasing: 'even', actualMultipliers: [1.0, 1.0, 1.0, 1.005, 1.0, 1.005] },
    ],
    initiatives: [
      { title: 'Open Nairobi and Accra service hubs', kpi: 'Active countries', owner: 'MD, Workforce Africa', due: `${YEAR}-10-31`, status: 'in_progress' },
    ],
  },
  {
    name: 'The Zone',
    slug: 'zone',
    type: 'AOB',
    weight: 1,
    aspiration:
      'To be the venue where Lagos does its most important thinking, learning, and deciding.',
    objectives: [
      { title: 'Grow venue and events revenue', group: 'revenue', perspective: 'Financial', weight: 3 },
      { title: 'Fill the space, delight the guest', group: 'clients', perspective: 'Client and Market', weight: 2 },
    ],
    kpis: [
      { name: 'Venue revenue', uom: 'NGN m', direction: 'higher', weight: 3, cadence: 'continuous', aggregation: 'sum', perspective: 'Financial', objective: 'Grow venue and events revenue', annualTarget: 60, phasing: 'seasonal', actualMultipliers: [0.82, 0.85, 0.9, 0.88, 0.86, null] },
      { name: 'Occupancy rate', uom: '%', direction: 'higher', weight: 2, cadence: 'continuous', aggregation: 'average', perspective: 'Client and Market', objective: 'Fill the space, delight the guest', annualTarget: 75, phasing: 'even', actualMultipliers: [0.88, 0.9, 0.95, 0.92, 0.9, null] },
      { name: 'Guest satisfaction', uom: 'score', direction: 'higher', weight: 1, cadence: 'continuous', aggregation: 'average', perspective: 'Client and Market', objective: 'Fill the space, delight the guest', annualTarget: 4.5, phasing: 'even', actualMultipliers: [1.0, 1.02, 1.04, 1.02, 1.04, null] },
      { name: 'Event delivery incidents', uom: 'count', direction: 'lower', weight: 1, cadence: 'continuous', aggregation: 'sum', perspective: 'Operational Excellence', objective: 'Fill the space, delight the guest', annualTarget: 12, phasing: 'even', actualMultipliers: [1, 0, 1, 1, 0, null] },
    ],
    initiatives: [
      { title: 'Corporate retreat packages for bank strategy season', kpi: 'Occupancy rate', owner: 'GM, The Zone', due: `${YEAR}-08-31`, status: 'in_progress' },
    ],
  },
];

async function createUser(email: string, name: string): Promise<string> {
  const res = await auth.api.signUpEmail({
    body: { email, password: PASSWORD, name },
  });
  if (!res.user) throw new Error(`Failed to create user ${email}`);
  return res.user.id;
}

async function main() {
  console.log('Wiping existing data...');
  await db.execute(sql`
    TRUNCATE TABLE audit_log, documents, submissions, initiatives, monthly_actuals,
      monthly_targets, annual_targets, kpis, key_results, aspirations, objectives,
      fiscal_years, perspectives, profiles, units,
      "verification", "account", "session", "user"
    CASCADE
  `);

  console.log('Creating fiscal year and perspectives...');
  const [fy] = await db
    .insert(fiscalYears)
    .values({ year: YEAR, label: `FY ${YEAR}`, active: true })
    .returning();

  const perspectiveNames = [
    'Financial',
    'Client and Market',
    'People and Capability',
    'Operational Excellence',
    'Growth and Innovation',
  ];
  const perspectiveRows = await db
    .insert(perspectives)
    .values(perspectiveNames.map((name, i) => ({ name, sortOrder: i })))
    .returning();
  const perspectiveId = (name: string) => {
    const row = perspectiveRows.find((p) => p.name === name);
    if (!row) throw new Error(`Unknown perspective ${name}`);
    return row.id;
  };

  console.log('Creating group objectives...');
  const groupObjectiveRows = await db
    .insert(objectives)
    .values(
      GROUP_OBJECTIVES.map((o, i) => ({
        kind: 'group' as const,
        unitId: null,
        fiscalYearId: fy.id,
        perspectiveId: perspectiveId(o.perspective),
        title: o.title,
        framework: o.framework,
        weight: String(o.weight),
        sortOrder: i,
      })),
    )
    .returning();
  const groupObjectiveId = (key: string) => {
    const idx = GROUP_OBJECTIVES.findIndex((o) => o.key === key);
    return groupObjectiveRows[idx].id;
  };

  console.log('Creating users...');
  const csstUserId = await createUser('csst@wfg.demo', 'Corporate Strategy Support Team');
  const emtUserId = await createUser('emt@wfg.demo', 'Executive Management Team');
  await db.insert(profiles).values([
    { userId: csstUserId, role: 'csst', fullName: 'Corporate Strategy Support Team' },
    { userId: emtUserId, role: 'emt', fullName: 'Executive Management Team' },
  ]);

  for (const [i, u] of UNITS.entries()) {
    console.log(`Seeding ${u.name}...`);
    const [unit] = await db
      .insert(units)
      .values({
        name: u.name,
        slug: u.slug,
        type: u.type,
        weight: String(u.weight),
        sortOrder: i,
      })
      .returning();

    const operatorId = await createUser(`${u.slug}@wfg.demo`, `MD, ${u.name}`);
    await db.insert(profiles).values({
      userId: operatorId,
      role: 'lob',
      unitId: unit.id,
      fullName: `MD, ${u.name}`,
    });

    await db.insert(aspirations).values({
      unitId: unit.id,
      fiscalYearId: fy.id,
      text: u.aspiration,
    });

    const unitObjectiveRows = await db
      .insert(objectives)
      .values(
        u.objectives.map((o, j) => ({
          kind: 'unit' as const,
          unitId: unit.id,
          fiscalYearId: fy.id,
          perspectiveId: perspectiveId(o.perspective),
          parentId: groupObjectiveId(o.group),
          title: o.title,
          framework: o.framework ?? ('MBO' as const),
          weight: String(o.weight ?? 1),
          sortOrder: j,
        })),
      )
      .returning();
    const unitObjectiveId = (title: string) => {
      const row = unitObjectiveRows.find((o) => o.title === title);
      if (!row) throw new Error(`Unknown objective ${title} for ${u.name}`);
      return row.id;
    };

    // OKR objectives get illustrative key results.
    for (const obj of unitObjectiveRows.filter((o) => o.framework === 'OKR')) {
      await db.insert(keyResults).values([
        {
          objectiveId: obj.id,
          title: `Deliver the ${YEAR} roadmap for "${obj.title}"`,
          targetText: '100% of milestones',
          currentText: 'On plan at half year',
          sortOrder: 0,
        },
      ]);
    }

    const kpiIdByName = new Map<string, string>();
    for (const [j, k] of u.kpis.entries()) {
      const [kpiRow] = await db
        .insert(kpis)
        .values({
          unitId: unit.id,
          objectiveId: unitObjectiveId(k.objective),
          perspectiveId: perspectiveId(k.perspective),
          fiscalYearId: fy.id,
          name: k.name,
          uom: k.uom,
          direction: k.direction,
          weight: String(k.weight),
          cadence: k.cadence,
          aggregation: k.aggregation,
          sortOrder: j,
        })
        .returning();
      kpiIdByName.set(k.name, kpiRow.id);

      await db.insert(annualTargets).values({
        kpiId: kpiRow.id,
        fiscalYearId: fy.id,
        value: String(k.annualTarget),
      });

      if (k.cadence === 'continuous') {
        await db.insert(monthlyTargets).values(
          Array.from({ length: 12 }, (_, m) => ({
            kpiId: kpiRow.id,
            fiscalYearId: fy.id,
            month: m + 1,
            value: String(Math.round(monthlyTargetFor(k, m + 1) * 100) / 100),
          })),
        );

        const actualRows = [];
        for (let m = 1; m <= REPORTED_MONTHS; m++) {
          const mult = k.actualMultipliers[m - 1];
          if (mult === null || mult === undefined) continue;
          const target = monthlyTargetFor(k, m);
          // Count-like sums stay whole numbers.
          const raw = target * mult;
          const value =
            k.uom === 'count' || k.uom === 'days'
              ? Math.round(raw)
              : Math.round(raw * 100) / 100;
          actualRows.push({
            kpiId: kpiRow.id,
            fiscalYearId: fy.id,
            month: m,
            value: String(value),
            enteredBy: operatorId,
          });
        }
        if (actualRows.length > 0) await db.insert(monthlyActuals).values(actualRows);
      } else if (k.achievedInMonth) {
        await db.insert(monthlyActuals).values({
          kpiId: kpiRow.id,
          fiscalYearId: fy.id,
          month: k.achievedInMonth,
          value: String(k.annualTarget),
          note: 'Deliverable completed.',
          enteredBy: operatorId,
        });
      }
    }

    for (const init of u.initiatives) {
      await db.insert(initiatives).values({
        unitId: unit.id,
        kpiId: kpiIdByName.get(init.kpi) ?? null,
        fiscalYearId: fy.id,
        title: init.title,
        owner: init.owner,
        dueDate: init.due,
        status: init.status,
        note: init.note ?? null,
      });
    }

    // Submission states: a realistic spread at half year.
    const operator = operatorId;
    const q1Narratives: Record<string, string> = {
      consulting:
        'A strong first quarter. Advisory revenue finished 8% ahead of plan on the back of two bank transformation mandates, and margin held above 38%. The bench build is on plan.',
      outsourcing:
        'Revenue and deployed headcount tracked plan. Retention held at 90%. Collections are the watch item: debtor days drifted to 49 against a 45-day target and we have opened an escalation desk with the five largest debtors.',
      resourcing:
        'A difficult quarter for the core placement business. The March NNPC subsidiary bulk placement flattered revenue; underlying pipeline was 25% below plan and time to fill remains above 33 days. Rebuild plan is attached.',
      learning:
        'Revenue finished at 90% of plan. Utilisation is improving month on month and competency uplift scores are at target. The academy bundling initiative should close the gap from Q3.',
      energies:
        'Revenue at 88% of plan and attrition rising in the technical cadre. Two lost-time incidents in the quarter, both investigated and closed. The counter-offer framework needs group sign-off urgently.',
      africa:
        'EOR revenue finished 15% ahead of plan and we entered our sixteenth country. Onboarding time is improving. The Nairobi and Accra hubs remain on plan for Q4.',
    };

    if (u.slug !== 'zone') {
      const status =
        u.slug === 'resourcing' || u.slug === 'africa'
          ? ('submitted' as const)
          : u.slug === 'energies'
            ? ('returned' as const)
            : ('approved' as const);
      await db.insert(submissions).values({
        unitId: unit.id,
        fiscalYearId: fy.id,
        periodKind: 'quarter',
        periodIndex: 1,
        narrative: q1Narratives[u.slug],
        status,
        submittedBy: operator,
        submittedAt: new Date(`${YEAR}-04-05T10:00:00Z`),
        reviewedBy: status === 'approved' || status === 'returned' ? emtUserId : null,
        reviewedAt:
          status === 'approved' || status === 'returned'
            ? new Date(`${YEAR}-04-12T10:00:00Z`)
            : null,
        rating: status === 'approved' ? (u.slug === 'consulting' ? 5 : 4) : null,
        reviewComment:
          status === 'approved'
            ? 'Signed off. Keep the momentum through Q2.'
            : status === 'returned'
              ? 'Returned: quantify the attrition exposure by client site and restate the safety narrative with the investigation outcomes before resubmitting.'
              : null,
      });
    }

    if (u.slug === 'consulting') {
      await db.insert(submissions).values({
        unitId: unit.id,
        fiscalYearId: fy.id,
        periodKind: 'quarter',
        periodIndex: 2,
        narrative:
          'Q2 sustained the Q1 run rate with revenue 7% ahead of plan. The May ISO 9001 recertification landed on schedule. Mandate wins slowed in April; the Q3 pipeline review is attached.',
        status: 'submitted',
        submittedBy: operator,
        submittedAt: new Date(`${YEAR}-07-03T10:00:00Z`),
      });
    }
    if (u.slug === 'outsourcing') {
      await db.insert(submissions).values({
        unitId: unit.id,
        fiscalYearId: fy.id,
        periodKind: 'quarter',
        periodIndex: 2,
        narrative: null,
        status: 'draft',
        submittedBy: null,
        submittedAt: null,
      });
    }
  }

  await db.insert(auditLog).values({
    actorUserId: csstUserId,
    actorRole: 'csst',
    action: 'seed.load',
    entity: 'dataset',
    entityId: String(YEAR),
    detail: { note: 'Demo dataset seeded' },
  });

  console.log('Seed complete.');
  console.log(`Sign in with password "${PASSWORD}":`);
  console.log('  csst@wfg.demo (Admin), emt@wfg.demo (Reviewer)');
  console.log('  consulting@wfg.demo, outsourcing@wfg.demo, resourcing@wfg.demo,');
  console.log('  learning@wfg.demo, energies@wfg.demo, africa@wfg.demo, zone@wfg.demo');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
