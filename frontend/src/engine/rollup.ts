import type { PlanDocument, Project, ScheduleMetrics, Task } from '../types/plan';
import {
  addWorkingDays,
  snapToWorkingDay,
  workingDaysInclusive,
  workingDaysSignedDiff,
} from './dates';

/**
 * Recalculates project expected_start, expected_end, and optional auto_progress
 * whenever a project contains one or more child tasks (Section 12).
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

    let minStart = children[0].expected_start;
    let maxEnd = children[0].expected_end;
    let weightedSum = 0;
    let totalWeight = 0;

    for (const t of children) {
      if (t.expected_start < minStart) minStart = t.expected_start;
      if (t.expected_end > maxEnd) maxEnd = t.expected_end;
      const w = Math.max(1, workingDaysInclusive(t.expected_start, t.expected_end));
      weightedSum += t.percent_complete * w;
      totalWeight += w;
    }

    const nextPct = proj.auto_progress
      ? Math.round(weightedSum / Math.max(1, totalWeight))
      : proj.percent_complete;

    return {
      ...proj,
      expected_start: minStart,
      expected_end: maxEnd,
      percent_complete: nextPct,
    };
  });

  return {
    ...plan,
    projects,
  };
}

/**
 * Moves or resizes a project bar. If the project has subtasks:
 * - Moving the whole project shifts all subtasks by the working-day delta.
 * - Extending/shortening only the end date adjusts the final subtask(s).
 */
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

  const children = plan.tasks.filter((t) => t.project_id === projectId);
  if (children.length === 0) {
    return {
      ...plan,
      projects: plan.projects.map((p) =>
        p.id === projectId
          ? { ...p, expected_start: newStart, expected_end: newEnd }
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
    if (t.project_id !== projectId) return t;
    if (isPureMove || startShift !== 0) {
      const dur = workingDaysInclusive(t.expected_start, t.expected_end);
      const tStart = addWorkingDays(t.expected_start, startShift);
      const tEnd = addWorkingDays(tStart, dur - 1);
      return { ...t, expected_start: tStart, expected_end: tEnd };
    }
    // Right-edge resize on a parent project: stretch/compress tasks that end at project end
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
      t.id === taskId ? { ...t, expected_start: newStart, expected_end: newEnd } : t,
    ),
  });
}

export function computeScheduleMetrics(item: Project | Task): ScheduleMetrics {
  const durationWorkingDays = workingDaysInclusive(item.expected_start, item.expected_end);
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
    item.status !== 'completed' && headroomDays !== null && headroomDays < 0;

  let health: ScheduleMetrics['health'] = 'green';
  if (item.status === 'completed' || item.status === 'on_hold') {
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
