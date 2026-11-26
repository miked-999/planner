import type { HealthStatus, PlanDocument, Project, Task } from '../types/plan';
import { computeScheduleMetrics } from './rollup';

/** View-only sort lenses for the project list. `manual` uses the shared `sort_order`. */
export type ProjectSortKey =
  | 'manual'
  | 'start'
  | 'end'
  | 'required_by'
  | 'health'
  | 'name'
  | 'percent';

export const PROJECT_SORT_LABELS: Record<ProjectSortKey, string> = {
  manual: 'Manual order',
  start: 'Start date',
  end: 'End date',
  required_by: 'Required-by',
  health: 'Health (at risk first)',
  name: 'Name (A–Z)',
  percent: '% complete',
};

export type DropPlacement = 'before' | 'after';

const HEALTH_RANK: Record<HealthStatus, number> = {
  red: 0,
  amber: 1,
  green: 2,
  blue: 3,
  grey: 4,
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const FAR_FUTURE = '9999-12-31';

/** Stable sort by the shared manual `sort_order` (ties keep their existing array order). */
export function byManualOrder<T extends { sort_order: number }>(items: readonly T[]): T[] {
  return items
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => a.item.sort_order - b.item.sort_order || a.idx - b.idx)
    .map((x) => x.item);
}

export function isProjectArchived(p: Project): boolean {
  return Boolean(p.archived);
}

/** Returns projects ordered by the given lens; manual order is always the tie-breaker. */
export function sortProjects(projects: readonly Project[], key: ProjectSortKey): Project[] {
  const manual = byManualOrder(projects);
  if (key === 'manual') return manual;
  const manualIdx = new Map(manual.map((p, i) => [p.id, i]));

  const compare = (a: Project, b: Project): number => {
    switch (key) {
      case 'start':
        return (a.expected_start ?? FAR_FUTURE).localeCompare(b.expected_start ?? FAR_FUTURE);
      case 'end':
        return (a.expected_end ?? FAR_FUTURE).localeCompare(b.expected_end ?? FAR_FUTURE);
      case 'required_by':
        return (a.required_by ?? FAR_FUTURE).localeCompare(b.required_by ?? FAR_FUTURE);
      case 'health':
        return (
          HEALTH_RANK[computeScheduleMetrics(a).health] -
          HEALTH_RANK[computeScheduleMetrics(b).health]
        );
      case 'name':
        return collator.compare(a.name, b.name);
      case 'percent':
        return a.percent_complete - b.percent_complete;
      default:
        return 0;
    }
  };

  return [...manual].sort(
    (a, b) => compare(a, b) || manualIdx.get(a.id)! - manualIdx.get(b.id)!,
  );
}

function moveItem<T extends { id: string }>(
  ordered: T[],
  dragId: string,
  targetId: string,
  placement: DropPlacement,
): T[] | null {
  if (dragId === targetId) return null;
  const dragged = ordered.find((x) => x.id === dragId);
  if (!dragged) return null;
  const rest = ordered.filter((x) => x.id !== dragId);
  const targetIdx = rest.findIndex((x) => x.id === targetId);
  if (targetIdx < 0) return null;
  const insertAt = placement === 'before' ? targetIdx : targetIdx + 1;
  rest.splice(insertAt, 0, dragged);
  return rest;
}

/** Moves a project before/after another one in the shared manual order and renumbers sort_order. */
export function reorderProjectsInPlan(
  plan: PlanDocument,
  dragId: string,
  targetId: string,
  placement: DropPlacement,
): PlanDocument {
  const manual = byManualOrder(plan.projects);
  const moved = moveItem(manual, dragId, targetId, placement);
  if (!moved) return plan;
  const unchanged = moved.every((p, i) => p.id === manual[i].id && p.sort_order === i);
  if (unchanged) return plan;
  return {
    ...plan,
    projects: moved.map((p, i) => (p.sort_order === i ? p : { ...p, sort_order: i })),
  };
}

/**
 * Moves a phase within its own project. `targetTaskId = null` moves it to the top of the
 * project. Moving a phase into another project is not allowed and returns the plan unchanged.
 */
export function reorderTasksInPlan(
  plan: PlanDocument,
  dragTaskId: string,
  targetTaskId: string | null,
  placement: DropPlacement,
): PlanDocument {
  const dragged = plan.tasks.find((t) => t.id === dragTaskId);
  if (!dragged) return plan;
  const siblings = byManualOrder(plan.tasks.filter((t) => t.project_id === dragged.project_id));

  let moved: Task[] | null;
  if (targetTaskId === null) {
    moved = [dragged, ...siblings.filter((t) => t.id !== dragTaskId)];
  } else {
    const target = plan.tasks.find((t) => t.id === targetTaskId);
    if (!target || target.project_id !== dragged.project_id) return plan;
    moved = moveItem(siblings, dragTaskId, targetTaskId, placement);
  }
  if (!moved) return plan;

  const newOrder = new Map(moved.map((t, i) => [t.id, i]));
  if (moved.every((t, i) => siblings[i].id === t.id && t.sort_order === i)) return plan;
  return {
    ...plan,
    tasks: plan.tasks.map((t) => {
      const ord = newOrder.get(t.id);
      return ord === undefined || ord === t.sort_order ? t : { ...t, sort_order: ord };
    }),
  };
}

/** Next sort_order slot at the bottom of the shared manual order. */
export function nextProjectSortOrder(projects: readonly Project[]): number {
  return projects.reduce((max, p) => Math.max(max, p.sort_order), -1) + 1;
}
