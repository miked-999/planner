import React, { useId, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Filter,
  Plus,
} from 'lucide-react';
import {
  formatDurationLabel,
  formatSignedWorkingDays,
} from '../engine/dates';
import { computeScheduleMetrics } from '../engine/rollup';
import { usePlan } from '../store/PlanContext';
import type { PriorityLevel, ProjectStatus } from '../types/plan';
import { HeadroomBadge, HealthDot } from '../components/ui/StatusBadges';

type SortColumn =
  | 'name'
  | 'status'
  | 'priority'
  | 'expected_start'
  | 'expected_end'
  | 'required_by'
  | 'headroom'
  | 'percent_complete';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const PRIORITY_RANK: Record<PriorityLevel, number> = { low: 1, medium: 2, high: 3 };

export function ProjectTableView() {
  const {
    plan,
    setSelectedEntity,
    createProject,
    updateProject,
    updateTask,
    addTask,
  } = usePlan();

  const captionId = useId();
  const [sortCol, setSortCol] = useState<SortColumn>('expected_start');
  const [sortDir, setSortDir] = useState<'ascending' | 'descending'>('ascending');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortAnnouncement, setSortAnnouncement] = useState('');

  const peopleById = useMemo(
    () => new Map(plan.people.map((p) => [p.id, p.name])),
    [plan.people],
  );

  const sortedProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = plan.projects.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (!q) return true;
      const tasksMatch = plan.tasks.some(
        (t) => t.project_id === p.id && t.name.toLowerCase().includes(q),
      );
      return p.name.toLowerCase().includes(q) || tasksMatch;
    });

    const factor = sortDir === 'ascending' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const ma = computeScheduleMetrics(a);
      const mb = computeScheduleMetrics(b);
      let cmp = 0;
      switch (sortCol) {
        case 'name':
          cmp = collator.compare(a.name, b.name);
          break;
        case 'status':
          cmp = collator.compare(a.status, b.status);
          break;
        case 'priority':
          cmp = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
          break;
        case 'expected_start':
          cmp = a.expected_start.localeCompare(b.expected_start);
          break;
        case 'expected_end':
          cmp = a.expected_end.localeCompare(b.expected_end);
          break;
        case 'required_by':
          cmp = (a.required_by ?? '9999-99-99').localeCompare(
            b.required_by ?? '9999-99-99',
          );
          break;
        case 'headroom':
          cmp = (ma.headroomDays ?? 9999) - (mb.headroomDays ?? 9999);
          break;
        case 'percent_complete':
          cmp = a.percent_complete - b.percent_complete;
          break;
      }
      return factor * cmp;
    });
  }, [plan.projects, plan.tasks, search, statusFilter, sortCol, sortDir]);

  const handleSort = (col: SortColumn, label: string) => {
    const nextDir: 'ascending' | 'descending' =
      sortCol === col && sortDir === 'ascending' ? 'descending' : 'ascending';
    setSortCol(col);
    setSortDir(nextDir);
    setSortAnnouncement(
      `Sorted by ${label}, ${nextDir}, ${sortedProjects.length} projects`,
    );
  };

  const renderSortHeader = (col: SortColumn, label: string) => {
    const isSorted = sortCol === col;
    return (
      <th
        scope="col"
        aria-sort={isSorted ? sortDir : undefined}
        className="border-b p-0 text-left font-semibold"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-default)',
        }}
      >
        <button
          type="button"
          onClick={() => handleSort(col, label)}
          className="w-full min-h-9 px-3 py-2 flex items-center justify-between gap-1.5 hover:bg-slate-500/8 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-500"
        >
          <span>{label}</span>
          {isSorted &&
            (sortDir === 'ascending' ? (
              <ArrowUp className="w-3 h-3 shrink-0" aria-hidden="true" />
            ) : (
              <ArrowDown className="w-3 h-3 shrink-0" aria-hidden="true" />
            ))}
        </button>
      </th>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Filter & Actions Bar */}
      <div
        className="px-4 py-2 border-b flex flex-wrap items-center justify-between gap-2 text-xs"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-default)',
        }}
      >
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects or phases…"
            aria-label="Search projects"
            className="px-2.5 py-1 rounded-md border w-52"
            style={{
              borderColor: 'var(--border-default)',
              backgroundColor: 'var(--bg-subtle)',
            }}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
            className="px-2.5 py-1 rounded-md border"
            style={{
              borderColor: 'var(--border-default)',
              backgroundColor: 'var(--bg-subtle)',
            }}
          >
            <option value="all">All Statuses</option>
            <option value="planned">Planned</option>
            <option value="in_progress">In Progress</option>
            <option value="on_hold">On Hold</option>
            <option value="completed">Completed</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => createProject()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          Add Project
        </button>
      </div>

      {/* Live region for screen-reader sort feedback */}
      <div role="status" className="sr-status">
        {sortAnnouncement}
      </div>

      {/* Scrollable Table Container */}
      <div
        tabIndex={0}
        role="region"
        aria-labelledby={captionId}
        className="flex-1 overflow-auto"
      >
        <table
          className="w-full min-w-[1040px] text-xs"
          style={{ borderCollapse: 'separate', borderSpacing: 0 }}
        >
          <caption id={captionId} className="sr-status">
            Projects and phases planning table
          </caption>
          <thead className="sticky top-0 z-20">
            <tr>
              {renderSortHeader('name', 'Project / Phase')}
              <th
                scope="col"
                className="border-b px-3 py-2 text-left font-semibold"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-default)',
                }}
              >
                People
              </th>
              {renderSortHeader('status', 'Status')}
              {renderSortHeader('priority', 'Priority')}
              {renderSortHeader('expected_start', 'Expected Start')}
              {renderSortHeader('expected_end', 'Expected End')}
              {renderSortHeader('required_by', 'Required By')}
              {renderSortHeader('headroom', 'Headroom')}
              <th
                scope="col"
                className="border-b px-3 py-2 text-left font-semibold"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-default)',
                }}
              >
                Duration / Slip
              </th>
              {renderSortHeader('percent_complete', 'Complete')}
            </tr>
          </thead>

          <tbody>
            {sortedProjects.map((proj) => {
              const childTasks = plan.tasks.filter((t) => t.project_id === proj.id);
              const hasTasks = childTasks.length > 0;
              const isOpen = expanded.has(proj.id);
              const metrics = computeScheduleMetrics(proj);

              const peopleNames = Array.from(
                new Set(
                  plan.assignments
                    .filter((a) => a.project_id === proj.id)
                    .map((a) => peopleById.get(a.person_id))
                    .filter((x): x is string => Boolean(x)),
                ),
              );

              return (
                <React.Fragment key={proj.id}>
                  <tr className="hover:bg-slate-500/4">
                    <td
                      className="py-2 px-3 border-b"
                      style={{ borderColor: 'var(--border-default)' }}
                    >
                      <div className="flex items-center gap-1.5">
                        {hasTasks ? (
                          <button
                            type="button"
                            onClick={() =>
                              setExpanded((prev) => {
                                const next = new Set(prev);
                                if (next.has(proj.id)) next.delete(proj.id);
                                else next.add(proj.id);
                                return next;
                              })
                            }
                            aria-label={
                              isOpen ? `Collapse ${proj.name}` : `Expand ${proj.name}`
                            }
                            className="p-0.5 rounded hover:bg-slate-500/15 cursor-pointer"
                          >
                            {isOpen ? (
                              <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                          </button>
                        ) : (
                          <span className="w-4 shrink-0" />
                        )}

                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: proj.color }}
                        />
                        <HealthDot health={metrics.health} />

                        <input
                          type="text"
                          value={proj.name}
                          onChange={(e) =>
                            updateProject(proj.id, { name: e.target.value })
                          }
                          aria-label="Project name"
                          className="font-semibold bg-transparent px-1 py-0.5 rounded hover:bg-slate-500/8 focus:bg-slate-500/10 flex-1 min-w-[160px]"
                        />

                        <button
                          type="button"
                          onClick={() =>
                            setSelectedEntity({
                              type: 'project',
                              id: proj.id,
                              projectId: proj.id,
                            })
                          }
                          className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer shrink-0"
                        >
                          Edit
                        </button>
                      </div>
                    </td>

                    <td
                      className="py-2 px-3 border-b"
                      style={{ borderColor: 'var(--border-default)' }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedEntity({
                            type: 'project',
                            id: proj.id,
                            projectId: proj.id,
                          })
                        }
                        className="text-left hover:underline cursor-pointer"
                      >
                        {peopleNames.length > 0 ? (
                          <span>{peopleNames.join(', ')}</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>+ Assign</span>
                        )}
                      </button>
                    </td>

                    <td
                      className="py-2 px-3 border-b"
                      style={{ borderColor: 'var(--border-default)' }}
                    >
                      <select
                        value={proj.status}
                        onChange={(e) =>
                          updateProject(proj.id, {
                            status: e.target.value as ProjectStatus,
                          })
                        }
                        aria-label={`Status for ${proj.name}`}
                        className="px-2 py-1 rounded border text-[11px]"
                        style={{
                          borderColor: 'var(--border-default)',
                          backgroundColor: 'var(--bg-subtle)',
                        }}
                      >
                        <option value="planned">Planned</option>
                        <option value="in_progress">In Progress</option>
                        <option value="on_hold">On Hold</option>
                        <option value="completed">Completed</option>
                      </select>
                    </td>

                    <td
                      className="py-2 px-3 border-b"
                      style={{ borderColor: 'var(--border-default)' }}
                    >
                      <select
                        value={proj.priority}
                        onChange={(e) =>
                          updateProject(proj.id, {
                            priority: e.target.value as PriorityLevel,
                          })
                        }
                        aria-label={`Priority for ${proj.name}`}
                        className="px-2 py-1 rounded border text-[11px]"
                        style={{
                          borderColor: 'var(--border-default)',
                          backgroundColor: 'var(--bg-subtle)',
                        }}
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </td>

                    <td
                      className="py-2 px-3 border-b"
                      style={{ borderColor: 'var(--border-default)' }}
                    >
                      <input
                        type="date"
                        disabled={hasTasks}
                        value={proj.expected_start}
                        onChange={(e) =>
                          e.target.value &&
                          updateProject(
                            proj.id,
                            { expected_start: e.target.value },
                            true,
                          )
                        }
                        aria-label={`Expected start for ${proj.name}`}
                        className="px-1.5 py-1 rounded border disabled:opacity-60"
                        style={{
                          borderColor: 'var(--border-default)',
                          backgroundColor: 'var(--bg-subtle)',
                        }}
                      />
                    </td>

                    <td
                      className="py-2 px-3 border-b"
                      style={{ borderColor: 'var(--border-default)' }}
                    >
                      <input
                        type="date"
                        disabled={hasTasks}
                        min={proj.expected_start}
                        value={proj.expected_end}
                        onChange={(e) =>
                          e.target.value &&
                          updateProject(
                            proj.id,
                            { expected_end: e.target.value },
                            true,
                          )
                        }
                        aria-label={`Expected end for ${proj.name}`}
                        className="px-1.5 py-1 rounded border disabled:opacity-60"
                        style={{
                          borderColor: 'var(--border-default)',
                          backgroundColor: 'var(--bg-subtle)',
                        }}
                      />
                    </td>

                    <td
                      className="py-2 px-3 border-b"
                      style={{ borderColor: 'var(--border-default)' }}
                    >
                      <input
                        type="date"
                        value={proj.required_by ?? ''}
                        onChange={(e) =>
                          updateProject(proj.id, {
                            required_by: e.target.value || null,
                          })
                        }
                        aria-label={`Required by date for ${proj.name}`}
                        className="px-1.5 py-1 rounded border"
                        style={{
                          borderColor: 'var(--border-default)',
                          backgroundColor: 'var(--bg-subtle)',
                        }}
                      />
                    </td>

                    <td
                      className="py-2 px-3 border-b"
                      style={{ borderColor: 'var(--border-default)' }}
                    >
                      <HeadroomBadge headroomDays={metrics.headroomDays} />
                    </td>

                    <td
                      className="py-2 px-3 border-b"
                      style={{
                        borderColor: 'var(--border-default)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <span>{formatDurationLabel(metrics.durationWorkingDays)}</span>
                      {metrics.slipDays !== null && metrics.slipDays !== 0 && (
                        <span
                          className={`ml-1.5 text-[11px] font-medium ${
                            metrics.slipDays > 0
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          ({formatSignedWorkingDays(metrics.slipDays)} slip)
                        </span>
                      )}
                    </td>

                    <td
                      className="py-2 px-3 border-b"
                      style={{ borderColor: 'var(--border-default)' }}
                    >
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={5}
                          disabled={hasTasks && proj.auto_progress}
                          value={proj.percent_complete}
                          onChange={(e) =>
                            updateProject(proj.id, {
                              percent_complete: Math.max(
                                0,
                                Math.min(100, Number(e.target.value)),
                              ),
                            })
                          }
                          aria-label={`Percent complete for ${proj.name}`}
                          className="w-14 px-1.5 py-1 rounded border text-right disabled:opacity-65"
                          style={{
                            borderColor: 'var(--border-default)',
                            backgroundColor: 'var(--bg-subtle)',
                          }}
                        />
                        <span>%</span>
                      </div>
                    </td>
                  </tr>

                  {/* Expanded Subtasks */}
                  {isOpen &&
                    childTasks.map((task) => {
                      const tm = computeScheduleMetrics(task);
                      const taskPeople = plan.assignments
                        .filter((a) => a.task_id === task.id)
                        .map((a) => peopleById.get(a.person_id))
                        .filter((x): x is string => Boolean(x));

                      return (
                        <tr
                          key={task.id}
                          style={{ backgroundColor: 'var(--bg-subtle)' }}
                        >
                          <td
                            className="py-1.5 pl-10 pr-3 border-b"
                            style={{ borderColor: 'var(--border-default)' }}
                          >
                            <div className="flex items-center gap-1.5">
                              <HealthDot health={tm.health} />
                              <input
                                type="text"
                                value={task.name}
                                onChange={(e) =>
                                  updateTask(task.id, { name: e.target.value })
                                }
                                aria-label="Phase name"
                                className="bg-transparent px-1 py-0.5 rounded flex-1"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedEntity({
                                    type: 'task',
                                    id: task.id,
                                    projectId: proj.id,
                                  })
                                }
                                className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                              >
                                Details
                              </button>
                            </div>
                          </td>

                          <td
                            className="py-1.5 px-3 border-b text-[11px]"
                            style={{
                              borderColor: 'var(--border-default)',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {taskPeople.join(', ') || '—'}
                          </td>

                          <td
                            className="py-1.5 px-3 border-b"
                            style={{ borderColor: 'var(--border-default)' }}
                          >
                            <select
                              value={task.status}
                              onChange={(e) =>
                                updateTask(task.id, {
                                  status: e.target.value as ProjectStatus,
                                })
                              }
                              aria-label={`Status for ${task.name}`}
                              className="px-2 py-0.5 rounded border text-[11px]"
                              style={{
                                borderColor: 'var(--border-default)',
                                backgroundColor: 'var(--bg-surface)',
                              }}
                            >
                              <option value="planned">Planned</option>
                              <option value="in_progress">In Progress</option>
                              <option value="on_hold">On Hold</option>
                              <option value="completed">Completed</option>
                            </select>
                          </td>

                          <td
                            className="py-1.5 px-3 border-b"
                            style={{ borderColor: 'var(--border-default)' }}
                          >
                            <select
                              value={task.priority}
                              onChange={(e) =>
                                updateTask(task.id, {
                                  priority: e.target.value as PriorityLevel,
                                })
                              }
                              aria-label={`Priority for ${task.name}`}
                              className="px-2 py-0.5 rounded border text-[11px]"
                              style={{
                                borderColor: 'var(--border-default)',
                                backgroundColor: 'var(--bg-surface)',
                              }}
                            >
                              <option value="low">Low</option>
                              <option value="medium">Medium</option>
                              <option value="high">High</option>
                            </select>
                          </td>

                          <td
                            className="py-1.5 px-3 border-b"
                            style={{ borderColor: 'var(--border-default)' }}
                          >
                            <input
                              type="date"
                              value={task.expected_start}
                              onChange={(e) =>
                                e.target.value &&
                                updateTask(
                                  task.id,
                                  { expected_start: e.target.value },
                                  true,
                                )
                              }
                              aria-label={`Expected start for ${task.name}`}
                              className="px-1.5 py-0.5 rounded border text-[11px]"
                              style={{
                                borderColor: 'var(--border-default)',
                                backgroundColor: 'var(--bg-surface)',
                              }}
                            />
                          </td>

                          <td
                            className="py-1.5 px-3 border-b"
                            style={{ borderColor: 'var(--border-default)' }}
                          >
                            <input
                              type="date"
                              min={task.expected_start}
                              value={task.expected_end}
                              onChange={(e) =>
                                e.target.value &&
                                updateTask(
                                  task.id,
                                  { expected_end: e.target.value },
                                  true,
                                )
                              }
                              aria-label={`Expected end for ${task.name}`}
                              className="px-1.5 py-0.5 rounded border text-[11px]"
                              style={{
                                borderColor: 'var(--border-default)',
                                backgroundColor: 'var(--bg-surface)',
                              }}
                            />
                          </td>

                          <td
                            className="py-1.5 px-3 border-b"
                            style={{ borderColor: 'var(--border-default)' }}
                          >
                            <input
                              type="date"
                              value={task.required_by ?? ''}
                              onChange={(e) =>
                                updateTask(task.id, {
                                  required_by: e.target.value || null,
                                })
                              }
                              aria-label={`Required by for ${task.name}`}
                              className="px-1.5 py-0.5 rounded border text-[11px]"
                              style={{
                                borderColor: 'var(--border-default)',
                                backgroundColor: 'var(--bg-surface)',
                              }}
                            />
                          </td>

                          <td
                            className="py-1.5 px-3 border-b"
                            style={{ borderColor: 'var(--border-default)' }}
                          >
                            <HeadroomBadge headroomDays={tm.headroomDays} />
                          </td>

                          <td
                            className="py-1.5 px-3 border-b text-[11px]"
                            style={{
                              borderColor: 'var(--border-default)',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {formatDurationLabel(tm.durationWorkingDays)}
                          </td>

                          <td
                            className="py-1.5 px-3 border-b"
                            style={{ borderColor: 'var(--border-default)' }}
                          >
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step={5}
                                value={task.percent_complete}
                                onChange={(e) =>
                                  updateTask(task.id, {
                                    percent_complete: Math.max(
                                      0,
                                      Math.min(100, Number(e.target.value)),
                                    ),
                                  })
                                }
                                aria-label={`Percent complete for ${task.name}`}
                                className="w-14 px-1.5 py-0.5 rounded border text-right text-[11px]"
                                style={{
                                  borderColor: 'var(--border-default)',
                                  backgroundColor: 'var(--bg-surface)',
                                }}
                              />
                              <span>%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                  {isOpen && (
                    <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                      <td
                        colSpan={10}
                        className="py-1.5 pl-10 pr-3 border-b"
                        style={{ borderColor: 'var(--border-default)' }}
                      >
                        <button
                          type="button"
                          onClick={() => addTask(proj.id)}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          <Plus className="w-3 h-3" aria-hidden="true" />
                          Add phase to {proj.name}
                        </button>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
