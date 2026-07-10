import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth-schema';

export const roleEnum = pgEnum('role', ['csst', 'lob', 'emt']);
export const unitTypeEnum = pgEnum('unit_type', ['LOB', 'AOB', 'Unit']);
export const directionEnum = pgEnum('direction', ['higher', 'lower']);
export const cadenceEnum = pgEnum('cadence', ['continuous', 'one_off']);
export const aggregationEnum = pgEnum('aggregation', ['sum', 'average', 'end']);
export const objectiveKindEnum = pgEnum('objective_kind', ['group', 'unit']);
export const frameworkEnum = pgEnum('framework', ['MBO', 'OKR']);
export const initiativeStatusEnum = pgEnum('initiative_status', [
  'not_started',
  'in_progress',
  'done',
  'blocked',
]);
export const submissionStatusEnum = pgEnum('submission_status', [
  'draft',
  'submitted',
  'approved',
  'returned',
]);
export const periodKindEnum = pgEnum('period_kind', ['month', 'quarter', 'half', 'year']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const units = pgTable('units', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  type: unitTypeEnum('type').notNull().default('LOB'),
  logoKey: text('logo_key'),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  ...timestamps,
});

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
    fullName: text('full_name'),
    ...timestamps,
  },
  (t) => [uniqueIndex('profiles_user_id_idx').on(t.userId), index('profiles_unit_id_idx').on(t.unitId)],
);

export const perspectives = pgTable('perspectives', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
});

export const fiscalYears = pgTable('fiscal_years', {
  id: uuid('id').primaryKey().defaultRandom(),
  year: integer('year').notNull().unique(),
  label: text('label').notNull(),
  active: boolean('active').notNull().default(false),
  ...timestamps,
});

export const objectives = pgTable(
  'objectives',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: objectiveKindEnum('kind').notNull(),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'cascade' }),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id, { onDelete: 'cascade' }),
    perspectiveId: uuid('perspective_id').references(() => perspectives.id, {
      onDelete: 'set null',
    }),
    parentId: uuid('parent_id'),
    title: text('title').notNull(),
    framework: frameworkEnum('framework').notNull().default('MBO'),
    weight: numeric('weight', { precision: 5, scale: 2 }).notNull().default('1'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index('objectives_unit_year_idx').on(t.unitId, t.fiscalYearId),
    index('objectives_parent_idx').on(t.parentId),
  ],
);

export const aspirations = pgTable(
  'aspirations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('aspirations_unit_year_idx').on(t.unitId, t.fiscalYearId)],
);

export const keyResults = pgTable(
  'key_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    objectiveId: uuid('objective_id')
      .notNull()
      .references(() => objectives.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    targetText: text('target_text'),
    currentText: text('current_text'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('key_results_objective_idx').on(t.objectiveId)],
);

export const kpis = pgTable(
  'kpis',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    objectiveId: uuid('objective_id')
      .notNull()
      .references(() => objectives.id, { onDelete: 'cascade' }),
    perspectiveId: uuid('perspective_id')
      .notNull()
      .references(() => perspectives.id, { onDelete: 'restrict' }),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    uom: text('uom').notNull(),
    direction: directionEnum('direction').notNull().default('higher'),
    weight: numeric('weight', { precision: 5, scale: 2 }).notNull().default('1'),
    cadence: cadenceEnum('cadence').notNull().default('continuous'),
    aggregation: aggregationEnum('aggregation').notNull().default('sum'),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [index('kpis_unit_year_idx').on(t.unitId, t.fiscalYearId)],
);

export const annualTargets = pgTable(
  'annual_targets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kpiId: uuid('kpi_id')
      .notNull()
      .references(() => kpis.id, { onDelete: 'cascade' }),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id, { onDelete: 'cascade' }),
    value: numeric('value', { precision: 18, scale: 2 }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('annual_targets_kpi_year_idx').on(t.kpiId, t.fiscalYearId)],
);

export const monthlyTargets = pgTable(
  'monthly_targets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kpiId: uuid('kpi_id')
      .notNull()
      .references(() => kpis.id, { onDelete: 'cascade' }),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id, { onDelete: 'cascade' }),
    month: integer('month').notNull(),
    value: numeric('value', { precision: 18, scale: 2 }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('monthly_targets_kpi_year_month_idx').on(t.kpiId, t.fiscalYearId, t.month)],
);

export const monthlyActuals = pgTable(
  'monthly_actuals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kpiId: uuid('kpi_id')
      .notNull()
      .references(() => kpis.id, { onDelete: 'cascade' }),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id, { onDelete: 'cascade' }),
    month: integer('month').notNull(),
    value: numeric('value', { precision: 18, scale: 2 }),
    note: text('note'),
    enteredBy: text('entered_by').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('monthly_actuals_kpi_year_month_idx').on(t.kpiId, t.fiscalYearId, t.month)],
);

export const initiatives = pgTable(
  'initiatives',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    kpiId: uuid('kpi_id').references(() => kpis.id, { onDelete: 'set null' }),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    owner: text('owner').notNull(),
    dueDate: date('due_date'),
    status: initiativeStatusEnum('status').notNull().default('not_started'),
    note: text('note'),
    ...timestamps,
  },
  (t) => [index('initiatives_unit_year_idx').on(t.unitId, t.fiscalYearId)],
);

export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id, { onDelete: 'cascade' }),
    periodKind: periodKindEnum('period_kind').notNull(),
    periodIndex: integer('period_index').notNull(),
    narrative: text('narrative'),
    status: submissionStatusEnum('status').notNull().default('draft'),
    submittedBy: text('submitted_by').references(() => user.id, { onDelete: 'set null' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedBy: text('reviewed_by').references(() => user.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    rating: integer('rating'),
    reviewComment: text('review_comment'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('submissions_unit_period_idx').on(
      t.unitId,
      t.fiscalYearId,
      t.periodKind,
      t.periodIndex,
    ),
    index('submissions_status_idx').on(t.status),
  ],
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'cascade' }),
    submissionId: uuid('submission_id').references(() => submissions.id, {
      onDelete: 'set null',
    }),
    spacesKey: text('spaces_key').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    uploadedBy: text('uploaded_by').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('documents_unit_idx').on(t.unitId)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    actorRole: roleEnum('actor_role'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    detail: jsonb('detail'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_at_idx').on(t.at)],
);
