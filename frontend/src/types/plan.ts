export type ProjectStatus = 'planned' | 'in_progress' | 'on_hold' | 'completed';
export type PriorityLevel = 'low' | 'medium' | 'high';
export type EntityType = 'project' | 'task';
export type HealthStatus = 'green' | 'amber' | 'red' | 'blue' | 'grey';

export interface Person {
  id: string;
  name: string;
  sort_order: number;
}

export interface Unavailability {
  id: string;
  person_id: string;
  start_date: string;
  end_date: string;
  reason: string;
  allocation_pct: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  expected_start: string;
  actual_start: string | null;
  expected_end: string;
  original_expected_end: string | null;
  required_by: string | null;
  actual_end: string | null;
  percent_complete: number;
  auto_progress: boolean;
  status: ProjectStatus;
  priority: PriorityLevel;
  color: string;
  notes: string;
  sort_order: number;
}

export interface Task {
  id: string;
  project_id: string;
  name: string;
  description: string;
  expected_start: string;
  actual_start: string | null;
  expected_end: string;
  original_expected_end: string | null;
  required_by: string | null;
  actual_end: string | null;
  percent_complete: number;
  status: ProjectStatus;
  priority: PriorityLevel;
  notes: string;
  sort_order: number;
}

export interface Assignment {
  id: string;
  person_id: string;
  project_id: string;
  task_id: string | null;
  allocation_pct: number | null;
  start_date: string | null;
  end_date: string | null;
}

export interface Dependency {
  id: string;
  from_type: EntityType;
  from_id: string;
  to_type: EntityType;
  to_id: string;
}

export interface PlanDocument {
  projects: Project[];
  tasks: Task[];
  people: Person[];
  assignments: Assignment[];
  unavailabilities: Unavailability[];
  dependencies: Dependency[];
}

export interface BackupInfo {
  filename: string;
  label: string;
  created_at: string;
  size_bytes: number;
  project_count: number;
  people_count: number;
}

export interface ScheduleMetrics {
  durationWorkingDays: number;
  startVarianceDays: number | null;
  headroomDays: number | null;
  daysOverdue: number;
  slipDays: number | null;
  isForecastLate: boolean;
  health: HealthStatus;
}

export interface WeekBucket {
  weekStart: string; // Monday YYYY-MM-DD
  weekEnd: string;   // Friday YYYY-MM-DD
  sundayEnd: string; // Sunday YYYY-MM-DD
  weekLabel: string; // W1..W5 within month
  shortRange: string;
  monthKey: string;  // YYYY-MM
  monthLabel: string; // e.g. "December 2026"
  workingDays: string[];
}

export interface AllocationBreakdownItem {
  id: string;
  kind: 'assignment' | 'leave';
  projectId?: string;
  taskId?: string | null;
  label: string;
  sublabel?: string;
  color: string;
  allocationPct: number;
  isImplicitDefault: boolean;
  activeDaysInPeriod: number;
}

export interface WeeklyCellCapacity {
  personId: string;
  weekStart: string;
  weeklyPct: number;
  peakDailyPct: number;
  hasDailySpike: boolean;
  level: 'over' | 'full' | 'partial' | 'free';
  items: AllocationBreakdownItem[];
}

export interface PersonAvailability {
  personId: string;
  availableDate: string;
  freePct: number;
  isAvailableNow: boolean;
  currentWeekPct: number;
}

export interface CascadeShift {
  entityType: EntityType;
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  color: string;
  beforeStart: string;
  beforeEnd: string;
  afterStart: string;
  afterEnd: string;
  shiftWorkingDays: number;
  requiredBy: string | null;
  willMissDeadline: boolean;
  newlyLate: boolean;
}

export interface PersonAvailabilityDelta {
  personId: string;
  personName: string;
  beforeAvailableDate: string;
  afterAvailableDate: string;
  availabilityChanged: boolean;
  newConflictWeeks: string[];
}

export interface CascadePreview {
  triggerLabel: string;
  directOnlyPlan: PlanDocument;
  proposedPlan: PlanDocument;
  shifts: CascadeShift[];
  availabilityDeltas: PersonAvailabilityDelta[];
  hasDownstreamChanges: boolean;
}
