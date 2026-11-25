import type {
  CascadePreview,
  CascadeShift,
  EntityType,
  PersonAvailabilityDelta,
  PlanDocument,
} from '../types/plan';
import { computePersonAvailability, computeWeeklyCapacityMatrix } from './capacity';
import {
  addWorkingDays,
  generateWeeks,
  nextWorkingDayAfter,
  workingDaysInclusive,
  workingDaysSignedDiff,
} from './dates';
import {
  recalculateProjectRollups,
  updateProjectDates,
  updateTaskDates,
} from './rollup';

type NodeKey = `${EntityType}:${string}`;

function makeKey(t: EntityType, id: string): NodeKey {
  return `${t}:${id}`;
}

/**
 * Validates whether adding a Finish-to-Start dependency (from -> to) is legal,
 * blocking self-links, parent-child links, duplicates, and circular chains (DEP-07).
 */
export function canAddDependency(
  plan: PlanDocument,
  fromType: EntityType,
  fromId: string,
  toType: EntityType,
  toId: string,
): { ok: boolean; reason?: string } {
  if (fromType === toType && fromId === toId) {
    return { ok: false, reason: 'An item cannot depend on itself.' };
  }

  const taskToProject = new Map(plan.tasks.map((t) => [t.id, t.project_id]));
  if (fromType === 'project' && toType === 'task' && taskToProject.get(toId) === fromId) {
    return { ok: false, reason: 'A project cannot precede one of its own tasks.' };
  }
  if (fromType === 'task' && toType === 'project' && taskToProject.get(fromId) === toId) {
    return { ok: false, reason: 'A task cannot precede its own parent project.' };
  }

  const duplicate = plan.dependencies.some(
    (d) =>
      d.from_type === fromType &&
      d.from_id === fromId &&
      d.to_type === toType &&
      d.to_id === toId,
  );
  if (duplicate) {
    return { ok: false, reason: 'This dependency link already exists.' };
  }

  const tasksByProject = new Map<string, string[]>();
  for (const p of plan.projects) tasksByProject.set(p.id, []);
  for (const t of plan.tasks) tasksByProject.get(t.project_id)?.push(t.id);

  const adj = new Map<NodeKey, Set<NodeKey>>();
  const addEdge = (u: NodeKey, v: NodeKey) => {
    if (!adj.has(u)) adj.set(u, new Set());
    if (!adj.has(v)) adj.set(v, new Set());
    adj.get(u)!.add(v);
  };

  const allDeps = [
    ...plan.dependencies,
    { id: '__candidate__', from_type: fromType, from_id: fromId, to_type: toType, to_id: toId },
  ];

  for (const dep of allDeps) {
    const srcChildren =
      dep.from_type === 'project' ? (tasksByProject.get(dep.from_id) ?? []) : [];
    const tgtChildren =
      dep.to_type === 'project' ? (tasksByProject.get(dep.to_id) ?? []) : [];

    const sources: NodeKey[] =
      srcChildren.length > 0
        ? srcChildren.map((tid) => makeKey('task', tid))
        : [makeKey(dep.from_type, dep.from_id)];
    const targets: NodeKey[] =
      tgtChildren.length > 0
        ? tgtChildren.map((tid) => makeKey('task', tid))
        : [makeKey(dep.to_type, dep.to_id)];

    for (const s of sources) {
      for (const t of targets) {
        if (s === t) {
          return { ok: false, reason: 'Circular dependency detected (DEP-07).' };
        }
        addEdge(s, t);
      }
    }
  }

  const state = new Map<NodeKey, number>(); // 0=unvisited, 1=visiting, 2=visited
  const hasCycle = (node: NodeKey): boolean => {
    state.set(node, 1);
    for (const nxt of adj.get(node) ?? []) {
      const st = state.get(nxt) ?? 0;
      if (st === 1) return true;
      if (st === 0 && hasCycle(nxt)) return true;
    }
    state.set(node, 2);
    return false;
  };

  for (const node of adj.keys()) {
    if ((state.get(node) ?? 0) === 0 && hasCycle(node)) {
      return { ok: false, reason: 'Circular dependency detected (DEP-07).' };
    }
  }

  return { ok: true };
}

function getEntityDates(
  plan: PlanDocument,
  type: EntityType,
  id: string,
): { start: string; end: string } | null {
  if (type === 'project') {
    const p = plan.projects.find((x) => x.id === id);
    return p && p.expected_start && p.expected_end
      ? { start: p.expected_start, end: p.expected_end }
      : null;
  }
  const t = plan.tasks.find((x) => x.id === id);
  return t && t.expected_start && t.expected_end
    ? { start: t.expected_start, end: t.expected_end }
    : null;
}

export function findViolatedDependencyIds(plan: PlanDocument): Set<string> {
  const violated = new Set<string>();
  for (const dep of plan.dependencies) {
    const src = getEntityDates(plan, dep.from_type, dep.from_id);
    const tgt = getEntityDates(plan, dep.to_type, dep.to_id);
    if (!src || !tgt) continue;
    const earliestSuccessorStart = nextWorkingDayAfter(src.end);
    if (tgt.start < earliestSuccessorStart) {
      violated.add(dep.id);
    }
  }
  return violated;
}

/**
 * Propagates Finish-to-Start constraints forward across downstream items (DEP-04, DEP-05)
 * and computes deadline breaches (DEP-06) + resource/availability impacts (DEP-08).
 */
export function propagateFinishToStart(initialPlan: PlanDocument): PlanDocument {
  let working = recalculateProjectRollups(initialPlan);
  const maxPasses = working.projects.length + working.tasks.length + 4;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false;
    for (const dep of working.dependencies) {
      const src = getEntityDates(working, dep.from_type, dep.from_id);
      const tgt = getEntityDates(working, dep.to_type, dep.to_id);
      if (!src || !tgt) continue;

      const minStart = nextWorkingDayAfter(src.end);
      if (tgt.start < minStart) {
        const dur = workingDaysInclusive(tgt.start, tgt.end);
        const nextEnd = addWorkingDays(minStart, dur - 1);
        working =
          dep.to_type === 'project'
            ? updateProjectDates(working, dep.to_id, minStart, nextEnd)
            : updateTaskDates(working, dep.to_id, minStart, nextEnd);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return working;
}

export function previewDependencyCascade(
  beforePlan: PlanDocument,
  editedPlanRaw: PlanDocument,
  triggerLabel: string,
  todayIso: string,
): CascadePreview {
  const directOnlyPlan = recalculateProjectRollups(editedPlanRaw);
  const proposedPlan = propagateFinishToStart(directOnlyPlan);

  const shifts: CascadeShift[] = [];
  const directProjMap = new Map(directOnlyPlan.projects.map((p) => [p.id, p]));
  const directTaskMap = new Map(directOnlyPlan.tasks.map((t) => [t.id, t]));
  const proposedProjMap = new Map(proposedPlan.projects.map((p) => [p.id, p]));

  for (const afterProj of proposedPlan.projects) {
    const directProj = directProjMap.get(afterProj.id);
    if (
      !directProj ||
      !directProj.expected_start ||
      !directProj.expected_end ||
      !afterProj.expected_start ||
      !afterProj.expected_end
    ) {
      continue;
    }
    if (
      directProj.expected_start !== afterProj.expected_start ||
      directProj.expected_end !== afterProj.expected_end
    ) {
      const shiftWorkingDays = workingDaysSignedDiff(
        directProj.expected_end,
        afterProj.expected_end,
      );
      const wasLate =
        !!directProj.required_by && directProj.expected_end > directProj.required_by;
      const willMissDeadline =
        !!afterProj.required_by && afterProj.expected_end > afterProj.required_by;
      shifts.push({
        entityType: 'project',
        id: afterProj.id,
        name: afterProj.name,
        projectId: afterProj.id,
        projectName: afterProj.name,
        color: afterProj.color,
        beforeStart: directProj.expected_start,
        beforeEnd: directProj.expected_end,
        afterStart: afterProj.expected_start,
        afterEnd: afterProj.expected_end,
        shiftWorkingDays,
        requiredBy: afterProj.required_by,
        willMissDeadline,
        newlyLate: !wasLate && willMissDeadline,
      });
    }
  }

  for (const afterTask of proposedPlan.tasks) {
    const directTask = directTaskMap.get(afterTask.id);
    if (
      !directTask ||
      !directTask.expected_start ||
      !directTask.expected_end ||
      !afterTask.expected_start ||
      !afterTask.expected_end
    ) {
      continue;
    }
    if (
      directTask.expected_start !== afterTask.expected_start ||
      directTask.expected_end !== afterTask.expected_end
    ) {
      const parent = proposedProjMap.get(afterTask.project_id);
      const shiftWorkingDays = workingDaysSignedDiff(
        directTask.expected_end,
        afterTask.expected_end,
      );
      const wasLate =
        !!directTask.required_by && directTask.expected_end > directTask.required_by;
      const willMissDeadline =
        !!afterTask.required_by && afterTask.expected_end > afterTask.required_by;
      shifts.push({
        entityType: 'task',
        id: afterTask.id,
        name: afterTask.name,
        projectId: afterTask.project_id,
        projectName: parent?.name ?? '',
        color: parent?.color ?? '#3b82f6',
        beforeStart: directTask.expected_start,
        beforeEnd: directTask.expected_end,
        afterStart: afterTask.expected_start,
        afterEnd: afterTask.expected_end,
        shiftWorkingDays,
        requiredBy: afterTask.required_by,
        willMissDeadline,
        newlyLate: !wasLate && willMissDeadline,
      });
    }
  }

  // Evaluate availability & newly created resource conflict weeks (DEP-08)
  const allStarts = [
    ...beforePlan.projects.map((p) => p.expected_start),
    ...proposedPlan.projects.map((p) => p.expected_start),
    todayIso,
  ]
    .filter((d): d is string => Boolean(d))
    .sort();
  const allEnds = [
    ...beforePlan.projects.map((p) => p.expected_end),
    ...proposedPlan.projects.map((p) => p.expected_end),
    todayIso,
  ]
    .filter((d): d is string => Boolean(d))
    .sort();

  const weeks = generateWeeks(allStarts[0], allEnds[allEnds.length - 1]);
  const beforeCap = computeWeeklyCapacityMatrix(beforePlan, weeks);
  const afterCap = computeWeeklyCapacityMatrix(proposedPlan, weeks);

  const availabilityDeltas: PersonAvailabilityDelta[] = [];
  for (const person of proposedPlan.people) {
    const beforeAvail = computePersonAvailability(beforePlan, person.id, todayIso);
    const afterAvail = computePersonAvailability(proposedPlan, person.id, todayIso);
    const newConflictWeeks: string[] = [];

    const bRow = beforeCap.get(person.id);
    const aRow = afterCap.get(person.id);
    for (const w of weeks) {
      const bPct = bRow?.get(w.weekStart)?.weeklyPct ?? 0;
      const aPct = aRow?.get(w.weekStart)?.weeklyPct ?? 0;
      if (bPct <= 100 && aPct > 100) {
        newConflictWeeks.push(`${w.shortRange} (${aPct}%)`);
      }
    }

    const availabilityChanged = beforeAvail.availableDate !== afterAvail.availableDate;
    if (availabilityChanged || newConflictWeeks.length > 0) {
      availabilityDeltas.push({
        personId: person.id,
        personName: person.name,
        beforeAvailableDate: beforeAvail.availableDate,
        afterAvailableDate: afterAvail.availableDate,
        availabilityChanged,
        newConflictWeeks,
      });
    }
  }

  return {
    triggerLabel,
    directOnlyPlan,
    proposedPlan,
    shifts,
    availabilityDeltas,
    hasDownstreamChanges: shifts.length > 0,
  };
}
