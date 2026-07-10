export type Role = 'csst' | 'lob' | 'emt';
export type UnitType = 'LOB' | 'AOB' | 'Unit';
export type Direction = 'higher' | 'lower';
export type Cadence = 'continuous' | 'one_off';
export type Aggregation = 'sum' | 'average' | 'end';
export type Framework = 'MBO' | 'OKR';
export type ObjectiveKind = 'group' | 'unit';
export type InitiativeStatus = 'not_started' | 'in_progress' | 'done' | 'blocked';
export type SubmissionStatus = 'draft' | 'submitted' | 'approved' | 'returned';
export type Rag = 'green' | 'amber' | 'red' | 'none';

export type PeriodKind = 'month' | 'quarter' | 'half' | 'year';

/** A reporting period within a fiscal year. index is 1-based:
 *  month 1-12, quarter 1-4, half 1-2, year always 1. */
export interface Period {
  kind: PeriodKind;
  index: number;
}

export interface Unit {
  id: string;
  name: string;
  slug: string;
  type: UnitType;
  weight: number;
  logoKey: string | null;
  sortOrder: number;
  active: boolean;
}

export interface Perspective {
  id: string;
  name: string;
  sortOrder: number;
}

export interface Objective {
  id: string;
  kind: ObjectiveKind;
  unitId: string | null;
  perspectiveId: string | null;
  parentId: string | null;
  title: string;
  framework: Framework;
  weight: number;
  sortOrder: number;
}

export interface KeyResult {
  id: string;
  objectiveId: string;
  title: string;
  targetText: string | null;
  currentText: string | null;
  sortOrder: number;
}

export interface Aspiration {
  id: string;
  unitId: string;
  text: string;
}

export interface Kpi {
  id: string;
  unitId: string;
  objectiveId: string;
  perspectiveId: string;
  name: string;
  uom: string;
  direction: Direction;
  weight: number;
  cadence: Cadence;
  aggregation: Aggregation;
  sortOrder: number;
  active: boolean;
}

export interface Initiative {
  id: string;
  unitId: string;
  kpiId: string | null;
  title: string;
  owner: string;
  dueDate: string | null;
  status: InitiativeStatus;
  note: string | null;
}

export interface Submission {
  id: string;
  unitId: string;
  periodKind: PeriodKind;
  periodIndex: number;
  narrative: string | null;
  status: SubmissionStatus;
  submittedBy: string | null;
  submittedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rating: number | null;
  reviewComment: string | null;
}

export interface MonthEntry {
  value: number | null;
  note: string | null;
}

/** The whole scorecard for one fiscal year, loaded once per request.
 *  Month arrays are length 12, index 0 = January. */
export interface Dataset {
  year: number;
  units: Unit[];
  perspectives: Perspective[];
  objectives: Objective[];
  keyResults: KeyResult[];
  aspirations: Aspiration[];
  kpis: Kpi[];
  annualTargets: Record<string, number>;
  monthlyTargets: Record<string, (number | null)[]>;
  monthlyActuals: Record<string, MonthEntry[]>;
  initiatives: Initiative[];
  submissions: Submission[];
}

export interface KpiResult {
  kpiId: string;
  target: number | null;
  actual: number | null;
  attainment: number | null;
  rag: Rag;
  monthsReported: number;
}

export interface UnitScore {
  unitId: string;
  score: number | null;
  rag: Rag;
  kpiResults: KpiResult[];
}

export interface GroupScore {
  score: number | null;
  rag: Rag;
  unitScores: UnitScore[];
}
