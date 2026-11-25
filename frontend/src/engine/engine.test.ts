import { describe, expect, it } from 'vitest';
import type { PlanDocument } from '../types/plan';
import { computePersonAvailability, computeWeeklyCapacityMatrix } from './capacity';
import {
  addWorkingDays,
  generateWeeks,
  nextWorkingDayAfter,
  workingDaysInclusive,
  workingDaysSignedDiff,
} from './dates';
import { canAddDependency, previewDependencyCascade } from './dependencies';
import { computeScheduleMetrics, recalculateProjectRollups, updateProjectDates } from './rollup';

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
});

