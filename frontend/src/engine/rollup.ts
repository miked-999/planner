import type { PlanDocument, Project, ScheduleMetrics, Task } from '../types/plan';
import {
  addWorkingDays,
  snapToWorkingDay,
  workingDaysInclusive,
  workingDaysSignedDiff,
} from './dates';

export function isScheduled<
  T extends { expected_start: string | null; expected_end: string | null },
>(item: T): item is T & { expected_start: string; expected_end: string } {
  return Boolean(item.expected_start && item.expected_end);
}

/**
 * Recalculates project expected_start, expected_end, and optional auto_progress
 * whenever a project contains one or more child tasks (Section 12).
 * Unscheduled backlog projects/tasks keep null dates until scheduled.
 */
export function recalculateProjectRollups(plan: PlanDocument): PlanDocument {
  const tasksByProject = new Map<string, Task[]>();
  for (const t of plan.tasks) {
    const list = tasksByProject.get(t.project_id) ?? [];
    list.push(t);
    tasksByProject.set(t.project_id, list);
  }

  const projects = plan.projects.map((proj) => {
    const children = tasksByProject.get(proj.id);
    if (!children || children.length === 0) {
      return proj;
    }

    const scheduledChildren = children.filter(isScheduled);
    let weightedSum = 0;
    let totalWeight = 0;
    for (const t of children) {
      const w = isScheduled(t)
        ? Math.max(1, workingDaysInclusive(t.expected_start, t.expected_end))
        : 1;
      weightedSum += t.percent_complete * w;
      totalWeight += w;
    }

    const nextPct = proj.auto_progress
      ? Math.round(weightedSum / Math.max(1, totalWeight))
      : proj.percent_complete;

    if (scheduledChildren.length === 0) {
      return {
        ...proj,
        percent_complete: nextPct,
      };
    }

    let minStart = scheduledChildren[0].expected_start;
    let maxEnd = scheduledChildren[0].expected_end;
    for (const t of scheduledChildren) {
      if (t.expected_start < minStart) minStart = t.expected_start;
      if (t.expected_end > maxEnd) maxEnd = t.expected_end;
    }

    return {
      ...proj,
      expected_start: minStart,
      expected_end: maxEnd,
      original_expected_end: proj.original_expected_end ?? maxEnd,
      percent_complete: nextPct,
    };
  });

  return {
    ...plan,
    projects,
  };
}

/**
 * Schedules a dateless backlog project starting at `startDateRaw` using `estimatedDays`
 * (or its stored `estimated_days`, defaulting to 10 working days).
 */
export function scheduleProjectFromBacklog(
  plan: PlanDocument,
  projectId: string,
  startDateRaw: string,
  estimatedDaysOverride?: number,
): PlanDocument {
  const proj = plan.projects.find((p) => p.id === projectId);
  if (!proj) return plan;

  const start = snapToWorkingDay(startDateRaw, 'forward');
  const estDays = Math.max(1, estimatedDaysOverride ?? proj.estimated_days ?? 10);
  const end = addWorkingDays(start, estDays - 1);

  const childTasks = plan.tasks.filter((t) => t.project_id === projectId);
  let cursor = start;
  const perTaskDays =
    childTasks.length > 0 ? Math.max(1, Math.round(estDays / childTasks.length)) : estDays;

  const updatedTasks = plan.tasks.map((t) => {
    if (t.project_id !== projectId) return t;
    if (t.expected_start && t.expected_end) return t;
    const tStart = cursor;
    const tEnd = addWorkingDays(tStart, perTaskDays - 1);
    cursor = addWorkingDays(tEnd, 1);
    return {
      ...t,
      expected_start: tStart,
      expected_end: tEnd,
      original_expected_end: t.original_expected_end ?? tEnd,
      status: t.status === 'backlog' ? ('planned' as const) : t.status,
    };
  });

  const updatedProjects = plan.projects.map((p) =>
    p.id === projectId
      ? {
          ...p,
          expected_start: start,
          expected_end: end,
          estimated_days: estDays,
          original_expected_end: p.original_expected_end ?? end,
          status: p.status === 'backlog' ? ('planned' as const) : p.status,
        }
      : p,
  );

  return recalculateProjectRollups({
    ...plan,
    projects: updatedProjects,
    tasks: updatedTasks,
  });
}

/**
 * Moves a scheduled project back into the unscheduled backlog, preserving its working-day
 * duration inside `estimated_days`.
 */
export function unscheduleProjectToBacklog(
  plan: PlanDocument,
  projectId: string,
): PlanDocument {
  const proj = plan.projects.find((p) => p.id === projectId);
  if (!proj) return plan;

  const preservedEst =
    proj.expected_start && proj.expected_end
      ? workingDaysInclusive(proj.expected_start, proj.expected_end)
      : (proj.estimated_days ?? 10);

  return {
    ...plan,
    projects: plan.projects.map((p) =>
      p.id === projectId
        ? {
            ...p,
            expected_start: null,
            expected_end: null,
            estimated_days: preservedEst,
            status: 'backlog',
          }
        : p,
    ),
    tasks: plan.tasks.map((t) =>
      t.project_id === projectId
        ? {
            ...t,
            expected_start: null,
            expected_end: null,
            status: t.status === 'completed' ? 'completed' : 'backlog',
          }
        : t,
    ),
  };
}

export function updateProjectDates(
  plan: PlanDocument,
  projectId: string,
  newStartRaw: string,
  newEndRaw: string,
): PlanDocument {
  const proj = plan.projects.find((p) => p.id === projectId);
  if (!proj) return plan;

  const newStart = snapToWorkingDay(newStartRaw, 'forward');
  const snappedEnd = snapToWorkingDay(newEndRaw, 'backward');
  const newEnd = snappedEnd < newStart ? newStart : snappedEnd;

  if (!proj.expected_start || !proj.expected_end) {
    const dur = workingDaysInclusive(newStart, newEnd);
    return scheduleProjectFromBacklog(plan, projectId, newStart, dur);
  }

  const children = plan.tasks.filter((t) => t.project_id === projectId);
  const scheduledChildren = children.filter(isScheduled);
  if (scheduledChildren.length === 0) {
    return {
      ...plan,
      projects: plan.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              expected_start: newStart,
              expected_end: newEnd,
              original_expected_end: p.original_expected_end ?? newEnd,
              status: p.status === 'backlog' ? 'planned' : p.status,
            }
          : p,
      ),
    };
  }

  const startShift = workingDaysSignedDiff(proj.expected_start, newStart);
  const endShift = workingDaysSignedDiff(proj.expected_end, newEnd);
  const oldDuration = workingDaysInclusive(proj.expected_start, proj.expected_end);
  const newDuration = workingDaysInclusive(newStart, newEnd);
  const isPureMove = startShift !== 0 && oldDuration === newDuration;

  const updatedTasks = plan.tasks.map((t) => {
    if (t.project_id !== projectId || !t.expected_start || !t.expected_end) return t;
    if (isPureMove || startShift !== 0) {
      const dur = workingDaysInclusive(t.expected_start, t.expected_end);
      const tStart = addWorkingDays(t.expected_start, startShift);
      const tEnd = addWorkingDays(tStart, dur - 1);
      return { ...t, expected_start: tStart, expected_end: tEnd };
    }
    if (endShift !== 0 && t.expected_end === proj.expected_end) {
      const candidateEnd = addWorkingDays(t.expected_end, endShift);
      return {
        ...t,
        expected_end: candidateEnd < t.expected_start ? t.expected_start : candidateEnd,
      };
    }
    return t;
  });

  return recalculateProjectRollups({
    ...plan,
    tasks: updatedTasks,
  });
}

export function updateTaskDates(
  plan: PlanDocument,
  taskId: string,
  newStartRaw: string,
  newEndRaw: string,
): PlanDocument {
  const newStart = snapToWorkingDay(newStartRaw, 'forward');
  const snappedEnd = snapToWorkingDay(newEndRaw, 'backward');
  const newEnd = snappedEnd < newStart ? newStart : snappedEnd;

  return recalculateProjectRollups({
    ...plan,
    tasks: plan.tasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            expected_start: newStart,
            expected_end: newEnd,
            original_expected_end: t.original_expected_end ?? newEnd,
            status: t.status === 'backlog' ? 'planned' : t.status,
          }
        : t,
    ),
  });
}

export function computeScheduleMetrics(item: Project | Task): ScheduleMetrics {
  if (!item.expected_start || !item.expected_end) {
    const est = 'estimated_days' in item ? (item.estimated_days ?? 0) : 0;
    return {
      durationWorkingDays: est,
      startVarianceDays: null,
      headroomDays: null,
      daysOverdue: 0,
      slipDays: null,
      isForecastLate: false,
      health: 'grey',
    };
  }

  const durationWorkingDays = workingDaysInclusive(
    item.expected_start,
    item.expected_end,
  );
  const startVarianceDays = item.actual_start
    ? workingDaysSignedDiff(item.expected_start, item.actual_start)
    : null;
  const headroomDays = item.required_by
    ? workingDaysSignedDiff(item.expected_end, item.required_by)
    : null;
  const daysOverdue = headroomDays !== null && headroomDays < 0 ? Math.abs(headroomDays) : 0;
  const slipDays = item.original_expected_end
    ? workingDaysSignedDiff(item.original_expected_end, item.expected_end)
    : null;

  const isForecastLate =
    item.status !== 'completed' &&
    item.status !== 'backlog' &&
    headroomDays !== null &&
    headroomDays < 0;

  let health: ScheduleMetrics['health'] = 'green';
  if (
    item.status === 'completed' ||
    item.status === 'on_hold' ||
    item.status === 'backlog'
  ) {
    health = 'grey';
  } else if (isForecastLate) {
    health = 'red';
  } else if (headroomDays !== null && headroomDays <= 5) {
    health = 'amber';
  } else if (item.status === 'planned') {
    health = 'blue';
  } else {
    health = 'green';
  }

  return {
    durationWorkingDays,
    startVarianceDays,
    headroomDays,
    daysOverdue,
    slipDays,
    isForecastLate,
    health,
  };
}
