import React, { useMemo, useRef, useState } from 'react';
import {
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Diamond,
  Filter,
  GitBranch,
  GripVertical,
  Inbox,
  Plus,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  addCalendarDays,
  addWorkingDays,
  calendarDaysBetween,
  formatDurationLabel,
  formatShortDate,
  formatSignedWorkingDays,
  generateWeeks,
  mondayOfWeek,
  snapToWorkingDay,
} from '../engine/dates';
import { findViolatedDependencyIds } from '../engine/dependencies';
import {
  computeScheduleMetrics,
  updateProjectDates,
  updateTaskDates,
} from '../engine/rollup';
import { usePlan } from '../store/PlanContext';
import type { EntityType, Project, ProjectStatus, Task } from '../types/plan';
import { HealthDot, PriorityBadge, StatusPill } from '../components/ui/StatusBadges';

type ZoomMode = 'compact' | 'standard' | 'detailed';

const DAY_WIDTH_BY_ZOOM: Record<ZoomMode, number> = {
  compact: 10,
  standard: 16,
  detailed: 26,
};

const ROW_HEIGHT = 40;
const ROW_HEIGHT_COMPARE = 48;
const SIDEBAR_COL_WIDTH = 280;

interface TimelineRow {
  key: string;
  entityType: EntityType;
  id: string;
  projectId: string;
  name: string;
  color: string;
  expectedStart: string;
  expectedEnd: string;
  originalExpectedEnd: string | null;
  requiredBy: string | null;
  percentComplete: number;
  status: ProjectStatus;
  hasChildren: boolean;
  isExpanded: boolean;
  assigneeNames: string[];
  tbdCount: number;
  raw: Project | Task;
}

interface DragState {
  rowKey: string;
  entityType: EntityType;
  id: string;
  name: string;
  mode: 'move' | 'resize-start' | 'resize-end';
  startClientX: number;
  origStart: string;
  origEnd: string;
  deltaWorkingDays: number;
}

export function ProjectTimelineView() {
  const {
    plan,
    todayIso,
    isPresentationMode,
    activeBaseline,
    comparisonDiff,
    selectedEntity,
    setSelectedEntity,
    commitWithCascadeCheck,
    createProject,
    scheduleBacklogProject,
    addTask,
    addDependency,
    loadSamplePlan,
  } = usePlan();

  const [zoom, setZoom] = useState<ZoomMode>('standard');
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [personFilter, setPersonFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [backlogTrayOpen, setBacklogTrayOpen] = useState(true);
  const [dropHoverWeek, setDropHoverWeek] = useState<string | null>(null);
  const [linkingFrom, setLinkingFrom] = useState<{
    type: EntityType;
    id: string;
    name: string;
  } | null>(null);
  const [linkBannerError, setLinkBannerError] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const dayPx = DAY_WIDTH_BY_ZOOM[zoom];
  const activeRowHeight = activeBaseline ? ROW_HEIGHT_COMPARE : ROW_HEIGHT;

  const peopleById = useMemo(
    () => new Map(plan.people.map((p) => [p.id, p.name])),
    [plan.people],
  );

  // Separate unscheduled backlog projects from scheduled Gantt rows
  const backlogProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return plan.projects.filter((p) => {
      const isUnscheduled = !p.expected_start || !p.expected_end;
      if (!isUnscheduled) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (personFilter !== 'all') {
        const asgs = plan.assignments.filter((a) => a.project_id === p.id);
        if (personFilter === '__tbd__') {
          if (!asgs.some((a) => !a.person_id)) return false;
        } else if (!asgs.some((a) => a.person_id === personFilter)) {
          return false;
        }
      }
      return true;
    });
  }, [plan.projects, plan.assignments, searchQuery, personFilter]);

  const rows = useMemo<TimelineRow[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    const out: TimelineRow[] = [];

    for (const proj of plan.projects) {
      if (!proj.expected_start || !proj.expected_end) continue;
      if (statusFilter !== 'all' && proj.status !== statusFilter) continue;

      const projAssignments = plan.assignments.filter((a) => a.project_id === proj.id);
      if (personFilter === '__tbd__') {
        if (!projAssignments.some((a) => !a.person_id)) continue;
      } else if (
        personFilter !== 'all' &&
        !projAssignments.some((a) => a.person_id === personFilter)
      ) {
        continue;
      }

      const childTasks = plan.tasks.filter((t) => t.project_id === proj.id);
      const scheduledTasks = childTasks.filter(
        (t): t is Task & { expected_start: string; expected_end: string } =>
          Boolean(t.expected_start && t.expected_end),
      );
      const matchesSearch =
        !q ||
        proj.name.toLowerCase().includes(q) ||
        childTasks.some((t) => t.name.toLowerCase().includes(q));
      if (!matchesSearch) continue;

      const projPeople = Array.from(
        new Set(
          projAssignments
            .map((a) =>
              a.person_id
                ? peopleById.get(a.person_id)
                : a.placeholder_label || 'TBD',
            )
            .filter((x): x is string => Boolean(x)),
        ),
      );
      const projTbdCount = projAssignments.filter((a) => !a.person_id).length;

      const isExpanded = !collapsedProjects.has(proj.id);
      out.push({
        key: `project:${proj.id}`,
        entityType: 'project',
        id: proj.id,
        projectId: proj.id,
        name: proj.name,
        color: proj.color,
        expectedStart: proj.expected_start,
        expectedEnd: proj.expected_end,
        originalExpectedEnd: proj.original_expected_end,
        requiredBy: proj.required_by,
        percentComplete: proj.percent_complete,
        status: proj.status,
        hasChildren: scheduledTasks.length > 0,
        isExpanded,
        assigneeNames: projPeople,
        tbdCount: projTbdCount,
        raw: proj,
      });

      if (isExpanded) {
        for (const task of scheduledTasks) {
          const taskAsgs = plan.assignments.filter((a) => a.task_id === task.id);
          const taskPeople = Array.from(
            new Set(
              taskAsgs
                .map((a) =>
                  a.person_id
                    ? peopleById.get(a.person_id)
                    : a.placeholder_label || 'TBD',
                )
                .filter((x): x is string => Boolean(x)),
            ),
          );
          out.push({
            key: `task:${task.id}`,
            entityType: 'task',
            id: task.id,
            projectId: proj.id,
            name: task.name,
            color: proj.color,
            expectedStart: task.expected_start,
            expectedEnd: task.expected_end,
            originalExpectedEnd: task.original_expected_end,
            requiredBy: task.required_by,
            percentComplete: task.percent_complete,
            status: task.status,
            hasChildren: false,
            isExpanded: false,
            assigneeNames: taskPeople,
            tbdCount: taskAsgs.filter((a) => !a.person_id).length,
            raw: task,
          });
        }
      }
    }
    return out;
  }, [
    plan.projects,
    plan.tasks,
    plan.assignments,
    peopleById,
    collapsedProjects,
    statusFilter,
    personFilter,
    searchQuery,
  ]);

  const { timelineStart, weeks, totalWidth } = useMemo(() => {
    const ghostDates = comparisonDiff
      ? Object.values(comparisonDiff.ghostBars).flatMap((g) => [g.start, g.end])
      : [];
    const allDates = [
      todayIso,
      ...ghostDates,
      ...plan.projects
        .flatMap((p) => [p.expected_start, p.expected_end, p.required_by])
        .filter((d): d is string => Boolean(d)),
    ].sort();
    const minIso = addCalendarDays(mondayOfWeek(allDates[0]), -14);
    const maxIso = addCalendarDays(mondayOfWeek(allDates[allDates.length - 1]), 49);
    const wk = generateWeeks(minIso, maxIso);
    return {
      timelineStart: wk[0].weekStart,
      weeks: wk,
      totalWidth: wk.length * 7 * dayPx,
    };
  }, [plan.projects, comparisonDiff, todayIso, dayPx]);

  const monthSpans = useMemo(() => {
    const spans: { key: string; label: string; weekCount: number }[] = [];
    for (const w of weeks) {
      const last = spans[spans.length - 1];
      if (last && last.key === w.monthKey) {
        last.weekCount += 1;
      } else {
        spans.push({ key: w.monthKey, label: w.monthLabel, weekCount: 1 });
      }
    }
    return spans;
  }, [weeks]);

  const dateToX = (iso: string): number =>
    calendarDaysBetween(timelineStart, iso) * dayPx;

  const violatedDeps = useMemo(() => findViolatedDependencyIds(plan), [plan]);

  const previewRowDates = (row: TimelineRow): { start: string; end: string } => {
    if (!dragState || dragState.rowKey !== row.key || dragState.deltaWorkingDays === 0) {
      return { start: row.expectedStart, end: row.expectedEnd };
    }
    if (dragState.mode === 'move') {
      return {
        start: addWorkingDays(dragState.origStart, dragState.deltaWorkingDays),
        end: addWorkingDays(dragState.origEnd, dragState.deltaWorkingDays),
      };
    }
    if (dragState.mode === 'resize-start') {
      const candidate = addWorkingDays(dragState.origStart, dragState.deltaWorkingDays);
      return {
        start: candidate > dragState.origEnd ? dragState.origEnd : candidate,
        end: dragState.origEnd,
      };
    }
    const candidate = addWorkingDays(dragState.origEnd, dragState.deltaWorkingDays);
    return {
      start: dragState.origStart,
      end: candidate < dragState.origStart ? dragState.origStart : candidate,
    };
  };

  const startBarPointerDrag = (
    e: React.PointerEvent,
    row: TimelineRow,
    mode: DragState['mode'],
  ) => {
    if (isPresentationMode) return;
    e.stopPropagation();
    if (e.button !== 0) return;

    const initial: DragState = {
      rowKey: row.key,
      entityType: row.entityType,
      id: row.id,
      name: row.name,
      mode,
      startClientX: e.clientX,
      origStart: row.expectedStart,
      origEnd: row.expectedEnd,
      deltaWorkingDays: 0,
    };
    setDragState(initial);

    let latestDelta = 0;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - initial.startClientX;
      const approxCalendarDays = dx / dayPx;
      const wdDelta = Math.round((approxCalendarDays * 5) / 7);
      if (wdDelta !== latestDelta) {
        latestDelta = wdDelta;
        setDragState((prev) => (prev ? { ...prev, deltaWorkingDays: wdDelta } : null));
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDragState(null);

      if (latestDelta === 0) return;

      let nextStart = initial.origStart;
      let nextEnd = initial.origEnd;
      if (initial.mode === 'move') {
        nextStart = addWorkingDays(initial.origStart, latestDelta);
        nextEnd = addWorkingDays(initial.origEnd, latestDelta);
      } else if (initial.mode === 'resize-start') {
        const c = addWorkingDays(initial.origStart, latestDelta);
        nextStart = c > initial.origEnd ? initial.origEnd : c;
      } else {
        const c = addWorkingDays(initial.origEnd, latestDelta);
        nextEnd = c < initial.origStart ? initial.origStart : c;
      }

      const updatedPlan =
        initial.entityType === 'project'
          ? updateProjectDates(plan, initial.id, nextStart, nextEnd)
          : updateTaskDates(plan, initial.id, nextStart, nextEnd);

      commitWithCascadeCheck(updatedPlan, initial.name);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const scrollToToday = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const todayX = dateToX(todayIso);
    el.scrollTo({
      left: Math.max(0, todayX - (el.clientWidth - SIDEBAR_COL_WIDTH) / 3),
      behavior: 'smooth',
    });
  };

  const rowIndexMap = useMemo(() => {
    const m = new Map<string, { idx: number; row: TimelineRow }>();
    rows.forEach((r, idx) => m.set(r.key, { idx, row: r }));
    return m;
  }, [rows]);

  if (plan.projects.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="max-w-md space-y-4">
          <h2 className="text-lg font-semibold">Start Your Team&apos;s Project Plan</h2>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Create scheduled projects or capture unscheduled backlog ideas (no dates or
            people required yet), then drag them onto the timeline when capacity opens up.
          </p>
          {!isPresentationMode && (
            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => createProject()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                Create Project
              </button>
              <button
                type="button"
                onClick={() => createProject(undefined, true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-300 text-xs font-semibold cursor-pointer"
              >
                <Inbox className="w-4 h-4" aria-hidden="true" />
                Add Backlog Item
              </button>
              <button
                type="button"
                onClick={() => void loadSamplePlan()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border text-xs font-medium hover:bg-slate-500/10 cursor-pointer"
                style={{ borderColor: 'var(--border-strong)' }}
              >
                <Sparkles className="w-4 h-4 text-amber-500" aria-hidden="true" />
                Load Sample Plan
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const todayX = dateToX(todayIso) + dayPx * 0.5;
  const totalUnscheduledCount = plan.projects.filter(
    (p) => !p.expected_start || !p.expected_end,
  ).length;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div
        className="px-4 py-2 border-b flex flex-wrap items-center justify-between gap-2 text-xs print:hidden"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-default)',
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
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

          {!isPresentationMode && (
            <>
              <button
                type="button"
                onClick={() => setBacklogTrayOpen((o) => !o)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border font-medium cursor-pointer transition-colors ${
                  backlogTrayOpen && totalUnscheduledCount > 0
                    ? 'border-purple-500/50 bg-purple-500/12 text-purple-700 dark:text-purple-300'
                    : 'hover:bg-slate-500/10'
                }`}
                style={
                  backlogTrayOpen && totalUnscheduledCount > 0
                    ? undefined
                    : { borderColor: 'var(--border-default)' }
                }
              >
                <Inbox className="w-3.5 h-3.5 text-purple-500" aria-hidden="true" />
                <span>Backlog ({totalUnscheduledCount})</span>
              </button>

              <div className="flex items-center gap-1.5 ml-1">
                <Filter
                  className="w-3.5 h-3.5"
                  style={{ color: 'var(--text-muted)' }}
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter projects…"
                  aria-label="Filter projects by name"
                  className="px-2.5 py-1 rounded-md border w-36"
                  style={{
                    borderColor: 'var(--border-default)',
                    backgroundColor: 'var(--bg-subtle)',
                  }}
                />
                <select
                  value={personFilter}
                  onChange={(e) => setPersonFilter(e.target.value)}
                  aria-label="Filter by person"
                  className="px-2 py-1 rounded-md border"
                  style={{
                    borderColor: 'var(--border-default)',
                    backgroundColor: 'var(--bg-subtle)',
                  }}
                >
                  <option value="all">All People</option>
                  <option value="__tbd__">Has Unassigned (TBD)</option>
                  {plan.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="Filter by status"
                  className="px-2 py-1 rounded-md border"
                  style={{
                    borderColor: 'var(--border-default)',
                    backgroundColor: 'var(--bg-subtle)',
                  }}
                >
                  <option value="all">All Scheduled</option>
                  <option value="planned">Planned</option>
                  <option value="in_progress">In Progress</option>
                  <option value="on_hold">On Hold</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </>
          )}
        </div>

        {/* Legend */}
        <div
          className="hidden xl:flex items-center gap-3 text-[11px]"
          style={{ color: 'var(--text-secondary)' }}
        >
          {activeBaseline && (
            <span className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-medium">
              <span className="w-3.5 h-2 rounded-xs border border-dashed border-indigo-500 bg-indigo-500/20 inline-block" />
              Baseline ghost
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Diamond className="w-3 h-3 text-amber-500 fill-amber-500" aria-hidden="true" />
            Required-by
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-2 rounded-xs bg-hatched-late inline-block" />
            Forecast late
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="px-1 rounded border border-dashed border-amber-500/70 text-[9px] text-amber-600 dark:text-amber-400 font-semibold">
              TBD
            </span>
            Open role
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-0.5 h-3 bg-red-500 inline-block" />
            Today
          </span>
        </div>
      </div>

      {/* Collapsible Unscheduled Backlog Tray */}
      {!isPresentationMode && backlogTrayOpen && backlogProjects.length > 0 && (
        <div
          className="px-4 py-2.5 border-b bg-purple-500/6 space-y-2 text-xs print:hidden"
          style={{ borderColor: 'var(--border-default)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-purple-800 dark:text-purple-300 flex items-center gap-1.5">
              <Inbox className="w-3.5 h-3.5" aria-hidden="true" />
              Unscheduled Backlog ({backlogProjects.length}) — drag any card onto a week
              column below to schedule, or click to inspect
            </span>
            <button
              type="button"
              onClick={() => createProject(undefined, true)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-purple-700 dark:text-purple-300 hover:underline cursor-pointer"
            >
              <Plus className="w-3 h-3" aria-hidden="true" />
              Add backlog item
            </button>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
            {backlogProjects.map((bp) => {
              const bpAsgs = plan.assignments.filter((a) => a.project_id === bp.id);
              const isSel =
                selectedEntity?.type === 'project' && selectedEntity.id === bp.id;
              return (
                <div
                  key={bp.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/backlog-project-id', bp.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() =>
                    setSelectedEntity({
                      type: 'project',
                      id: bp.id,
                      projectId: bp.id,
                    })
                  }
                  className={`shrink-0 w-68 p-2 rounded-lg border flex items-center justify-between gap-2 cursor-grab active:cursor-grabbing transition-shadow ${
                    isSel ? 'ring-2 ring-purple-500' : 'hover:border-purple-500/50'
                  }`}
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-default)',
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <GripVertical
                      className="w-3.5 h-3.5 shrink-0 opacity-45"
                      aria-hidden="true"
                    />
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: bp.color }}
                    />
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{bp.name}</div>
                      <div
                        className="flex items-center gap-1.5 text-[10px]"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        <PriorityBadge priority={bp.priority} />
                        <span>~{formatDurationLabel(bp.estimated_days ?? 10)}</span>
                        {bpAsgs.length === 0 ? (
                          <span className="italic opacity-75">Unassigned</span>
                        ) : (
                          <span>{bpAsgs.length} role(s)</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      scheduleBacklogProject(
                        bp.id,
                        snapToWorkingDay(todayIso, 'forward'),
                        bp.estimated_days ?? 10,
                      );
                    }}
                    title="Schedule starting this week"
                    className="p-1.5 rounded-md bg-purple-500/12 hover:bg-purple-500/22 text-purple-700 dark:text-purple-300 cursor-pointer shrink-0"
                  >
                    <CalendarPlus className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Interactive Dependency Linking Banner */}
      {!isPresentationMode && (linkingFrom || linkBannerError) && (
        <div className="px-4 py-1.5 bg-blue-500/12 border-b border-blue-500/30 flex items-center justify-between text-xs print:hidden">
          <div>
            {linkingFrom ? (
              <span>
                Linking predecessor <strong>{linkingFrom.name}</strong> → click the{' '}
                <strong>Link</strong> icon on any target project or phase to create a
                Finish-to-Start dependency.
              </span>
            ) : (
              <span className="text-red-600 dark:text-red-400 font-medium">
                {linkBannerError}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setLinkingFrom(null);
              setLinkBannerError(null);
            }}
            className="underline cursor-pointer"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Main Scrollable Gantt Grid */}
      <div ref={scrollerRef} className="flex-1 overflow-auto relative select-none">
        <div
          style={{
            width: SIDEBAR_COL_WIDTH + totalWidth,
            minHeight: '100%',
          }}
        >
          {/* Sticky Top Header */}
          <div
            className="sticky top-0 z-20 flex border-b"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-default)',
            }}
          >
            <div
              className="sticky left-0 z-30 shrink-0 px-3 flex items-center justify-between border-r font-semibold text-xs"
              style={{
                width: SIDEBAR_COL_WIDTH,
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-default)',
              }}
            >
              <span>Project / Phase</span>
              {!isPresentationMode && (
                <span className="text-[11px] font-normal" style={{ color: 'var(--text-muted)' }}>
                  Drag bars to reschedule
                </span>
              )}
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
                  const isDropTarget = dropHoverWeek === w.weekStart;
                  return (
                    <div
                      key={w.weekStart}
                      onDragOver={(e) => {
                        if (e.dataTransfer.types.includes('text/backlog-project-id')) {
                          e.preventDefault();
                          setDropHoverWeek(w.weekStart);
                        }
                      }}
                      onDragLeave={() => {
                        if (dropHoverWeek === w.weekStart) setDropHoverWeek(null);
                      }}
                      onDrop={(e) => {
                        const pid = e.dataTransfer.getData('text/backlog-project-id');
                        setDropHoverWeek(null);
                        if (pid) {
                          e.preventDefault();
                          scheduleBacklogProject(pid, w.weekStart);
                        }
                      }}
                      style={{
                        width: 7 * dayPx,
                        borderColor: 'var(--border-default)',
                      }}
                      title={`${w.shortRange} (Drop backlog item here to schedule)`}
                      className={`px-1.5 py-1 border-r flex items-center justify-between transition-colors ${
                        isDropTarget
                          ? 'bg-purple-500/25 text-purple-800 dark:text-purple-200 font-bold'
                          : isCurrentWeek
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

          {/* Rows + Canvas */}
          <div className="relative">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-red-500/80"
              style={{ left: SIDEBAR_COL_WIDTH + todayX }}
            />

            {/* SVG Dependency Arrows Overlay */}
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute top-0 z-10"
              style={{
                left: SIDEBAR_COL_WIDTH,
                width: totalWidth,
                height: rows.length * activeRowHeight,
              }}
            >
              <defs>
                <marker
                  id="dep-arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748b" />
                </marker>
                <marker
                  id="dep-arrow-late"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#ef4444" />
                </marker>
              </defs>
              {plan.dependencies.map((dep) => {
                const fromEntry = rowIndexMap.get(`${dep.from_type}:${dep.from_id}`);
                const toEntry = rowIndexMap.get(`${dep.to_type}:${dep.to_id}`);
                if (!fromEntry || !toEntry) return null;

                const fromDates = previewRowDates(fromEntry.row);
                const toDates = previewRowDates(toEntry.row);

                const x1 = dateToX(fromDates.end) + dayPx;
                const y1 = fromEntry.idx * activeRowHeight + activeRowHeight / 2;
                const x2 = dateToX(toDates.start);
                const y2 = toEntry.idx * activeRowHeight + activeRowHeight / 2;

                const isViolated = violatedDeps.has(dep.id);
                const stub = 10;
                const dPath =
                  x2 >= x1 + stub
                    ? `M ${x1} ${y1} L ${x1 + stub} ${y1} L ${x1 + stub} ${y2} L ${x2} ${y2}`
                    : `M ${x1} ${y1} L ${x1 + stub} ${y1} L ${x1 + stub} ${(y1 + y2) / 2} L ${x2 - stub} ${(y1 + y2) / 2} L ${x2 - stub} ${y2} L ${x2} ${y2}`;

                return (
                  <path
                    key={dep.id}
                    d={dPath}
                    fill="none"
                    stroke={isViolated ? '#ef4444' : '#64748b'}
                    strokeWidth={isViolated ? 2 : 1.5}
                    strokeDasharray={isViolated ? '4 2' : undefined}
                    markerEnd={isViolated ? 'url(#dep-arrow-late)' : 'url(#dep-arrow)'}
                    opacity={0.85}
                  />
                );
              })}
            </svg>

            {rows.map((row) => {
              const dates = previewRowDates(row);
              const metrics = computeScheduleMetrics({
                ...(row.raw as Project),
                expected_start: dates.start,
                expected_end: dates.end,
              });

              const barLeft = dateToX(dates.start);
              const barWidth = Math.max(
                dayPx,
                (calendarDaysBetween(dates.start, dates.end) + 1) * dayPx,
              );

              const isSelected =
                !isPresentationMode &&
                selectedEntity?.type === row.entityType &&
                selectedEntity?.id === row.id;

              const reqByX = row.requiredBy ? dateToX(row.requiredBy) + dayPx : null;
              const origEndX =
                row.originalExpectedEnd && row.originalExpectedEnd !== dates.end
                  ? dateToX(row.originalExpectedEnd) + dayPx
                  : null;

              const lateSegmentLeft =
                row.requiredBy && dates.end > row.requiredBy
                  ? Math.max(barLeft, dateToX(row.requiredBy) + dayPx)
                  : null;
              const lateSegmentWidth =
                lateSegmentLeft !== null
                  ? Math.max(0, barLeft + barWidth - lateSegmentLeft)
                  : 0;

              const ghostSpan = comparisonDiff?.ghostBars[row.key] ?? null;
              const isAddedSinceBaseline =
                comparisonDiff?.addedEntityKeys.includes(row.key) ?? false;
              const ghostLeft = ghostSpan ? dateToX(ghostSpan.start) : 0;
              const ghostWidth = ghostSpan
                ? Math.max(
                    dayPx,
                    (calendarDaysBetween(ghostSpan.start, ghostSpan.end) + 1) * dayPx,
                  )
                : 0;

              return (
                <div
                  key={row.key}
                  style={{
                    height: activeRowHeight,
                    borderColor: 'var(--border-default)',
                  }}
                  className={`flex border-b group ${
                    isSelected ? 'bg-blue-500/8' : 'hover:bg-slate-500/4'
                  }`}
                >
                  <div
                    style={{
                      width: SIDEBAR_COL_WIDTH,
                      backgroundColor: 'var(--bg-surface)',
                      borderColor: 'var(--border-default)',
                    }}
                    className="sticky left-0 z-15 shrink-0 px-2.5 border-r flex items-center justify-between gap-1.5 text-xs"
                  >
                    <div
                      className={`flex items-center gap-1.5 min-w-0 flex-1 ${
                        row.entityType === 'task' ? 'pl-5' : ''
                      }`}
                    >
                      {row.entityType === 'project' && row.hasChildren ? (
                        <button
                          type="button"
                          onClick={() =>
                            setCollapsedProjects((prev) => {
                              const next = new Set(prev);
                              if (next.has(row.id)) next.delete(row.id);
                              else next.add(row.id);
                              return next;
                            })
                          }
                          aria-label={
                            row.isExpanded ? `Collapse ${row.name}` : `Expand ${row.name}`
                          }
                          className="p-0.5 rounded hover:bg-slate-500/15 cursor-pointer"
                        >
                          {row.isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                        </button>
                      ) : row.entityType === 'project' ? (
                        <span className="w-4 shrink-0" />
                      ) : null}

                      <HealthDot health={metrics.health} />

                      <button
                        type="button"
                        onClick={() => {
                          if (isPresentationMode) return;
                          setSelectedEntity({
                            type: row.entityType,
                            id: row.id,
                            projectId: row.projectId,
                          });
                        }}
                        className={`truncate text-left ${
                          isPresentationMode ? '' : 'cursor-pointer hover:underline'
                        } ${row.entityType === 'project' ? 'font-semibold' : 'font-normal'}`}
                      >
                        {row.name}
                      </button>

                      {isAddedSinceBaseline && (
                        <span className="px-1 py-0.2 rounded bg-emerald-500/15 text-[9px] font-bold text-emerald-700 dark:text-emerald-300 shrink-0">
                          NEW
                        </span>
                      )}

                      {row.tbdCount > 0 && (
                        <span
                          title={`${row.tbdCount} unassigned TBD slot(s)`}
                          className="px-1 py-0.2 rounded border border-dashed border-amber-500/70 bg-amber-500/12 text-[9px] font-semibold text-amber-700 dark:text-amber-300 shrink-0"
                        >
                          TBD
                        </span>
                      )}
                    </div>

                    {!isPresentationMode && (
                      <div className="flex items-center gap-1 opacity-75 group-hover:opacity-100 shrink-0">
                        {row.entityType === 'project' && (
                          <button
                            type="button"
                            onClick={() => addTask(row.id)}
                            title="Add phase/task"
                            aria-label={`Add phase to ${row.name}`}
                            className="p-1 rounded hover:bg-slate-500/15 cursor-pointer"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            <Plus className="w-3 h-3" aria-hidden="true" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setLinkBannerError(null);
                            if (!linkingFrom) {
                              setLinkingFrom({
                                type: row.entityType,
                                id: row.id,
                                name: row.name,
                              });
                            } else {
                              const res = addDependency({
                                from_type: linkingFrom.type,
                                from_id: linkingFrom.id,
                                to_type: row.entityType,
                                to_id: row.id,
                              });
                              setLinkingFrom(null);
                              if (!res.ok) {
                                setLinkBannerError(res.reason ?? 'Cannot link');
                              }
                            }
                          }}
                          title={
                            linkingFrom
                              ? `Finish link to ${row.name}`
                              : `Link dependency from ${row.name}`
                          }
                          aria-label={`Dependency link for ${row.name}`}
                          className={`p-1 rounded cursor-pointer ${
                            linkingFrom?.id === row.id
                              ? 'bg-blue-600 text-white'
                              : 'hover:bg-slate-500/15'
                          }`}
                          style={
                            linkingFrom?.id === row.id
                              ? undefined
                              : { color: 'var(--text-muted)' }
                          }
                        >
                          <GitBranch className="w-3 h-3" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Timeline Row Canvas (also accepts dropping a backlog card onto any week!) */}
                  <div
                    className="relative"
                    style={{ width: totalWidth, height: activeRowHeight }}
                  >
                    <div className="absolute inset-0 flex">
                      {weeks.map((w) => (
                        <div
                          key={w.weekStart}
                          onDragOver={(e) => {
                            if (
                              e.dataTransfer.types.includes('text/backlog-project-id')
                            ) {
                              e.preventDefault();
                              setDropHoverWeek(w.weekStart);
                            }
                          }}
                          onDragLeave={() => {
                            if (dropHoverWeek === w.weekStart) setDropHoverWeek(null);
                          }}
                          onDrop={(e) => {
                            const pid = e.dataTransfer.getData(
                              'text/backlog-project-id',
                            );
                            setDropHoverWeek(null);
                            if (pid) {
                              e.preventDefault();
                              scheduleBacklogProject(pid, w.weekStart);
                            }
                          }}
                          style={{
                            width: 7 * dayPx,
                            borderColor: 'var(--border-default)',
                          }}
                          className={`h-full border-r relative ${
                            dropHoverWeek === w.weekStart ? 'bg-purple-500/12' : ''
                          }`}
                        >
                          <div
                            className="absolute top-0 bottom-0 right-0 bg-slate-500/6 pointer-events-none"
                            style={{ width: 2 * dayPx }}
                          />
                        </div>
                      ))}
                    </div>

                    {origEndX !== null && (
                      <div
                        title={`Original expected end: ${formatShortDate(row.originalExpectedEnd)}`}
                        className="absolute top-2 bottom-2 w-0.5 border-l border-dashed border-slate-400 z-10 pointer-events-none"
                        style={{ left: origEndX }}
                      />
                    )}

                    {reqByX !== null && (
                      <div
                        title={`Required by: ${formatShortDate(row.requiredBy)}`}
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 pointer-events-none"
                        style={{ left: reqByX }}
                      >
                        <Diamond
                          className={`w-3.5 h-3.5 ${
                            metrics.isForecastLate
                              ? 'text-red-500 fill-red-500'
                              : 'text-amber-500 fill-amber-500'
                          }`}
                        />
                      </div>
                    )}

                    {/* Baseline Checkpoint Ghost Bar */}
                    {ghostSpan && activeBaseline && (
                      <div
                        title={`Baseline "${activeBaseline.label}": ${formatShortDate(ghostSpan.start)} → ${formatShortDate(ghostSpan.end)}${
                          ghostSpan.endShiftDays
                            ? ` (${formatSignedWorkingDays(ghostSpan.endShiftDays)} vs baseline)`
                            : ''
                        }`}
                        style={{
                          left: ghostLeft,
                          width: ghostWidth,
                          top: row.entityType === 'project' ? 34 : 31,
                          height: 8,
                        }}
                        className="absolute z-12 rounded-xs border border-dashed border-indigo-500/75 bg-indigo-500/20 pointer-events-none"
                      />
                    )}

                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (isPresentationMode) return;
                        setSelectedEntity({
                          type: row.entityType,
                          id: row.id,
                          projectId: row.projectId,
                        });
                      }}
                      onKeyDown={(e) => {
                        if (isPresentationMode) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedEntity({
                            type: row.entityType,
                            id: row.id,
                            projectId: row.projectId,
                          });
                        }
                      }}
                      onPointerDown={(e) => startBarPointerDrag(e, row, 'move')}
                      title={`${row.name}\n${formatShortDate(dates.start)} → ${formatShortDate(dates.end)} (${row.percentComplete}% complete)${
                        ghostSpan && activeBaseline
                          ? `\nBaseline (${activeBaseline.label}): ${formatShortDate(ghostSpan.start)} → ${formatShortDate(ghostSpan.end)}`
                          : ''
                      }${
                        row.assigneeNames.length
                          ? `\nAssigned: ${row.assigneeNames.join(', ')}`
                          : ''
                      }${
                        row.requiredBy
                          ? `\nRequired by: ${formatShortDate(row.requiredBy)}`
                          : ''
                      }`}
                      style={{
                        left: barLeft,
                        width: barWidth,
                        top: activeBaseline
                          ? row.entityType === 'project'
                            ? 6
                            : 9
                          : row.entityType === 'project'
                            ? 7
                            : 10,
                        height: row.entityType === 'project' ? 25 : 20,
                        backgroundColor: `${row.color}30`,
                        borderColor: row.color,
                      }}
                      className={`absolute z-15 rounded-md border overflow-hidden flex items-center transition-shadow ${
                        isPresentationMode
                          ? 'cursor-default'
                          : 'cursor-grab active:cursor-grabbing'
                      } ${metrics.isForecastLate ? 'ring-1 ring-red-500' : ''}`}
                    >
                      <div
                        className="absolute inset-y-0 left-0 pointer-events-none"
                        style={{
                          width: `${row.percentComplete}%`,
                          backgroundColor: row.color,
                          opacity: 0.78,
                        }}
                      />

                      {lateSegmentLeft !== null && lateSegmentWidth > 0 && (
                        <div
                          className="absolute inset-y-0 right-0 bg-hatched-late pointer-events-none"
                          style={{ width: Math.min(barWidth, lateSegmentWidth) }}
                        />
                      )}

                      {!isPresentationMode && (
                        <div
                          onPointerDown={(e) =>
                            startBarPointerDrag(e, row, 'resize-start')
                          }
                          className="absolute left-0 inset-y-0 w-2 cursor-ew-resize hover:bg-white/40 z-20"
                        />
                      )}

                      <div className="relative z-10 px-2 flex items-center justify-between w-full gap-1 text-[11px] font-semibold truncate pointer-events-none">
                        <span
                          className="truncate drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)]"
                          style={{
                            color:
                              row.percentComplete >= 45
                                ? '#ffffff'
                                : 'var(--text-primary)',
                          }}
                        >
                          {barWidth > 58 ? `${row.percentComplete}%` : ''}
                          {barWidth > 120 && row.assigneeNames.length > 0
                            ? ` · ${row.assigneeNames.join(', ')}`
                            : ''}
                        </span>
                      </div>

                      {!isPresentationMode && (
                        <div
                          onPointerDown={(e) =>
                            startBarPointerDrag(e, row, 'resize-end')
                          }
                          className="absolute right-0 inset-y-0 w-2 cursor-ew-resize hover:bg-white/40 z-20"
                        />
                      )}
                    </div>

                    {/* Signed Slip Pill vs Active Baseline */}
                    {ghostSpan &&
                      ghostSpan.endShiftDays !== null &&
                      ghostSpan.endShiftDays !== 0 && (
                        <span
                          style={{ left: barLeft + barWidth + 6, top: 8 }}
                          className={`absolute z-15 px-1.5 py-0.2 rounded text-[10px] font-semibold pointer-events-none ${
                            ghostSpan.endShiftDays > 0
                              ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                              : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          }`}
                        >
                          {formatSignedWorkingDays(ghostSpan.endShiftDays)}
                        </span>
                      )}

                    {dragState?.rowKey === row.key && dragState.deltaWorkingDays !== 0 && (
                      <div
                        className="absolute -top-6 z-30 px-2 py-0.5 rounded bg-slate-900 text-white text-[10px] font-medium whitespace-nowrap pointer-events-none shadow"
                        style={{ left: barLeft }}
                      >
                        {formatShortDate(dates.start)} → {formatShortDate(dates.end)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {rows.length === 0 && (
              <div className="p-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                {backlogProjects.length > 0
                  ? 'All matching projects are currently in the Unscheduled Backlog tray above — drag one onto a week column to schedule it.'
                  : 'No scheduled projects match the active filter criteria.'}
                <div className="mt-2">
                  <StatusPill status="backlog" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
