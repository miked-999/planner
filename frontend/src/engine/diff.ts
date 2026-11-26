import type {
  BaselineBarSpan,
  PlanDiffReport,
  PlanDocument,
  Project,
  ProjectChangeType,
  ProjectDiffItem,
} from '../types/plan';
import { workingDaysSignedDiff } from './dates';
import { computeScheduleMetrics, recalculateProjectRollups } from './rollup';

function summarizeProjectPeople(
  plan: PlanDocument,
  projectId: string,
  peopleNames: Map<string, string>,
): Map<string, { name: string; pct: number }> {
  const result = new Map<string, { name: string; pct: number }>();
  for (const a of plan.assignments) {
    if (a.project_id !== projectId) continue;
    const pct = a.allocation_pct ?? 100;
    if (a.person_id) {
      const name = peopleNames.get(a.person_id) ?? a.person_id;
      const prev = result.get(`person:${a.person_id}`);
      if (!prev || pct > prev.pct) {
        result.set(`person:${a.person_id}`, { name, pct });
      }
    } else {
      const label = a.placeholder_label || 'TBD';
      result.set(`tbd:${a.id}`, { name: label, pct });
    }
  }
  return result;
}

export function comparePlans(
  rawBaseline: PlanDocument,
  rawCurrent: PlanDocument,
): PlanDiffReport {
  const baseline = recalculateProjectRollups(rawBaseline);
  const current = recalculateProjectRollups(rawCurrent);

  const peopleNames = new Map<string, string>();
  for (const p of baseline.people) peopleNames.set(p.id, p.name);
  for (const p of current.people) peopleNames.set(p.id, p.name);

  const baseProjMap = new Map<string, Project>(
    baseline.projects.map((p) => [p.id, p]),
  );
  const currProjMap = new Map<string, Project>(
    current.projects.map((p) => [p.id, p]),
  );
  const baseTaskMap = new Map(baseline.tasks.map((t) => [t.id, t]));
  const currTaskMap = new Map(current.tasks.map((t) => [t.id, t]));

  const ghostBars: Record<string, BaselineBarSpan> = {};
  for (const bp of baseline.projects) {
    if (bp.expected_start && bp.expected_end) {
      const cp = currProjMap.get(bp.id);
      const endShiftDays =
        cp && cp.expected_end
          ? workingDaysSignedDiff(bp.expected_end, cp.expected_end)
          : null;
      ghostBars[`project:${bp.id}`] = {
        start: bp.expected_start,
        end: bp.expected_end,
        endShiftDays,
      };
    }
  }
  for (const bt of baseline.tasks) {
    if (bt.expected_start && bt.expected_end) {
      const ct = currTaskMap.get(bt.id);
      const endShiftDays =
        ct && ct.expected_end
          ? workingDaysSignedDiff(bt.expected_end, ct.expected_end)
          : null;
      ghostBars[`task:${bt.id}`] = {
        start: bt.expected_start,
        end: bt.expected_end,
        endShiftDays,
      };
    }
  }

  const addedEntityKeys: string[] = [];
  for (const cp of current.projects) {
    if (!baseProjMap.has(cp.id)) addedEntityKeys.push(`project:${cp.id}`);
  }
  for (const ct of current.tasks) {
    if (!baseTaskMap.has(ct.id)) addedEntityKeys.push(`task:${ct.id}`);
  }

  const projectDiffs: ProjectDiffItem[] = [];
  let slippedCount = 0;
  let pulledInCount = 0;
  let addedCount = 0;
  let removedCount = 0;
  let completedSinceCount = 0;
  let reassignedCount = 0;

  // 1. Evaluate current projects (Added or Modified)
  for (const cp of current.projects) {
    const bp = baseProjMap.get(cp.id);
    const currPeople = summarizeProjectPeople(current, cp.id, peopleNames);

    if (!bp) {
      addedCount += 1;
      const cm = computeScheduleMetrics(cp);
      projectDiffs.push({
        projectId: cp.id,
        name: cp.name,
        color: cp.color,
        changeType: 'added',
        baselineStart: null,
        baselineEnd: null,
        currentStart: cp.expected_start,
        currentEnd: cp.expected_end,
        startShiftDays: null,
        endShiftDays: null,
        baselineStatus: null,
        currentStatus: cp.status,
        baselinePercent: null,
        currentPercent: cp.percent_complete,
        newlyLate: cm.isForecastLate,
        resolvedLate: false,
        addedPeople: Array.from(currPeople.values()).map(
          (x) => `${x.name} (${x.pct}%)`,
        ),
        removedPeople: [],
        allocationChanges: [],
      });
      continue;
    }

    const baseScheduled = Boolean(bp.expected_start && bp.expected_end);
    const currScheduled = Boolean(cp.expected_start && cp.expected_end);

    const startShiftDays =
      baseScheduled && currScheduled
        ? workingDaysSignedDiff(bp.expected_start!, cp.expected_start!)
        : null;
    const endShiftDays =
      baseScheduled && currScheduled
        ? workingDaysSignedDiff(bp.expected_end!, cp.expected_end!)
        : null;

    const bm = computeScheduleMetrics(bp);
    const cm = computeScheduleMetrics(cp);
    const newlyLate = !bm.isForecastLate && cm.isForecastLate;
    const resolvedLate = bm.isForecastLate && !cm.isForecastLate;

    const basePeople = summarizeProjectPeople(baseline, bp.id, peopleNames);
    const addedPeople: string[] = [];
    const removedPeople: string[] = [];
    const allocationChanges: { name: string; beforePct: number; afterPct: number }[] =
      [];

    for (const [k, cEntry] of currPeople.entries()) {
      const bEntry = basePeople.get(k);
      if (!bEntry) {
        addedPeople.push(`${cEntry.name} (${cEntry.pct}%)`);
      } else if (bEntry.pct !== cEntry.pct) {
        allocationChanges.push({
          name: cEntry.name,
          beforePct: bEntry.pct,
          afterPct: cEntry.pct,
        });
      }
    }
    for (const [k, bEntry] of basePeople.entries()) {
      if (!currPeople.has(k)) {
        removedPeople.push(bEntry.name);
      }
    }

    let changeType: ProjectChangeType | null = null;
    if (!baseScheduled && currScheduled) {
      changeType = 'newly_scheduled';
    } else if (baseScheduled && !currScheduled) {
      changeType = 'moved_to_backlog';
    } else if (
      (startShiftDays !== null && startShiftDays !== 0) ||
      (endShiftDays !== null && endShiftDays !== 0) ||
      bp.status !== cp.status ||
      bp.percent_complete !== cp.percent_complete ||
      bp.name !== cp.name ||
      addedPeople.length > 0 ||
      removedPeople.length > 0 ||
      allocationChanges.length > 0
    ) {
      changeType = 'modified';
    }

    if (!changeType) continue;

    if (endShiftDays !== null && endShiftDays > 0) slippedCount += 1;
    if (endShiftDays !== null && endShiftDays < 0) pulledInCount += 1;
    if (bp.status !== 'completed' && cp.status === 'completed') {
      completedSinceCount += 1;
    }
    if (
      addedPeople.length > 0 ||
      removedPeople.length > 0 ||
      allocationChanges.length > 0
    ) {
      reassignedCount += 1;
    }

    projectDiffs.push({
      projectId: cp.id,
      name: cp.name,
      color: cp.color,
      changeType,
      baselineStart: bp.expected_start,
      baselineEnd: bp.expected_end,
      currentStart: cp.expected_start,
      currentEnd: cp.expected_end,
      startShiftDays,
      endShiftDays,
      baselineStatus: bp.status,
      currentStatus: cp.status,
      baselinePercent: bp.percent_complete,
      currentPercent: cp.percent_complete,
      newlyLate,
      resolvedLate,
      addedPeople,
      removedPeople,
      allocationChanges,
    });
  }

  // 2. Evaluate removed projects
  for (const bp of baseline.projects) {
    if (currProjMap.has(bp.id)) continue;
    removedCount += 1;
    const basePeople = summarizeProjectPeople(baseline, bp.id, peopleNames);
    projectDiffs.push({
      projectId: bp.id,
      name: bp.name,
      color: bp.color,
      changeType: 'removed',
      baselineStart: bp.expected_start,
      baselineEnd: bp.expected_end,
      currentStart: null,
      currentEnd: null,
      startShiftDays: null,
      endShiftDays: null,
      baselineStatus: bp.status,
      currentStatus: null,
      baselinePercent: bp.percent_complete,
      currentPercent: null,
      newlyLate: false,
      resolvedLate: false,
      addedPeople: [],
      removedPeople: Array.from(basePeople.values()).map((x) => x.name),
      allocationChanges: [],
    });
  }

  return {
    projectDiffs,
    ghostBars,
    addedEntityKeys,
    summary: {
      totalChangedProjects: projectDiffs.length,
      slippedCount,
      pulledInCount,
      addedCount,
      removedCount,
      completedSinceCount,
      reassignedCount,
    },
  };
}
