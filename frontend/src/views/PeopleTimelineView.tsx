import { useMemo, useRef, useState } from 'react';
import { Crosshair, Sparkles, UserPlus, ZoomIn, ZoomOut } from 'lucide-react';
import {
  computePersonAvailability,
  resolveAssignmentWindow,
} from '../engine/capacity';
import {
  addCalendarDays,
  calendarDaysBetween,
  formatShortDate,
  generateWeeks,
  mondayOfWeek,
} from '../engine/dates';
import { usePlan } from '../store/PlanContext';

type ZoomMode = 'compact' | 'standard' | 'detailed';

const DAY_WIDTH_BY_ZOOM: Record<ZoomMode, number> = {
  compact: 10,
  standard: 16,
  detailed: 26,
};

const SIDEBAR_COL_WIDTH = 260;
const LANE_HEIGHT = 28;
const LANE_GAP = 6;
const ROW_PADDING_Y = 10;

interface PersonBar {
  id: string;
  kind: 'assignment' | 'leave' | 'tbd';
  label: string;
  sublabel?: string;
  color: string;
  start: string;
  end: string;
  allocationPct: number;
  projectId?: string;
  taskId?: string | null;
  lane: number;
}

function packBarsIntoLanes(bars: Omit<PersonBar, 'lane'>[]): {
  packed: PersonBar[];
  laneCount: number;
} {
  const sorted = [...bars].sort((a, b) =>
    a.start === b.start ? a.end.localeCompare(b.end) : a.start.localeCompare(b.start),
  );
  const laneEnds: string[] = [];
  const packed: PersonBar[] = [];

  for (const bar of sorted) {
    let assignedLane = -1;
    for (let i = 0; i < laneEnds.length; i += 1) {
      if (bar.start > laneEnds[i]) {
        assignedLane = i;
        laneEnds[i] = bar.end;
        break;
      }
    }
    if (assignedLane === -1) {
      assignedLane = laneEnds.length;
      laneEnds.push(bar.end);
    }
    packed.push({ ...bar, lane: assignedLane });
  }

  return { packed, laneCount: Math.max(1, laneEnds.length) };
}

export function PeopleTimelineView() {
  const {
    plan,
    todayIso,
    isPresentationMode,
    setSelectedEntity,
    setTeamDrawerOpen,
  } = usePlan();

  const [zoom, setZoom] = useState<ZoomMode>('standard');
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const dayPx = DAY_WIDTH_BY_ZOOM[zoom];

  const { timelineStart, weeks, totalWidth } = useMemo(() => {
    const allDates = [
      todayIso,
      ...plan.projects
        .filter((p) => !p.archived)
        .flatMap((p) => [p.expected_start, p.expected_end])
        .filter((d): d is string => Boolean(d)),
      ...plan.unavailabilities.flatMap((u) => [u.start_date, u.end_date]),
    ].sort();
    const minIso = addCalendarDays(mondayOfWeek(allDates[0]), -14);
    const maxIso = addCalendarDays(mondayOfWeek(allDates[allDates.length - 1]), 49);
    const wk = generateWeeks(minIso, maxIso);
    return {
      timelineStart: wk[0].weekStart,
      weeks: wk,
      totalWidth: wk.length * 7 * dayPx,
    };
  }, [plan.projects, plan.unavailabilities, todayIso, dayPx]);

  const monthSpans = useMemo(() => {
    const spans: { key: string; label: string; weekCount: number }[] = [];
    for (const w of weeks) {
      const last = spans[spans.length - 1];
      if (last && last.key === w.monthKey) last.weekCount += 1;
      else spans.push({ key: w.monthKey, label: w.monthLabel, weekCount: 1 });
    }
    return spans;
  }, [weeks]);

  const dateToX = (iso: string): number =>
    calendarDaysBetween(timelineStart, iso) * dayPx;

  const projectMap = useMemo(
    () => new Map(plan.projects.map((p) => [p.id, p])),
    [plan.projects],
  );
  const taskMap = useMemo(
    () => new Map(plan.tasks.map((t) => [t.id, t])),
    [plan.tasks],
  );

  // Unassigned TBD Demand Row
  const tbdRow = useMemo(() => {
    const rawBars: Omit<PersonBar, 'lane'>[] = [];
    for (const asg of plan.assignments) {
      if (asg.person_id) continue;
      const proj = projectMap.get(asg.project_id);
      const task = asg.task_id ? taskMap.get(asg.task_id) : undefined;
      if (!proj || proj.archived || proj.status === 'completed') continue;
      if (task && task.status === 'completed') continue;
      const win = resolveAssignmentWindow(asg, proj, task);
      if (!win) continue;
      rawBars.push({
        id: asg.id,
        kind: 'tbd',
        label: `${asg.placeholder_label || 'TBD'} · ${proj.name}`,
        sublabel: task?.name,
        color: proj.color,
        start: win.start,
        end: win.end,
        allocationPct: asg.allocation_pct ?? 100,
        projectId: proj.id,
        taskId: asg.task_id,
      });
    }
    if (rawBars.length === 0) return null;
    const { packed, laneCount } = packBarsIntoLanes(rawBars);
    const rowHeight =
      ROW_PADDING_Y * 2 + laneCount * LANE_HEIGHT + (laneCount - 1) * LANE_GAP;
    return {
      bars: packed,
      count: rawBars.length,
      rowHeight: Math.max(54, rowHeight),
    };
  }, [plan.assignments, projectMap, taskMap]);

  const personRows = useMemo(() => {
    return plan.people.map((person) => {
      const rawBars: Omit<PersonBar, 'lane'>[] = [];

      const personAssignments = plan.assignments.filter(
        (a) => a.person_id === person.id,
      );
      for (const asg of personAssignments) {
        const proj = projectMap.get(asg.project_id);
        const task = asg.task_id ? taskMap.get(asg.task_id) : undefined;
        if (!proj || proj.archived || proj.status === 'completed') continue;
        if (task && task.status === 'completed') continue;
        const win = resolveAssignmentWindow(asg, proj, task);
        if (!win) continue;
        rawBars.push({
          id: asg.id,
          kind: 'assignment',
          label: proj.name,
          sublabel: task?.name,
          color: proj.color,
          start: win.start,
          end: win.end,
          allocationPct: asg.allocation_pct ?? 100,
          projectId: proj.id,
          taskId: asg.task_id,
        });
      }

      for (const u of plan.unavailabilities) {
        if (u.person_id !== person.id) continue;
        rawBars.push({
          id: u.id,
          kind: 'leave',
          label: u.reason || 'Annual Leave',
          color: '#64748b',
          start: u.start_date,
          end: u.end_date,
          allocationPct: u.allocation_pct ?? 100,
        });
      }

      const { packed, laneCount } = packBarsIntoLanes(rawBars);
      const avail = computePersonAvailability(plan, person.id, todayIso);
      const rowHeight =
        ROW_PADDING_Y * 2 + laneCount * LANE_HEIGHT + (laneCount - 1) * LANE_GAP;

      return {
        person,
        bars: packed,
        laneCount,
        rowHeight: Math.max(54, rowHeight),
        avail,
      };
    });
  }, [plan, projectMap, taskMap, todayIso]);

  const scrollToToday = () => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({
      left: Math.max(0, dateToX(todayIso) - (el.clientWidth - SIDEBAR_COL_WIDTH) / 3),
      behavior: 'smooth',
    });
  };

  if (plan.people.length === 0 && !tbdRow) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="max-w-sm space-y-3">
          <h2 className="text-base font-semibold">No Team Members Added Yet</h2>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Add team members to view their assignments, overlapping workloads, and when
            each person becomes free.
          </p>
          {!isPresentationMode && (
            <button
              type="button"
              onClick={() => setTeamDrawerOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
            >
              <UserPlus className="w-4 h-4" aria-hidden="true" />
              Manage Team
            </button>
          )}
        </div>
      </div>
    );
  }

  const todayX = dateToX(todayIso) + dayPx * 0.5;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div
        className="px-4 py-2 border-b flex items-center justify-between gap-2 text-xs print:hidden"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-default)',
        }}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={scrollToToday}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border font-medium hover:bg-slate-500/10 cursor-pointer"
            style={{ borderColor: 'var(--border-default)' }}
          >
            <Crosshair className="w-3.5 h-3.5 text-red-500" aria-hidden="true" />
            Today
          </button>

          <div
            className="inline-flex items-center rounded-md border overflow-hidden"
            style={{ borderColor: 'var(--border-default)' }}
          >
            <button
              type="button"
              onClick={() =>
                setZoom((z) => (z === 'detailed' ? 'standard' : 'compact'))
              }
              disabled={zoom === 'compact'}
              aria-label="Zoom out"
              className="p-1.5 disabled:opacity-35 hover:bg-slate-500/10 cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <span className="px-2 text-[11px] font-medium capitalize">{zoom}</span>
            <button
              type="button"
              onClick={() =>
                setZoom((z) => (z === 'compact' ? 'standard' : 'detailed'))
              }
              disabled={zoom === 'detailed'}
              aria-label="Zoom in"
              className="p-1.5 disabled:opacity-35 hover:bg-slate-500/10 cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {!isPresentationMode && (
          <button
            type="button"
            onClick={() => setTeamDrawerOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium hover:bg-slate-500/10 cursor-pointer"
            style={{ borderColor: 'var(--border-default)' }}
          >
            <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
            Manage Team &amp; Leave
          </button>
        )}
      </div>

      {/* Scrollable People Timeline */}
      <div ref={scrollerRef} className="flex-1 overflow-auto relative">
        <div style={{ width: SIDEBAR_COL_WIDTH + totalWidth, minHeight: '100%' }}>
          {/* Sticky Header */}
          <div
            className="sticky top-0 z-30 flex border-b"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-default)',
            }}
          >
            <div
              className="sticky left-0 z-40 shrink-0 px-3 flex items-center justify-between border-r font-semibold text-xs shadow-[2px_0_6px_-2px_rgba(15,23,42,0.08)]"
              style={{
                width: SIDEBAR_COL_WIDTH,
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-default)',
              }}
            >
              <span>Team Member</span>
              <span className="text-[11px] font-normal" style={{ color: 'var(--text-muted)' }}>
                Next Free
              </span>
            </div>

            <div style={{ width: totalWidth }}>
              <div
                className="flex border-b text-[11px] font-semibold"
                style={{ borderColor: 'var(--border-default)' }}
              >
                {monthSpans.map((m) => (
                  <div
                    key={m.key}
                    style={{
                      width: m.weekCount * 7 * dayPx,
                      borderColor: 'var(--border-default)',
                    }}
                    className="px-2 py-1 border-r truncate"
                  >
                    {m.label}
                  </div>
                ))}
              </div>
              <div className="flex text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                {weeks.map((w) => {
                  const isCurrentWeek =
                    todayIso >= w.weekStart && todayIso <= w.sundayEnd;
                  return (
                    <div
                      key={w.weekStart}
                      style={{
                        width: 7 * dayPx,
                        borderColor: 'var(--border-default)',
                      }}
                      className={`px-1.5 py-1 border-r flex items-center justify-between ${
                        isCurrentWeek
                          ? 'bg-blue-500/10 font-semibold text-blue-600 dark:text-blue-400'
                          : ''
                      }`}
                    >
                      <span>{w.weekLabel}</span>
                      {zoom !== 'compact' && (
                        <span className="text-[10px] opacity-75">
                          {formatShortDate(w.weekStart)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Rows */}
          <div className="relative">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-red-500/80"
              style={{ left: SIDEBAR_COL_WIDTH + todayX }}
            />

            {/* Unassigned TBD Demand Row */}
            {tbdRow && (
              <div
                style={{
                  height: tbdRow.rowHeight,
                }}
                className="flex bg-amber-500/5"
              >
                <div
                  style={{
                    width: SIDEBAR_COL_WIDTH,
                    backgroundColor: 'var(--bg-surface)',
                    backgroundImage:
                      'linear-gradient(rgba(245, 158, 11, 0.05), rgba(245, 158, 11, 0.05))',
                    borderColor: 'var(--border-default)',
                  }}
                  className="sticky left-0 z-20 shrink-0 px-3 border-r border-b flex items-center justify-between gap-2 text-xs shadow-[2px_0_6px_-2px_rgba(15,23,42,0.08)]"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>Unassigned (TBD)</span>
                    </div>
                    <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      Click bar to match team
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded border border-dashed border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[11px] font-semibold">
                    {tbdRow.count} open
                  </span>
                </div>

                <div
                  className="relative isolate z-0 border-b"
                  style={{
                    width: totalWidth,
                    height: tbdRow.rowHeight,
                    borderColor: 'var(--border-default)',
                  }}
                >
                  <div className="absolute inset-0 flex pointer-events-none">
                    {weeks.map((w) => (
                      <div
                        key={w.weekStart}
                        style={{
                          width: 7 * dayPx,
                          borderColor: 'var(--border-default)',
                        }}
                        className="h-full border-r relative"
                      >
                        <div
                          className="absolute top-0 bottom-0 right-0 bg-slate-500/6"
                          style={{ width: 2 * dayPx }}
                        />
                      </div>
                    ))}
                  </div>

                  {tbdRow.bars.map((bar) => {
                    const left = dateToX(bar.start);
                    const width = Math.max(
                      dayPx,
                      (calendarDaysBetween(bar.start, bar.end) + 1) * dayPx,
                    );
                    const top = ROW_PADDING_Y + bar.lane * (LANE_HEIGHT + LANE_GAP);
                    return (
                      <button
                        key={bar.id}
                        type="button"
                        onClick={() => {
                          if (isPresentationMode || !bar.projectId) return;
                          setSelectedEntity(
                            bar.taskId
                              ? {
                                  type: 'task',
                                  id: bar.taskId,
                                  projectId: bar.projectId,
                                }
                              : {
                                  type: 'project',
                                  id: bar.projectId,
                                  projectId: bar.projectId,
                                },
                          );
                        }}
                        title={`${bar.label}${bar.sublabel ? ` → ${bar.sublabel}` : ''}\n${formatShortDate(bar.start)} – ${formatShortDate(bar.end)} (${bar.allocationPct}% needed)`}
                        style={{
                          left,
                          width,
                          top,
                          height: LANE_HEIGHT,
                          borderColor: bar.color,
                          backgroundColor: `${bar.color}22`,
                        }}
                        className="absolute z-15 rounded-md border-2 border-dashed px-2 flex items-center justify-between gap-1 text-[11px] font-semibold cursor-pointer overflow-hidden"
                      >
                        <span className="truncate">{bar.label}</span>
                        {width > 75 && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/25 text-amber-800 dark:text-amber-200 shrink-0">
                            {bar.allocationPct}%
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {personRows.map(({ person, bars, rowHeight, avail }) => {
              const availX = Math.max(0, dateToX(avail.availableDate));
              const hasConcurrentLanes = bars.some((b) => b.lane > 0);

              return (
                <div
                  key={person.id}
                  style={{
                    height: rowHeight,
                  }}
                  className="flex"
                >
                  <div
                    style={{
                      width: SIDEBAR_COL_WIDTH,
                      backgroundColor: 'var(--bg-surface)',
                      borderColor: 'var(--border-default)',
                    }}
                    className="sticky left-0 z-20 shrink-0 px-3 border-r border-b flex items-center justify-between gap-2 text-xs shadow-[2px_0_6px_-2px_rgba(15,23,42,0.08)]"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{person.name}</div>
                      {hasConcurrentLanes && (
                        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          Concurrent assignments
                        </div>
                      )}
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-medium shrink-0 ${
                        avail.isAvailableNow
                          ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
                          : 'bg-blue-500/12 text-blue-600 dark:text-blue-400'
                      }`}
                    >
                      {avail.isAvailableNow
                        ? `Now (${avail.freePct}%)`
                        : formatShortDate(avail.availableDate)}
                    </span>
                  </div>

                  <div
                    className="relative isolate z-0 border-b"
                    style={{
                      width: totalWidth,
                      height: rowHeight,
                      borderColor: 'var(--border-default)',
                    }}
                  >
                    <div className="absolute inset-0 flex pointer-events-none">
                      {weeks.map((w) => (
                        <div
                          key={w.weekStart}
                          style={{
                            width: 7 * dayPx,
                            borderColor: 'var(--border-default)',
                          }}
                          className="h-full border-r relative"
                        >
                          <div
                            className="absolute top-0 bottom-0 right-0 bg-slate-500/6"
                            style={{ width: 2 * dayPx }}
                          />
                        </div>
                      ))}
                    </div>

                    {availX < totalWidth - 80 && (
                      <div
                        className="pointer-events-none absolute top-1.5 px-2 py-0.5 rounded border border-dashed border-emerald-500/35 bg-emerald-500/6 text-[10px] text-emerald-700 dark:text-emerald-400"
                        style={{ left: availX + 4 }}
                      >
                        Available ({avail.freePct}% free) →
                      </div>
                    )}

                    {bars.map((bar) => {
                      const left = dateToX(bar.start);
                      const width = Math.max(
                        dayPx,
                        (calendarDaysBetween(bar.start, bar.end) + 1) * dayPx,
                      );
                      const top = ROW_PADDING_Y + bar.lane * (LANE_HEIGHT + LANE_GAP);

                      if (bar.kind === 'leave') {
                        return (
                          <div
                            key={bar.id}
                            title={`${bar.label}: ${formatShortDate(bar.start)} – ${formatShortDate(bar.end)}`}
                            style={{
                              left,
                              width,
                              top,
                              height: LANE_HEIGHT,
                            }}
                            className="absolute z-15 rounded-md border border-slate-400/60 bg-hatched-leave px-2 flex items-center text-[11px] font-medium truncate"
                          >
                            <span className="truncate">{bar.label}</span>
                          </div>
                        );
                      }

                      return (
                        <button
                          key={bar.id}
                          type="button"
                          onClick={() => {
                            if (isPresentationMode || !bar.projectId) return;
                            setSelectedEntity(
                              bar.taskId
                                ? {
                                    type: 'task',
                                    id: bar.taskId,
                                    projectId: bar.projectId,
                                  }
                                : {
                                    type: 'project',
                                    id: bar.projectId,
                                    projectId: bar.projectId,
                                  },
                            );
                          }}
                          title={`${bar.label}${bar.sublabel ? ` → ${bar.sublabel}` : ''}\n${formatShortDate(bar.start)} – ${formatShortDate(bar.end)} (${bar.allocationPct}%)`}
                          style={{
                            left,
                            width,
                            top,
                            height: LANE_HEIGHT,
                            backgroundColor: bar.color,
                          }}
                          className={`absolute z-15 rounded-md text-white px-2 flex items-center justify-between gap-1 text-[11px] font-medium shadow-2xs overflow-hidden ${
                            isPresentationMode
                              ? 'cursor-default'
                              : 'hover:brightness-105 cursor-pointer'
                          }`}
                        >
                          <span className="truncate">
                            {bar.label}
                            {bar.sublabel ? ` · ${bar.sublabel}` : ''}
                          </span>
                          {width > 75 && (
                            <span className="text-[10px] bg-black/20 px-1.5 py-0.2 rounded shrink-0">
                              {bar.allocationPct}%
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
