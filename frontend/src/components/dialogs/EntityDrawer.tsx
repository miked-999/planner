import { useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CalendarPlus,
  Copy,
  GitBranch,
  Inbox,
  Layers,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  computePersonAvailability,
  rankPeopleForSlot,
  resolveAssignmentWindow,
} from '../../engine/capacity';
import {
  formatDurationLabel,
  formatMediumDate,
  formatShortDate,
  formatSignedWorkingDays,
  snapToWorkingDay,
} from '../../engine/dates';
import { computeScheduleMetrics } from '../../engine/rollup';
import { byManualOrder } from '../../engine/ordering';
import { usePlan } from '../../store/PlanContext';
import type { EntityType, PriorityLevel, ProjectStatus } from '../../types/plan';
import { HeadroomBadge, HealthDot } from '../ui/StatusBadges';

const COLOR_SWATCHES = [
  '#2563eb',
  '#7c3aed',
  '#059669',
  '#d97706',
  '#dc2626',
  '#0891b2',
  '#4f46e5',
  '#db2777',
];

export function EntityDrawer() {
  const {
    plan,
    todayIso,
    selectedEntity,
    setSelectedEntity,
    isPresentationMode,
    updateProject,
    scheduleBacklogProject,
    moveProjectToBacklog,
    duplicateProject,
    deleteProject,
    setProjectsArchived,
    addTask,
    updateTask,
    deleteTask,
    upsertAssignment,
    assignPersonToPlaceholder,
    removeAssignment,
    addDependency,
    removeDependency,
    setTeamDrawerOpen,
  } = usePlan();

  const [newTaskName, setNewTaskName] = useState('');
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [selectedAlloc, setSelectedAlloc] = useState('');
  const [tbdLabel, setTbdLabel] = useState('');
  const [tbdAlloc, setTbdAlloc] = useState('50');
  const [whoFitsOpenId, setWhoFitsOpenId] = useState<string | null>(null);
  const [depFromKey, setDepFromKey] = useState('');
  const [depError, setDepError] = useState<string | null>(null);
  const [scheduleStartInput, setScheduleStartInput] = useState(() =>
    snapToWorkingDay(todayIso, 'forward'),
  );

  if (!selectedEntity || isPresentationMode) return null;

  const project = plan.projects.find((p) => p.id === selectedEntity.projectId);
  if (!project) return null;

  const isTaskMode = selectedEntity.type === 'task';
  const activeTask = isTaskMode
    ? plan.tasks.find((t) => t.id === selectedEntity.id)
    : undefined;
  if (isTaskMode && !activeTask) return null;

  const item = isTaskMode ? activeTask! : project;
  const isItemUnscheduled = !item.expected_start || !item.expected_end;
  const projectTasks = plan.tasks.filter((t) => t.project_id === project.id);
  const scheduledTaskCount = projectTasks.filter(
    (t) => t.expected_start && t.expected_end,
  ).length;
  const datesControlledByTasks = !isTaskMode && scheduledTaskCount > 0;
  const metrics = computeScheduleMetrics(item);

  const scopedAssignments = plan.assignments.filter((a) =>
    isTaskMode
      ? a.task_id === activeTask!.id
      : a.project_id === project.id && a.task_id === null,
  );

  // Earliest team availability helper for unscheduled backlog items
  const earliestTeamAvail = isItemUnscheduled
    ? plan.people
        .map((p) => ({
          person: p,
          avail: computePersonAvailability(plan, p.id, todayIso),
        }))
        .sort((a, b) => a.avail.availableDate.localeCompare(b.avail.availableDate))
        .slice(0, 4)
    : [];

  const currentType: EntityType = isTaskMode ? 'task' : 'project';
  const currentId = item.id;
  const predecessors = plan.dependencies.filter(
    (d) => d.to_type === currentType && d.to_id === currentId,
  );
  const successors = plan.dependencies.filter(
    (d) => d.from_type === currentType && d.from_id === currentId,
  );

  const resolveNodeLabel = (t: EntityType, id: string): string => {
    if (t === 'project') {
      return plan.projects.find((p) => p.id === id)?.name ?? id;
    }
    const tk = plan.tasks.find((x) => x.id === id);
    if (!tk) return id;
    const parent = plan.projects.find((p) => p.id === tk.project_id);
    return parent ? `${parent.name} → ${tk.name}` : tk.name;
  };

  const candidateNodes: { key: string; type: EntityType; id: string; label: string }[] = [
    ...plan.projects
      .filter((p) => !(currentType === 'project' && p.id === currentId))
      .map((p) => ({
        key: `project:${p.id}`,
        type: 'project' as EntityType,
        id: p.id,
        label: `[Project] ${p.name}`,
      })),
    ...plan.tasks
      .filter((t) => !(currentType === 'task' && t.id === currentId))
      .map((t) => {
        const parent = plan.projects.find((p) => p.id === t.project_id);
        return {
          key: `task:${t.id}`,
          type: 'task' as EntityType,
          id: t.id,
          label: `[Phase] ${parent?.name ?? ''} → ${t.name}`,
        };
      }),
  ];

  const handlePatch = (patch: Record<string, unknown>, checkCascade = false) => {
    if (isTaskMode) {
      updateTask(activeTask!.id, patch, checkCascade);
    } else {
      updateProject(project.id, patch, checkCascade);
    }
  };

  return (
    <aside
      aria-label={isTaskMode ? 'Task inspector' : 'Project inspector'}
      className="w-96 shrink-0 border-l flex flex-col h-full overflow-hidden shadow-lg print:hidden"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderColor: 'var(--border-default)',
      }}
    >
      {/* Inspector Header */}
      <div
        className="px-4 py-3 border-b flex items-center justify-between gap-2"
        style={{ borderColor: 'var(--border-default)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {isTaskMode ? (
            <button
              type="button"
              onClick={() =>
                setSelectedEntity({
                  type: 'project',
                  id: project.id,
                  projectId: project.id,
                })
              }
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer truncate"
            >
              <ArrowLeft className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{project.name}</span>
            </button>
          ) : (
            <span
              className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-secondary)' }}
            >
              <HealthDot health={metrics.health} />
              {isItemUnscheduled ? 'Backlog Item' : 'Project Details'}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setSelectedEntity(null)}
          aria-label="Close inspector"
          className="p-1 rounded-md hover:bg-slate-500/10 cursor-pointer"
          style={{ color: 'var(--text-secondary)' }}
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* Scrollable Inspector Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
        {!isTaskMode && project.archived && (
          <div className="p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-amber-800 dark:text-amber-300">
              Archived — hidden from active timeline views.
            </span>
            <button
              type="button"
              onClick={() => setProjectsArchived([project.id], false)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-semibold cursor-pointer shrink-0"
            >
              <ArchiveRestore className="w-3 h-3" aria-hidden="true" />
              Restore
            </button>
          </div>
        )}

        {/* Name & Colour */}
        <div className="space-y-2">
          <label className="block font-medium" style={{ color: 'var(--text-secondary)' }}>
            {isTaskMode ? 'Phase / Task Name' : 'Project Name'}
          </label>
          <input
            type="text"
            value={item.name}
            onChange={(e) => handlePatch({ name: e.target.value })}
            className="w-full px-3 py-1.5 rounded-lg border text-sm font-semibold"
            style={{
              borderColor: 'var(--border-default)',
              backgroundColor: 'var(--bg-subtle)',
            }}
          />

          {!isTaskMode && (
            <div className="flex items-center gap-1.5 pt-1">
              {COLOR_SWATCHES.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => updateProject(project.id, { color: hex })}
                  aria-label={`Select color ${hex}`}
                  className={`w-5 h-5 rounded-full cursor-pointer transition-transform ${
                    project.color === hex ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : ''
                  }`}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Status, Priority */}
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="block mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
              Status
            </label>
            <select
              value={item.status}
              onChange={(e) => handlePatch({ status: e.target.value as ProjectStatus })}
              className="w-full px-2.5 py-1.5 rounded-lg border text-xs"
              style={{
                borderColor: 'var(--border-default)',
                backgroundColor: 'var(--bg-subtle)',
              }}
            >
              <option value="backlog">Backlog (Unscheduled)</option>
              <option value="planned">Planned</option>
              <option value="in_progress">In Progress</option>
              <option value="on_hold">On Hold</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          <div>
            <label className="block mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
              Priority
            </label>
            <select
              value={item.priority}
              onChange={(e) => handlePatch({ priority: e.target.value as PriorityLevel })}
              className="w-full px-2.5 py-1.5 rounded-lg border text-xs"
              style={{
                borderColor: 'var(--border-default)',
                backgroundColor: 'var(--bg-subtle)',
              }}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>

        {/* Schedule Section — Unscheduled Backlog vs Scheduled */}
        {isItemUnscheduled && !isTaskMode ? (
          <div className="p-3.5 rounded-xl border border-purple-500/35 bg-purple-500/8 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-purple-800 dark:text-purple-300 flex items-center gap-1.5">
                <Inbox className="w-4 h-4" aria-hidden="true" />
                Unscheduled Backlog Item
              </span>
              <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                0% capacity impact
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                Rough Estimated Duration (Working Days)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={project.estimated_days ?? 10}
                  onChange={(e) =>
                    updateProject(project.id, {
                      estimated_days: Math.max(1, Number(e.target.value) || 10),
                    })
                  }
                  className="w-20 px-2 py-1 rounded border font-semibold"
                  style={{
                    borderColor: 'var(--border-default)',
                    backgroundColor: 'var(--bg-surface)',
                  }}
                />
                <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  wd
                </span>
                <div className="flex items-center gap-1 ml-auto">
                  {([
                    [20, '1m'],
                    [40, '2m'],
                    [60, '3m'],
                    [80, '4m'],
                  ] as const).map(([days, label]) => (
                    <button
                      key={label}
                      type="button"
                      title={`${days} working days`}
                      onClick={() =>
                        updateProject(project.id, { estimated_days: days })
                      }
                      className={`px-1.5 py-0.5 rounded text-[10px] border cursor-pointer ${
                        (project.estimated_days ?? 10) === days
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'hover:bg-slate-500/10'
                      }`}
                      style={
                        (project.estimated_days ?? 10) === days
                          ? undefined
                          : { borderColor: 'var(--border-default)' }
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block mb-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                Optional Target / Required-by Deadline
              </label>
              <input
                type="date"
                value={project.required_by ?? ''}
                onChange={(e) =>
                  updateProject(project.id, { required_by: e.target.value || null })
                }
                className="w-full px-2 py-1.5 rounded border"
                style={{
                  borderColor: 'var(--border-default)',
                  backgroundColor: 'var(--bg-surface)',
                }}
              />
            </div>

            {/* Earliest team availability shortcuts */}
            {earliestTeamAvail.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  Align Start with Next Available Person:
                </div>
                <div className="flex flex-wrap gap-1">
                  {earliestTeamAvail.map(({ person, avail }) => (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => setScheduleStartInput(avail.availableDate)}
                      className="px-2 py-0.5 rounded border text-[10px] hover:border-purple-500 cursor-pointer"
                      style={{
                        borderColor: 'var(--border-default)',
                        backgroundColor: 'var(--bg-surface)',
                      }}
                    >
                      {person.name.split(' ')[0]}:{' '}
                      <strong>
                        {avail.isAvailableNow
                          ? 'Now'
                          : formatShortDate(avail.availableDate)}
                      </strong>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* One-click Schedule onto Timeline */}
            <div className="pt-1 border-t border-purple-500/20 space-y-1.5">
              <label className="block text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                Schedule onto Timeline Starting:
              </label>
              <div className="flex gap-1.5">
                <input
                  type="date"
                  value={scheduleStartInput}
                  onChange={(e) => setScheduleStartInput(e.target.value)}
                  className="flex-1 px-2 py-1.5 rounded-lg border"
                  style={{
                    borderColor: 'var(--border-default)',
                    backgroundColor: 'var(--bg-surface)',
                  }}
                />
                <button
                  type="button"
                  onClick={() =>
                    scheduleStartInput &&
                    scheduleBacklogProject(
                      project.id,
                      scheduleStartInput,
                      project.estimated_days ?? 10,
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer shrink-0"
                >
                  <CalendarPlus className="w-3.5 h-3.5" aria-hidden="true" />
                  Schedule
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Completion % */}
            <div
              className="p-3 rounded-lg border space-y-2"
              style={{
                borderColor: 'var(--border-default)',
                backgroundColor: 'var(--bg-subtle)',
              }}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">Completion: {item.percent_complete}%</span>
                {!isTaskMode && projectTasks.length > 0 && (
                  <label className="inline-flex items-center gap-1.5 cursor-pointer text-[11px]">
                    <input
                      type="checkbox"
                      checked={project.auto_progress}
                      onChange={(e) =>
                        updateProject(project.id, { auto_progress: e.target.checked })
                      }
                    />
                    <span>Auto from phases</span>
                  </label>
                )}
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                disabled={!isTaskMode && projectTasks.length > 0 && project.auto_progress}
                value={item.percent_complete}
                onChange={(e) => handlePatch({ percent_complete: Number(e.target.value) })}
                className="w-full"
              />
            </div>

            {/* Schedule & Deadlines */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span
                  className="font-semibold uppercase tracking-wider text-[11px]"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Schedule (
                  {metrics.durationWorkingDays > 0
                    ? formatDurationLabel(metrics.durationWorkingDays)
                    : 'Unscheduled'}
                  )
                </span>
                <div className="flex items-center gap-2">
                  <HeadroomBadge headroomDays={metrics.headroomDays} />
                  {!isTaskMode && (
                    <button
                      type="button"
                      onClick={() => moveProjectToBacklog(project.id)}
                      title="Clear dates and park in Unscheduled Backlog"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] hover:bg-purple-500/12 text-purple-700 dark:text-purple-300 cursor-pointer"
                      style={{ borderColor: 'var(--border-default)' }}
                    >
                      <Inbox className="w-3 h-3" aria-hidden="true" />
                      To Backlog
                    </button>
                  )}
                </div>
              </div>

              {datesControlledByTasks && (
                <p className="text-[11px] px-2.5 py-1.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  Expected start &amp; end roll up automatically from this project&apos;s{' '}
                  {scheduledTaskCount} scheduled phases.
                </p>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Expected Start
                  </label>
                  <input
                    type="date"
                    disabled={datesControlledByTasks}
                    value={item.expected_start ?? ''}
                    onChange={(e) =>
                      e.target.value &&
                      handlePatch({ expected_start: e.target.value }, true)
                    }
                    className="w-full px-2 py-1.5 rounded border disabled:opacity-60"
                    style={{
                      borderColor: 'var(--border-default)',
                      backgroundColor: 'var(--bg-subtle)',
                    }}
                  />
                </div>

                <div>
                  <label className="block mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Expected End
                  </label>
                  <input
                    type="date"
                    disabled={datesControlledByTasks}
                    value={item.expected_end ?? ''}
                    min={item.expected_start ?? undefined}
                    onChange={(e) =>
                      e.target.value && handlePatch({ expected_end: e.target.value }, true)
                    }
                    className="w-full px-2 py-1.5 rounded border disabled:opacity-60"
                    style={{
                      borderColor: 'var(--border-default)',
                      backgroundColor: 'var(--bg-subtle)',
                    }}
                  />
                </div>

                <div>
                  <label className="block mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Required-by Deadline
                  </label>
                  <input
                    type="date"
                    value={item.required_by ?? ''}
                    onChange={(e) => handlePatch({ required_by: e.target.value || null })}
                    className="w-full px-2 py-1.5 rounded border"
                    style={{
                      borderColor: 'var(--border-default)',
                      backgroundColor: 'var(--bg-subtle)',
                    }}
                  />
                </div>

                <div>
                  <label className="block mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Actual Start / End
                  </label>
                  <div className="flex gap-1">
                    <input
                      type="date"
                      title="Actual Start"
                      value={item.actual_start ?? ''}
                      onChange={(e) =>
                        handlePatch({ actual_start: e.target.value || null })
                      }
                      className="w-1/2 px-1.5 py-1.5 rounded border text-[11px]"
                      style={{
                        borderColor: 'var(--border-default)',
                        backgroundColor: 'var(--bg-subtle)',
                      }}
                    />
                    <input
                      type="date"
                      title="Actual End"
                      value={item.actual_end ?? ''}
                      onChange={(e) => handlePatch({ actual_end: e.target.value || null })}
                      className="w-1/2 px-1.5 py-1.5 rounded border text-[11px]"
                      style={{
                        borderColor: 'var(--border-default)',
                        backgroundColor: 'var(--bg-subtle)',
                      }}
                    />
                  </div>
                </div>
              </div>

              {item.expected_end && (
                <div
                  className="flex items-center justify-between px-2.5 py-1.5 rounded border text-[11px]"
                  style={{ borderColor: 'var(--border-default)' }}
                >
                  <span style={{ color: 'var(--text-secondary)' }}>
                    Original End:{' '}
                    <strong>{formatMediumDate(item.original_expected_end)}</strong>
                    {metrics.slipDays !== null && metrics.slipDays !== 0 && (
                      <span
                        className={`ml-1.5 font-semibold ${
                          metrics.slipDays > 0
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        ({formatSignedWorkingDays(metrics.slipDays)} slip)
                      </span>
                    )}
                  </span>
                  {item.original_expected_end !== item.expected_end && (
                    <button
                      type="button"
                      onClick={() =>
                        handlePatch({ original_expected_end: item.expected_end })
                      }
                      title="Reset original commitment to current expected end"
                      className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" aria-hidden="true" />
                      Reset
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* High-level Phases / Tasks */}
        {!isTaskMode && (
          <div className="space-y-2">
            <span
              className="font-semibold uppercase tracking-wider text-[11px] flex items-center gap-1.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Layers className="w-3.5 h-3.5" aria-hidden="true" />
              Phases / Tasks ({projectTasks.length})
            </span>

            {projectTasks.length > 0 && (
              <div
                className="rounded-lg border divide-y"
                style={{ borderColor: 'var(--border-default)' }}
              >
                {byManualOrder(projectTasks).map((t) => (
                  <div
                    key={t.id}
                    className="px-2.5 py-2 flex items-center justify-between gap-2 hover:bg-slate-500/5"
                    style={{ borderColor: 'var(--border-default)' }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedEntity({
                          type: 'task',
                          id: t.id,
                          projectId: project.id,
                        })
                      }
                      className="text-left min-w-0 flex-1 cursor-pointer"
                    >
                      <div className="font-medium truncate hover:underline">{t.name}</div>
                      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {t.expected_start && t.expected_end
                          ? `${t.percent_complete}% · ${t.expected_start} → ${t.expected_end}`
                          : 'Unscheduled phase'}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteTask(t.id)}
                      aria-label={`Delete phase ${t.name}`}
                      className="p-1 rounded hover:bg-red-500/15 text-red-500 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                addTask(project.id, newTaskName.trim() || 'New Phase');
                setNewTaskName('');
              }}
              className="flex gap-1.5"
            >
              <input
                type="text"
                value={newTaskName}
                onChange={(e) => setNewTaskName(e.target.value)}
                placeholder="Add optional phase (e.g. Initial Review)…"
                className="flex-1 px-2.5 py-1.5 rounded-lg border"
                style={{
                  borderColor: 'var(--border-default)',
                  backgroundColor: 'var(--bg-subtle)',
                }}
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                Add
              </button>
            </form>
          </div>
        )}

        {/* Assigned People & TBD Demand Slots */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span
              className="font-semibold uppercase tracking-wider text-[11px] flex items-center gap-1.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Users className="w-3.5 h-3.5" aria-hidden="true" />
              People &amp; TBD Slots
            </span>
            <button
              type="button"
              onClick={() => setTeamDrawerOpen(true)}
              className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              Manage team
            </button>
          </div>

          {scopedAssignments.length > 0 && (
            <div
              className="rounded-lg border divide-y"
              style={{ borderColor: 'var(--border-default)' }}
            >
              {scopedAssignments.map((asg) => {
                const isPlaceholder = !asg.person_id;
                const person = asg.person_id
                  ? plan.people.find((p) => p.id === asg.person_id)
                  : undefined;
                const win = resolveAssignmentWindow(asg, project, activeTask);
                const isWhoFitsOpen = whoFitsOpenId === asg.id;

                const candidates =
                  isPlaceholder && isWhoFitsOpen && win
                    ? rankPeopleForSlot(
                        plan,
                        win.start,
                        win.end,
                        asg.allocation_pct ?? 100,
                      )
                    : [];

                return (
                  <div
                    key={asg.id}
                    className={`p-2.5 space-y-2 ${isPlaceholder ? 'bg-amber-500/6' : ''}`}
                    style={{ borderColor: 'var(--border-default)' }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      {isPlaceholder ? (
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <span className="px-1.5 py-0.5 rounded border border-dashed border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px] font-semibold shrink-0">
                            TBD
                          </span>
                          <input
                            type="text"
                            value={asg.placeholder_label ?? 'TBD'}
                            onChange={(e) =>
                              upsertAssignment({
                                ...asg,
                                placeholder_label: e.target.value,
                              })
                            }
                            aria-label="Placeholder slot label"
                            className="min-w-0 flex-1 px-1.5 py-0.5 rounded border text-xs font-medium"
                            style={{
                              borderColor: 'var(--border-default)',
                              backgroundColor: 'var(--bg-surface)',
                            }}
                          />
                        </div>
                      ) : (
                        <span className="font-medium truncate">
                          {person?.name ?? asg.person_id}
                        </span>
                      )}

                      <div className="flex items-center gap-1.5 shrink-0">
                        <input
                          type="number"
                          min={5}
                          max={200}
                          step={5}
                          placeholder="100%"
                          value={asg.allocation_pct ?? ''}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            upsertAssignment({
                              ...asg,
                              allocation_pct: raw === '' ? null : Number(raw),
                            });
                          }}
                          aria-label="Allocation percentage"
                          className="w-15 px-1.5 py-0.5 rounded border text-right"
                          style={{
                            borderColor: 'var(--border-default)',
                            backgroundColor: 'var(--bg-subtle)',
                          }}
                        />
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          %
                        </span>
                        <button
                          type="button"
                          onClick={() => removeAssignment(asg.id)}
                          aria-label="Remove assignment"
                          className="p-1 rounded hover:bg-red-500/15 text-red-500 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <div
                      className="flex items-center justify-between gap-1.5 text-[11px]"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <input
                          type="date"
                          value={asg.start_date ?? ''}
                          onChange={(e) =>
                            upsertAssignment({
                              ...asg,
                              start_date: e.target.value || null,
                            })
                          }
                          title="Optional join date override"
                          className="px-1 py-0.5 rounded border w-[108px]"
                          style={{
                            borderColor: 'var(--border-default)',
                            backgroundColor: 'var(--bg-subtle)',
                          }}
                        />
                        <span>→</span>
                        <input
                          type="date"
                          value={asg.end_date ?? ''}
                          onChange={(e) =>
                            upsertAssignment({
                              ...asg,
                              end_date: e.target.value || null,
                            })
                          }
                          title="Optional leave date override"
                          className="px-1 py-0.5 rounded border w-[108px]"
                          style={{
                            borderColor: 'var(--border-default)',
                            backgroundColor: 'var(--bg-subtle)',
                          }}
                        />
                      </div>

                      {isPlaceholder && (
                        <button
                          type="button"
                          onClick={() =>
                            setWhoFitsOpenId(isWhoFitsOpen ? null : asg.id)
                          }
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-800 dark:text-amber-300 font-semibold cursor-pointer shrink-0"
                        >
                          <Sparkles className="w-3 h-3" aria-hidden="true" />
                          Who fits?
                        </button>
                      )}
                    </div>

                    {/* Ranked "Who fits?" Matcher Panel (handles both scheduled & unscheduled backlog!) */}
                    {isPlaceholder && isWhoFitsOpen && (
                      <div
                        className="p-2 rounded-lg border space-y-1.5"
                        style={{
                          backgroundColor: 'var(--bg-surface)',
                          borderColor: 'var(--border-strong)',
                        }}
                      >
                        {win ? (
                          <>
                            <div
                              className="text-[10px] font-semibold uppercase tracking-wider"
                              style={{ color: 'var(--text-secondary)' }}
                            >
                              Best Capacity Matches ({asg.allocation_pct ?? 100}% needed)
                            </div>
                            {candidates.length === 0 ? (
                              <div
                                className="text-[11px]"
                                style={{ color: 'var(--text-muted)' }}
                              >
                                Add team members first to check capacity fit.
                              </div>
                            ) : (
                              candidates.map((cand) => {
                                const dotClass =
                                  cand.fitStatus === 'full'
                                    ? 'bg-emerald-500'
                                    : cand.fitStatus === 'partial'
                                      ? 'bg-amber-400'
                                      : 'bg-red-500';
                                return (
                                  <div
                                    key={cand.personId}
                                    className="flex items-center justify-between gap-2 py-1 border-b last:border-b-0"
                                    style={{ borderColor: 'var(--border-default)' }}
                                  >
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5 font-medium">
                                        <span
                                          className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`}
                                        />
                                        <span className="truncate">{cand.personName}</span>
                                      </div>
                                      <div
                                        className="text-[10px] pl-3.5"
                                        style={{ color: 'var(--text-secondary)' }}
                                      >
                                        {cand.avgFreePct}% avg free ·{' '}
                                        {cand.peakWeeklyAfterPct}% peak wk after
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        assignPersonToPlaceholder(asg.id, cand.personId);
                                        setWhoFitsOpenId(null);
                                      }}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium cursor-pointer shrink-0"
                                    >
                                      <UserCheck className="w-3 h-3" aria-hidden="true" />
                                      Assign
                                    </button>
                                  </div>
                                );
                              })
                            )}
                          </>
                        ) : (
                          <>
                            <div
                              className="text-[10px] font-semibold uppercase tracking-wider"
                              style={{ color: 'var(--text-secondary)' }}
                            >
                              Soonest Available People (Backlog Item)
                            </div>
                            {earliestTeamAvail.map(({ person: p, avail }) => (
                              <div
                                key={p.id}
                                className="flex items-center justify-between gap-2 py-1 border-b last:border-b-0"
                                style={{ borderColor: 'var(--border-default)' }}
                              >
                                <div className="min-w-0">
                                  <div className="font-medium truncate">{p.name}</div>
                                  <div
                                    className="text-[10px]"
                                    style={{ color: 'var(--text-secondary)' }}
                                  >
                                    {avail.isAvailableNow
                                      ? `Available now (${avail.freePct}% free)`
                                      : `Free from ${formatShortDate(avail.availableDate)}`}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    assignPersonToPlaceholder(asg.id, p.id);
                                    setWhoFitsOpenId(null);
                                  }}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium cursor-pointer shrink-0"
                                >
                                  <UserCheck className="w-3 h-3" aria-hidden="true" />
                                  Assign
                                </button>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Assign Named Person */}
          {plan.people.length > 0 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const pid = selectedPersonId || plan.people[0]?.id;
                if (!pid) return;
                upsertAssignment({
                  person_id: pid,
                  project_id: project.id,
                  task_id: isTaskMode ? activeTask!.id : null,
                  allocation_pct:
                    selectedAlloc.trim() === '' ? null : Number(selectedAlloc),
                  start_date: null,
                  end_date: null,
                });
                setSelectedAlloc('');
              }}
              className="flex gap-1.5"
            >
              <select
                value={selectedPersonId || plan.people[0]?.id || ''}
                onChange={(e) => setSelectedPersonId(e.target.value)}
                aria-label="Select person to assign"
                className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border"
                style={{
                  borderColor: 'var(--border-default)',
                  backgroundColor: 'var(--bg-subtle)',
                }}
              >
                {plan.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={5}
                max={200}
                step={5}
                value={selectedAlloc}
                onChange={(e) => setSelectedAlloc(e.target.value)}
                placeholder="Opt %"
                aria-label="Optional allocation percentage"
                className="w-18 px-2 py-1.5 rounded-lg border"
                style={{
                  borderColor: 'var(--border-default)',
                  backgroundColor: 'var(--bg-subtle)',
                }}
              />
              <button
                type="submit"
                className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium cursor-pointer"
              >
                Assign
              </button>
            </form>
          )}

          {/* Add Unassigned / TBD Demand Slot */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const label = tbdLabel.trim() || 'TBD Role';
              const normalizedLabel = label.toUpperCase().startsWith('TBD')
                ? label
                : `TBD — ${label}`;
              upsertAssignment({
                person_id: null,
                placeholder_label: normalizedLabel,
                project_id: project.id,
                task_id: isTaskMode ? activeTask!.id : null,
                allocation_pct: tbdAlloc.trim() === '' ? null : Number(tbdAlloc),
                start_date: null,
                end_date: null,
              });
              setTbdLabel('');
            }}
            className="flex gap-1.5 pt-0.5"
          >
            <input
              type="text"
              value={tbdLabel}
              onChange={(e) => setTbdLabel(e.target.value)}
              placeholder="TBD role (e.g. Reviewer)…"
              aria-label="Placeholder TBD role name"
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-dashed border-amber-500/50"
              style={{ backgroundColor: 'var(--bg-subtle)' }}
            />
            <input
              type="number"
              min={5}
              max={200}
              step={5}
              value={tbdAlloc}
              onChange={(e) => setTbdAlloc(e.target.value)}
              placeholder="%"
              aria-label="TBD slot allocation percentage"
              className="w-18 px-2 py-1.5 rounded-lg border border-dashed border-amber-500/50"
              style={{ backgroundColor: 'var(--bg-subtle)' }}
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-amber-500/50 bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-300 font-medium cursor-pointer shrink-0"
            >
              <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
              + TBD
            </button>
          </form>
        </div>

        {/* Dependencies (Finish-to-Start) */}
        <div className="space-y-2">
          <span
            className="font-semibold uppercase tracking-wider text-[11px] flex items-center gap-1.5"
            style={{ color: 'var(--text-secondary)' }}
          >
            <GitBranch className="w-3.5 h-3.5" aria-hidden="true" />
            Dependencies (Finish-to-Start)
          </span>

          {predecessors.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Depends on (must finish first):
              </div>
              {predecessors.map((d) => (
                <div
                  key={d.id}
                  className="px-2.5 py-1.5 rounded border flex items-center justify-between gap-2"
                  style={{ borderColor: 'var(--border-default)' }}
                >
                  <span className="truncate">
                    {resolveNodeLabel(d.from_type, d.from_id)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeDependency(d.id)}
                    aria-label="Remove dependency"
                    className="p-1 text-red-500 hover:bg-red-500/15 rounded cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {successors.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Blocks downstream:
              </div>
              {successors.map((d) => (
                <div
                  key={d.id}
                  className="px-2.5 py-1.5 rounded border flex items-center justify-between gap-2"
                  style={{ borderColor: 'var(--border-default)' }}
                >
                  <span className="truncate">
                    {resolveNodeLabel(d.to_type, d.to_id)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeDependency(d.id)}
                    aria-label="Remove dependency"
                    className="p-1 text-red-500 hover:bg-red-500/15 rounded cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {candidateNodes.length > 0 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setDepError(null);
                const chosenKey = depFromKey || candidateNodes[0]?.key;
                const found = candidateNodes.find((c) => c.key === chosenKey);
                if (!found) return;
                const res = addDependency({
                  from_type: found.type,
                  from_id: found.id,
                  to_type: currentType,
                  to_id: currentId,
                });
                if (!res.ok) {
                  setDepError(res.reason ?? 'Invalid dependency');
                }
              }}
              className="space-y-1.5"
            >
              <div className="flex gap-1.5">
                <select
                  value={depFromKey || candidateNodes[0]?.key || ''}
                  onChange={(e) => {
                    setDepFromKey(e.target.value);
                    setDepError(null);
                  }}
                  aria-label="Add predecessor dependency"
                  className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border text-[11px]"
                  style={{
                    borderColor: 'var(--border-default)',
                    backgroundColor: 'var(--bg-subtle)',
                  }}
                >
                  {candidateNodes.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="px-2.5 py-1.5 rounded-lg border font-medium hover:bg-slate-500/10 cursor-pointer shrink-0"
                  style={{ borderColor: 'var(--border-default)' }}
                >
                  Link
                </button>
              </div>
              {depError && (
                <p className="text-[11px] text-red-500 font-medium">{depError}</p>
              )}
            </form>
          )}
        </div>

        {/* Description & Notes */}
        <div className="space-y-2">
          <label className="block font-medium" style={{ color: 'var(--text-secondary)' }}>
            Description
          </label>
          <textarea
            rows={2}
            value={item.description}
            onChange={(e) => handlePatch({ description: e.target.value })}
            placeholder="Optional summary…"
            className="w-full px-2.5 py-1.5 rounded-lg border"
            style={{
              borderColor: 'var(--border-default)',
              backgroundColor: 'var(--bg-subtle)',
            }}
          />

          <label className="block font-medium" style={{ color: 'var(--text-secondary)' }}>
            Notes / Jira Reference
          </label>
          <textarea
            rows={2}
            value={item.notes}
            onChange={(e) => handlePatch({ notes: e.target.value })}
            placeholder="Jira Epic key, risks, assumptions…"
            className="w-full px-2.5 py-1.5 rounded-lg border"
            style={{
              borderColor: 'var(--border-default)',
              backgroundColor: 'var(--bg-subtle)',
            }}
          />
        </div>

        {/* Footer Actions */}
        <div
          className="pt-3 border-t flex items-center justify-between gap-2"
          style={{ borderColor: 'var(--border-default)' }}
        >
          {!isTaskMode ? (
            <>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => duplicateProject(project.id)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border hover:bg-slate-500/10 cursor-pointer"
                  style={{ borderColor: 'var(--border-default)' }}
                >
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={() => setProjectsArchived([project.id], !project.archived)}
                  title={
                    project.archived
                      ? 'Restore project to active views'
                      : 'Archive project (removes from timeline & table, keeps in history/exports)'
                  }
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border hover:bg-slate-500/10 cursor-pointer"
                  style={{ borderColor: 'var(--border-default)' }}
                >
                  {project.archived ? (
                    <>
                      <ArchiveRestore className="w-3.5 h-3.5" aria-hidden="true" />
                      Restore
                    </>
                  ) : (
                    <>
                      <Archive className="w-3.5 h-3.5" aria-hidden="true" />
                      Archive
                    </>
                  )}
                </button>
              </div>
              <button
                type="button"
                onClick={() => deleteProject(project.id)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-500/12 hover:bg-red-500/20 text-red-600 dark:text-red-400 font-medium cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                Delete
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => deleteTask(activeTask!.id)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-500/12 hover:bg-red-500/20 text-red-600 dark:text-red-400 font-medium cursor-pointer ml-auto"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              Delete Phase
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
