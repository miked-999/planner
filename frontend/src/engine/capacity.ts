import type {
  AllocationBreakdownItem,
  Assignment,
  CandidateFitResult,
  PersonAvailability,
  PlanDocument,
  Project,
  Task,
  WeekBucket,
  WeeklyCellCapacity,
} from '../types/plan';
import { addCalendarDays, addWorkingDays, generateWeeks, isWorkingDay, snapToWorkingDay } from './dates';

export function resolveAssignmentWindow(
  assignment: Assignment,
  project: Project | undefined,
  task: Task | undefined,
): { start: string; end: string } | null {
  const target = task ?? project;
  if (!target) return null;
  const start = assignment.start_date ?? target.expected_start;
  const end = assignment.end_date ?? target.expected_end;
  if (!start || !end) return null;
  if (end < start) return { start, end: start };
  return { start, end };
}

export function isItemActiveForCapacity(item: Project | Task | undefined): boolean {
  if (!item) return false;
  return (
    item.status !== 'completed' &&
    item.status !== 'on_hold' &&
    item.status !== 'backlog'
  );
}

export interface DailyAllocationResult {
  totalPct: number;
  assignmentPct: number;
  leavePct: number;
  items: AllocationBreakdownItem[];
}

export function computePersonDailyAllocation(
  plan: PlanDocument,
  personId: string,
  dayIso: string,
): DailyAllocationResult {
  if (!isWorkingDay(dayIso)) {
    return { totalPct: 0, assignmentPct: 0, leavePct: 0, items: [] };
  }

  const projectMap = new Map(plan.projects.map((p) => [p.id, p]));
  const taskMap = new Map(plan.tasks.map((t) => [t.id, t]));

  const personAssignments = plan.assignments.filter((a) => a.person_id === personId);

  // Determine which projects have active task-level assignments on `dayIso`
  // so we don't double-count a blanket project-level assignment on the same day.
  const projectsWithActiveTaskToday = new Set<string>();
  for (const asg of personAssignments) {
    if (!asg.task_id) continue;
    const proj = projectMap.get(asg.project_id);
    const task = taskMap.get(asg.task_id);
    if (!isItemActiveForCapacity(proj) || !isItemActiveForCapacity(task)) continue;
    const win = resolveAssignmentWindow(asg, proj, task);
    if (win && dayIso >= win.start && dayIso <= win.end) {
      projectsWithActiveTaskToday.add(asg.project_id);
    }
  }

  const items: AllocationBreakdownItem[] = [];
  let assignmentPct = 0;

  for (const asg of personAssignments) {
    const proj = projectMap.get(asg.project_id);
    const task = asg.task_id ? taskMap.get(asg.task_id) : undefined;
    if (!isItemActiveForCapacity(proj)) continue;
    if (asg.task_id && !isItemActiveForCapacity(task)) continue;
    if (!asg.task_id && projectsWithActiveTaskToday.has(asg.project_id)) continue;

    const win = resolveAssignmentWindow(asg, proj, task);
    if (!win || dayIso < win.start || dayIso > win.end) continue;

    const pct = asg.allocation_pct ?? 100;
    assignmentPct += pct;
    items.push({
      id: asg.id,
      kind: 'assignment',
      projectId: proj!.id,
      taskId: asg.task_id,
      label: proj!.name,
      sublabel: task ? task.name : undefined,
      color: proj!.color,
      allocationPct: pct,
      isImplicitDefault: asg.allocation_pct === null,
      activeDaysInPeriod: 1,
    });
  }

  let leavePct = 0;
  for (const u of plan.unavailabilities) {
    if (u.person_id !== personId) continue;
    if (dayIso >= u.start_date && dayIso <= u.end_date) {
      const pct = u.allocation_pct ?? 100;
      leavePct += pct;
      items.push({
        id: u.id,
        kind: 'leave',
        label: u.reason || 'Unavailable',
        color: '#64748b',
        allocationPct: pct,
        isImplicitDefault: false,
        activeDaysInPeriod: 1,
      });
    }
  }

  return {
    totalPct: assignmentPct + leavePct,
    assignmentPct,
    leavePct,
    items,
  };
}

export function computeWeeklyCapacityMatrix(
  plan: PlanDocument,
  weeks: WeekBucket[],
): Map<string, Map<string, WeeklyCellCapacity>> {
  const matrix = new Map<string, Map<string, WeeklyCellCapacity>>();

  for (const person of plan.people) {
    const row = new Map<string, WeeklyCellCapacity>();
    for (const week of weeks) {
      let sumPct = 0;
      let peakDailyPct = 0;
      const itemAgg = new Map<
        string,
        { base: AllocationBreakdownItem; sumContribution: number; days: number }
      >();

      for (const day of week.workingDays) {
        const daily = computePersonDailyAllocation(plan, person.id, day);
        sumPct += daily.totalPct;
        if (daily.totalPct > peakDailyPct) peakDailyPct = daily.totalPct;
        for (const item of daily.items) {
          const existing = itemAgg.get(item.id);
          if (existing) {
            existing.sumContribution += item.allocationPct;
            existing.days += 1;
          } else {
            itemAgg.set(item.id, {
              base: item,
              sumContribution: item.allocationPct,
              days: 1,
            });
          }
        }
      }

      const weeklyPct = Math.round(sumPct / 5);
      const hasDailySpike = peakDailyPct > 100 && weeklyPct <= 100;
      let level: WeeklyCellCapacity['level'] = 'free';
      if (weeklyPct > 100) level = 'over';
      else if (weeklyPct >= 75) level = 'full';
      else if (weeklyPct > 0) level = 'partial';

      const items: AllocationBreakdownItem[] = Array.from(itemAgg.values()).map((entry) => ({
        ...entry.base,
        allocationPct: entry.base.allocationPct,
        activeDaysInPeriod: entry.days,
      }));

      row.set(week.weekStart, {
        personId: person.id,
        weekStart: week.weekStart,
        weeklyPct,
        peakDailyPct,
        hasDailySpike,
        level,
        items,
      });
    }
    matrix.set(person.id, row);
  }

  return matrix;
}

export function computePersonAvailability(
  plan: PlanDocument,
  personId: string,
  todayIso: string,
): PersonAvailability {
  const startWorkDay = snapToWorkingDay(todayIso, 'forward');

  // Current 5-day load
  let currentSum = 0;
  for (let i = 0; i < 5; i += 1) {
    const d = addWorkingDays(startWorkDay, i);
    currentSum += computePersonDailyAllocation(plan, personId, d).totalPct;
  }
  const currentWeekPct = Math.round(currentSum / 5);

  for (let offset = 0; offset < 260; offset += 1) {
    const candidate = addWorkingDays(startWorkDay, offset);
    const alloc = computePersonDailyAllocation(plan, personId, candidate);
    if (alloc.totalPct < 100) {
      return {
        personId,
        availableDate: candidate,
        freePct: Math.max(0, 100 - alloc.totalPct),
        isAvailableNow: offset === 0,
        currentWeekPct,
      };
    }
  }

  const fallback = addWorkingDays(startWorkDay, 260);
  return {
    personId,
    availableDate: fallback,
    freePct: 100,
    isAvailableNow: false,
    currentWeekPct,
  };
}

/**
 * Computes weekly unstaffed TBD demand across all placeholder assignments (person_id === null).
 */
export function computeTbdWeeklyDemand(
  plan: PlanDocument,
  weeks: WeekBucket[],
): Map<string, WeeklyCellCapacity> {
  const projectMap = new Map(plan.projects.map((p) => [p.id, p]));
  const taskMap = new Map(plan.tasks.map((t) => [t.id, t]));
  const placeholders = plan.assignments.filter((a) => !a.person_id);
  const row = new Map<string, WeeklyCellCapacity>();

  for (const week of weeks) {
    let sumPct = 0;
    let peakDailyPct = 0;
    const itemAgg = new Map<string, { base: AllocationBreakdownItem; days: number }>();

    for (const day of week.workingDays) {
      let dayTotal = 0;
      for (const asg of placeholders) {
        const proj = projectMap.get(asg.project_id);
        const task = asg.task_id ? taskMap.get(asg.task_id) : undefined;
        if (!isItemActiveForCapacity(proj)) continue;
        if (asg.task_id && !isItemActiveForCapacity(task)) continue;
        const win = resolveAssignmentWindow(asg, proj, task);
        if (!win || day < win.start || day > win.end) continue;

        const pct = asg.allocation_pct ?? 100;
        dayTotal += pct;
        const existing = itemAgg.get(asg.id);
        if (existing) {
          existing.days += 1;
        } else {
          itemAgg.set(asg.id, {
            base: {
              id: asg.id,
              kind: 'assignment',
              projectId: proj!.id,
              taskId: asg.task_id,
              label: `${asg.placeholder_label || 'TBD'} · ${proj!.name}`,
              sublabel: task?.name,
              color: proj!.color,
              allocationPct: pct,
              isImplicitDefault: asg.allocation_pct === null,
              activeDaysInPeriod: 1,
            },
            days: 1,
          });
        }
      }
      sumPct += dayTotal;
      if (dayTotal > peakDailyPct) peakDailyPct = dayTotal;
    }

    const weeklyPct = Math.round(sumPct / 5);
    row.set(week.weekStart, {
      personId: '__tbd__',
      weekStart: week.weekStart,
      weeklyPct,
      peakDailyPct,
      hasDailySpike: false,
      level: weeklyPct > 0 ? 'partial' : 'free',
      items: Array.from(itemAgg.values()).map((x) => ({
        ...x.base,
        activeDaysInPeriod: x.days,
      })),
    });
  }

  return row;
}

/**
 * Evaluates and ranks every team member by how cleanly they can absorb `neededPct`
 * during `[startIso, endIso]` ("Who fits?" matcher for TBD slots).
 */
export function rankPeopleForSlot(
  plan: PlanDocument,
  startIso: string,
  endIso: string,
  neededPct: number,
): CandidateFitResult[] {
  const effectiveEnd = endIso < startIso ? startIso : endIso;
  const workingDays: string[] = [];
  let cur = startIso;
  while (cur <= effectiveEnd) {
    if (isWorkingDay(cur)) workingDays.push(cur);
    cur = addCalendarDays(cur, 1);
  }
  if (workingDays.length === 0) {
    workingDays.push(snapToWorkingDay(startIso, 'forward'));
  }

  const weeks = generateWeeks(workingDays[0], workingDays[workingDays.length - 1]);
  const daySet = new Set(workingDays);

  const results: CandidateFitResult[] = plan.people.map((person) => {
    let sumCurrent = 0;
    let conflictDaysCount = 0;

    for (const d of workingDays) {
      const daily = computePersonDailyAllocation(plan, person.id, d).totalPct;
      sumCurrent += daily;
      if (daily + neededPct > 100) {
        conflictDaysCount += 1;
      }
    }

    let peakWeeklyAfterPct = 0;
    for (const w of weeks) {
      let weekSumAfter = 0;
      for (const wd of w.workingDays) {
        const base = computePersonDailyAllocation(plan, person.id, wd).totalPct;
        const added = daySet.has(wd) ? neededPct : 0;
        weekSumAfter += base + added;
      }
      const wkAfter = Math.round(weekSumAfter / 5);
      if (wkAfter > peakWeeklyAfterPct) peakWeeklyAfterPct = wkAfter;
    }

    const avgCurrentPct = Math.round(sumCurrent / workingDays.length);
    const avgFreePct = Math.max(0, 100 - avgCurrentPct);

    let fitStatus: CandidateFitResult['fitStatus'] = 'conflict';
    if (peakWeeklyAfterPct <= 100 && conflictDaysCount === 0) {
      fitStatus = 'full';
    } else if (peakWeeklyAfterPct <= 100 || avgCurrentPct + neededPct <= 100) {
      fitStatus = 'partial';
    }

    return {
      personId: person.id,
      personName: person.name,
      avgCurrentPct,
      avgFreePct,
      peakWeeklyAfterPct,
      conflictDaysCount,
      totalWorkingDays: workingDays.length,
      fitStatus,
    };
  });

  const statusOrder: Record<CandidateFitResult['fitStatus'], number> = {
    full: 0,
    partial: 1,
    conflict: 2,
  };

  return results.sort((a, b) => {
    if (statusOrder[a.fitStatus] !== statusOrder[b.fitStatus]) {
      return statusOrder[a.fitStatus] - statusOrder[b.fitStatus];
    }
    if (a.peakWeeklyAfterPct !== b.peakWeeklyAfterPct) {
      return a.peakWeeklyAfterPct - b.peakWeeklyAfterPct;
    }
    return b.avgFreePct - a.avgFreePct;
  });
}
