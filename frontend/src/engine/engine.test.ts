import { describe, expect, it } from 'vitest';
import type { PlanDocument } from '../types/plan';
import {
  computePersonAvailability,
  computeTbdWeeklyDemand,
  computeWeeklyCapacityMatrix,
  rankPeopleForSlot,
} from './capacity';
import {
  addWorkingDays,
  generateWeeks,
  nextWorkingDayAfter,
  workingDaysInclusive,
  workingDaysSignedDiff,
} from './dates';
import { canAddDependency, previewDependencyCascade } from './dependencies';
import { comparePlans } from './diff';
import {
  reorderProjectsInPlan,
  reorderTasksInPlan,
  sortProjects,
} from './ordering';
import {
  computeScheduleMetrics,
  recalculateProjectRollups,
  scheduleProjectFromBacklog,
  unscheduleProjectToBacklog,
  updateProjectDates,
} from './rollup';

function basePlan(): PlanDocument {
  return {
    people: [
      { id: 'p-alice', name: 'Alice', sort_order: 0 },
      { id: 'p-ben', name: 'Ben', sort_order: 1 },
    ],
    projects: [
      {
        id: 'proj-a',
        name: 'Project A',
        description: '',
        expected_start: '2026-02-02', // Mon
        actual_start: null,
        expected_end: '2026-02-13',   // Fri (10 working days)
        original_expected_end: '2026-02-13',
        required_by: '2026-03-06',
        actual_end: null,
        percent_complete: 50,
        auto_progress: false,
        status: 'in_progress',
        priority: 'high',
        color: '#2563eb',
        notes: '',
        sort_order: 0,
      },
      {
        id: 'proj-b',
        name: 'Project B',
        description: '',
        expected_start: '2026-02-16', // Mon after Feb 13
        actual_start: null,
        expected_end: '2026-02-27',   // Fri (10 working days)
        original_expected_end: '2026-02-27',
        required_by: '2026-03-06',    // Will miss if shifted +2 weeks to Mar 13!
        actual_end: null,
        percent_complete: 0,
        auto_progress: false,
        status: 'planned',
        priority: 'medium',
        color: '#dc2626',
        notes: '',
        sort_order: 1,
      },
      {
        id: 'proj-c',
        name: 'Project C',
        description: '',
        expected_start: '2026-03-02', // Mon after Feb 27
        actual_start: null,
        expected_end: '2026-03-13',
        original_expected_end: '2026-03-13',
        required_by: null,
        actual_end: null,
        percent_complete: 0,
        auto_progress: false,
        status: 'planned',
        priority: 'low',
        color: '#059669',
        notes: '',
        sort_order: 2,
      },
    ],
    tasks: [],
    assignments: [
      {
        id: 'asg-1',
        person_id: 'p-alice',
        project_id: 'proj-a',
        task_id: null,
        allocation_pct: null, // Blank -> treated as 100%!
        start_date: null,
        end_date: null,
      },
      {
        id: 'asg-2',
        person_id: 'p-alice',
        project_id: 'proj-b',
        task_id: null,
        allocation_pct: 100,
        start_date: null,
        end_date: null,
      },
    ],
    unavailabilities: [],
    dependencies: [
      { id: 'd1', from_type: 'project', from_id: 'proj-a', to_type: 'project', to_id: 'proj-b' },
      { id: 'd2', from_type: 'project', from_id: 'proj-b', to_type: 'project', to_id: 'proj-c' },
    ],
  };
}

describe('working-day date engine', () => {
  it('skips weekends accurately', () => {
    expect(nextWorkingDayAfter('2026-02-13')).toBe('2026-02-16'); // Fri -> Mon
    expect(workingDaysInclusive('2026-02-02', '2026-02-13')).toBe(10);
    expect(addWorkingDays('2026-02-13', 10)).toBe('2026-02-27'); // +2 working weeks
    expect(workingDaysSignedDiff('2026-02-13', '2026-02-27')).toBe(10);
  });
});

describe('dependency cycle detection & cascade preview (Section 4)', () => {
  it('blocks circular dependencies (DEP-07)', () => {
    const plan = basePlan();
    const res = canAddDependency(plan, 'project', 'proj-c', 'project', 'proj-a');
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('Circular dependency');
  });

  it('propagates +2 week extension across Project B & C and flags missed deadline', () => {
    const before = basePlan();
    // Extend Project A by 2 weeks (from Feb 13 to Feb 27)
    const edited = updateProjectDates(before, 'proj-a', '2026-02-02', '2026-02-27');
    const preview = previewDependencyCascade(before, edited, 'Project A', '2026-02-02');

    expect(preview.hasDownstreamChanges).toBe(true);
    expect(preview.shifts).toHaveLength(2);

    const bShift = preview.shifts.find((s) => s.id === 'proj-b')!;
    expect(bShift.afterStart).toBe('2026-03-02');
    expect(bShift.afterEnd).toBe('2026-03-13');
    expect(bShift.shiftWorkingDays).toBe(10);
    expect(bShift.newlyLate).toBe(true); // Required by Mar 06 < Mar 13!

    const cShift = preview.shifts.find((s) => s.id === 'proj-c')!;
    expect(cShift.afterStart).toBe('2026-03-16');
    expect(cShift.afterEnd).toBe('2026-03-27');

    // Alice's next available date moved from Mar 02 to Mar 16
    const aliceDelta = preview.availabilityDeltas.find((d) => d.personId === 'p-alice')!;
    expect(aliceDelta.beforeAvailableDate).toBe('2026-03-02');
    expect(aliceDelta.afterAvailableDate).toBe('2026-03-16');
  });
});

describe('capacity, mid-week handoff, and rollup rules', () => {
  it('treats blank allocation as 100% and handles mid-week handoffs without false conflict', () => {
    const plan = basePlan();
    // Project A ends Wed Feb 11, Project B starts Thu Feb 12
    plan.projects[0].expected_end = '2026-02-11';
    plan.projects[1].expected_start = '2026-02-12';
    plan.projects[1].expected_end = '2026-02-20';

    const weeks = generateWeeks('2026-02-09', '2026-02-13');
    const matrix = computeWeeklyCapacityMatrix(plan, weeks);
    const cell = matrix.get('p-alice')!.get('2026-02-09')!;
    expect(cell.weeklyPct).toBe(100);
    expect(cell.hasDailySpike).toBe(false);
    expect(cell.level).toBe('full');

    const avail = computePersonAvailability(plan, 'p-alice', '2026-02-09');
    expect(avail.availableDate).toBe('2026-02-23');
  });

  it('rolls up subtask dates and duration-weighted progress automatically', () => {
    const plan = basePlan();
    plan.projects[0].auto_progress = true;
    plan.tasks = [
      {
        id: 't1',
        project_id: 'proj-a',
        name: 'Phase 1',
        description: '',
        expected_start: '2026-02-02',
        actual_start: null,
        expected_end: '2026-02-06', // 5 wd @ 100%
        original_expected_end: '2026-02-06',
        required_by: null,
        actual_end: null,
        percent_complete: 100,
        status: 'completed',
        priority: 'medium',
        notes: '',
        sort_order: 0,
      },
      {
        id: 't2',
        project_id: 'proj-a',
        name: 'Phase 2',
        description: '',
        expected_start: '2026-02-09',
        actual_start: null,
        expected_end: '2026-02-20', // 10 wd @ 25%
        original_expected_end: '2026-02-20',
        required_by: null,
        actual_end: null,
        percent_complete: 25,
        status: 'in_progress',
        priority: 'medium',
        notes: '',
        sort_order: 1,
      },
    ];

    const rolled = recalculateProjectRollups(plan);
    const pa = rolled.projects[0];
    expect(pa.expected_start).toBe('2026-02-02');
    expect(pa.expected_end).toBe('2026-02-20');
    // (5*100 + 10*25) / 15 = 750 / 15 = 50%
    expect(pa.percent_complete).toBe(50);

    const metrics = computeScheduleMetrics(pa);
    expect(metrics.slipDays).toBe(5); // Original Feb 13 -> Feb 20 = +5 wd
  });

  it('prevents intra-project double counting and accounts for annual leave', () => {
    const plan = basePlan();
    plan.tasks = [
      {
        id: 't-sub',
        project_id: 'proj-a',
        name: 'Subtask',
        description: '',
        expected_start: '2026-02-02',
        actual_start: null,
        expected_end: '2026-02-06',
        original_expected_end: '2026-02-06',
        required_by: null,
        actual_end: null,
        percent_complete: 0,
        status: 'in_progress',
        priority: 'high',
        notes: '',
        sort_order: 0,
      },
    ];
    // Alice has both a blanket project assignment (100%) AND a task assignment (50%) on proj-a
    plan.assignments.push({
      id: 'asg-task',
      person_id: 'p-alice',
      project_id: 'proj-a',
      task_id: 't-sub',
      allocation_pct: 50,
      start_date: null,
      end_date: null,
    });
    // Ben is on Annual Leave for W1
    plan.unavailabilities.push({
      id: 'leave-ben',
      person_id: 'p-ben',
      start_date: '2026-02-02',
      end_date: '2026-02-06',
      reason: 'Annual Leave',
      allocation_pct: 100,
    });

    const weeks = generateWeeks('2026-02-02', '2026-02-06');
    const matrix = computeWeeklyCapacityMatrix(plan, weeks);

    // Alice should be 50% (task-level overrides blanket project-level on those days), NOT 150%!
    expect(matrix.get('p-alice')!.get('2026-02-02')!.weeklyPct).toBe(50);
    // Ben should be 100% due to Annual Leave
    expect(matrix.get('p-ben')!.get('2026-02-02')!.weeklyPct).toBe(100);
  });

  it('tracks TBD placeholder demand and ranks best-fitting people ("Who fits?")', () => {
    const plan = basePlan();
    // Alice is at 100% on proj-a during Feb 02 - Feb 13; Ben has 0% assignments!
    plan.assignments.push({
      id: 'asg-tbd',
      person_id: null,
      placeholder_label: 'TBD — QA Lead',
      project_id: 'proj-a',
      task_id: null,
      allocation_pct: 50,
      start_date: null,
      end_date: null,
    });

    const weeks = generateWeeks('2026-02-02', '2026-02-13');
    const tbdDemand = computeTbdWeeklyDemand(plan, weeks);
    expect(tbdDemand.get('2026-02-02')!.weeklyPct).toBe(50);

    const ranked = rankPeopleForSlot(plan, '2026-02-02', '2026-02-13', 50);
    expect(ranked[0].personId).toBe('p-ben');
    expect(ranked[0].fitStatus).toBe('full');
    expect(ranked[0].avgFreePct).toBe(100);
    expect(ranked[0].peakWeeklyAfterPct).toBe(50);

    expect(ranked[1].personId).toBe('p-alice');
    expect(ranked[1].fitStatus).toBe('conflict');
    expect(ranked[1].peakWeeklyAfterPct).toBe(150);
  });

  it('supports dateless backlog projects with zero capacity impact and schedules them using estimated_days', () => {
    const plan = basePlan();
    // Move Project B (10 working days) into the unscheduled backlog
    const withBacklog = unscheduleProjectToBacklog(plan, 'proj-b');
    const bUnscheduled = withBacklog.projects.find((p) => p.id === 'proj-b')!;
    expect(bUnscheduled.status).toBe('backlog');
    expect(bUnscheduled.expected_start).toBeNull();
    expect(bUnscheduled.expected_end).toBeNull();
    expect(bUnscheduled.estimated_days).toBe(10);

    // Confirm Alice has 0% load during Feb 16–27 while Project B is unscheduled in backlog
    const weeks = generateWeeks('2026-02-16', '2026-02-27');
    const matrix = computeWeeklyCapacityMatrix(withBacklog, weeks);
    expect(matrix.get('p-alice')!.get('2026-02-16')!.weeklyPct).toBe(0);

    // Now schedule Project B onto Monday Mar 09 for 15 working days (3 weeks)
    const scheduled = scheduleProjectFromBacklog(withBacklog, 'proj-b', '2026-03-09', 15);
    const bScheduled = scheduled.projects.find((p) => p.id === 'proj-b')!;
    expect(bScheduled.status).toBe('planned');
    expect(bScheduled.expected_start).toBe('2026-03-09');
    expect(bScheduled.expected_end).toBe('2026-03-27'); // 3 working weeks
  });
});

describe('plan checkpoint comparison & ghost bar diff engine', () => {
  it('computes schedule slips, added/removed projects, reassignments, and ghost bars', () => {
    const baseline = basePlan();
    const current = structuredClone(baseline);

    // 1. Slip Project A by +5 working days (Feb 13 -> Feb 20) and reassign Alice 100% -> 50% + add Ben 50%
    current.projects[0].expected_end = '2026-02-20';
    current.assignments[0].allocation_pct = 50;
    current.assignments.push({
      id: 'asg-ben-a',
      person_id: 'p-ben',
      project_id: 'proj-a',
      task_id: null,
      allocation_pct: 50,
      start_date: null,
      end_date: null,
    });

    // 2. Complete Project C
    current.projects[2].status = 'completed';
    current.projects[2].percent_complete = 100;

    // 3. Add new Project D
    current.projects.push({
      id: 'proj-d',
      name: 'Project D',
      description: '',
      expected_start: '2026-03-16',
      actual_start: null,
      expected_end: '2026-03-27',
      estimated_days: 10,
      original_expected_end: '2026-03-27',
      required_by: null,
      actual_end: null,
      percent_complete: 0,
      auto_progress: false,
      status: 'planned',
      priority: 'medium',
      color: '#d97706',
      notes: '',
      sort_order: 3,
    });

    const diff = comparePlans(baseline, current);
    expect(diff.summary.slippedCount).toBe(1);
    expect(diff.summary.addedCount).toBe(1);
    expect(diff.summary.completedSinceCount).toBe(1);
    expect(diff.summary.reassignedCount).toBe(1);

    // Verify ghost bar for Project A preserves baseline dates and +5 wd slip
    expect(diff.ghostBars['project:proj-a']).toEqual({
      start: '2026-02-02',
      end: '2026-02-13',
      endShiftDays: 5,
    });
    expect(diff.addedEntityKeys).toContain('project:proj-d');

    const projADiff = diff.projectDiffs.find((d) => d.projectId === 'proj-a')!;
    expect(projADiff.endShiftDays).toBe(5);
    expect(projADiff.addedPeople).toContain('Ben (50%)');
    expect(projADiff.allocationChanges).toEqual([
      { name: 'Alice', beforePct: 100, afterPct: 50 },
    ]);
  });

  it('reorders projects and intra-project phases without cross-project phase moves or mutating manual order on sort lenses', () => {
    const plan = basePlan();
    plan.tasks = [
      {
        id: 't-a1',
        project_id: 'proj-a',
        name: 'Phase 1',
        description: '',
        expected_start: '2026-02-02',
        actual_start: null,
        expected_end: '2026-02-06',
        original_expected_end: '2026-02-06',
        required_by: null,
        actual_end: null,
        percent_complete: 100,
        status: 'completed',
        priority: 'medium',
        notes: '',
        sort_order: 0,
      },
      {
        id: 't-a2',
        project_id: 'proj-a',
        name: 'Phase 2',
        description: '',
        expected_start: '2026-02-09',
        actual_start: null,
        expected_end: '2026-02-13',
        original_expected_end: '2026-02-13',
        required_by: null,
        actual_end: null,
        percent_complete: 0,
        status: 'planned',
        priority: 'medium',
        notes: '',
        sort_order: 1,
      },
      {
        id: 't-b1',
        project_id: 'proj-b',
        name: 'Other Project Phase',
        description: '',
        expected_start: '2026-02-16',
        actual_start: null,
        expected_end: '2026-02-27',
        original_expected_end: '2026-02-27',
        required_by: null,
        actual_end: null,
        percent_complete: 0,
        status: 'planned',
        priority: 'medium',
        notes: '',
        sort_order: 0,
      },
    ];

    // Move proj-c before proj-a
    const reordered = reorderProjectsInPlan(plan, 'proj-c', 'proj-a', 'before');
    expect(reordered.projects.map((p) => [p.id, p.sort_order])).toEqual([
      ['proj-c', 0],
      ['proj-a', 1],
      ['proj-b', 2],
    ]);

    // View-only sort by start date returns chronological order without mutating sort_order
    const byStart = sortProjects(reordered.projects, 'start');
    expect(byStart.map((p) => p.id)).toEqual(['proj-a', 'proj-b', 'proj-c']);
    expect(sortProjects(reordered.projects, 'manual').map((p) => p.id)).toEqual([
      'proj-c',
      'proj-a',
      'proj-b',
    ]);

    // Reorder phase within proj-a works; moving into proj-b is rejected
    const tasksSwapped = reorderTasksInPlan(reordered, 't-a2', 't-a1', 'before');
    expect(
      tasksSwapped.tasks
        .filter((t) => t.project_id === 'proj-a')
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((t) => t.id),
    ).toEqual(['t-a2', 't-a1']);
    const crossMove = reorderTasksInPlan(tasksSwapped, 't-a2', 't-b1', 'after');
    expect(crossMove).toBe(tasksSwapped);
  });
});

