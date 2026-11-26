import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  EyeOff,
  Filter,
  GripVertical,
  Plus,
} from 'lucide-react';
import {
  formatDurationLabel,
  formatShortDate,
  formatSignedWorkingDays,
} from '../engine/dates';
import { byManualOrder, type DropPlacement } from '../engine/ordering';
import { computeScheduleMetrics } from '../engine/rollup';
import { usePlan } from '../store/PlanContext';
import { useLocalIdSet } from '../store/useLocalPref';
import type { PriorityLevel, ProjectStatus } from '../types/plan';
import {
  applyReorderDrop,
  dropIndicatorShadow,
  keyboardReorder,
  REORDER_MIME,
  ReorderHandle,
  ReorderHandleSpacer,
  resolveReorderDrop,
  type ReorderItem,
} from '../components/ui/ReorderHandle';
import {
  HeadroomBadge,
  HealthDot,
  PriorityBadge,
  StatusPill,
} from '../components/ui/StatusBadges';

type SortColumn =
  | 'manual'
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
    isPresentationMode,
    setSelectedEntity,
    createProject,
    updateProject,
    updateTask,
    addTask,
    reorderProject,
    reorderTask,
    setProjectsArchived,
  } = usePlan();

  const captionId = useId();
  const [sortCol, setSortCol] = useState<SortColumn>('manual');
  const [sortDir, setSortDir] = useState<'ascending' | 'descending'>('ascending');
  const [expanded, setExpanded] = useLocalIdSet('table.expandedProjects');
  const [hiddenProjects, setHiddenProjects] = useLocalIdSet('projects.hidden');
  const [showHidden, setShowHidden] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortAnnouncement, setSortAnnouncement] = useState('');
  const [reorderDrag, setReorderDrag] = useState<ReorderItem | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    rowKey: string;
    placement: DropPlacement;
  } | null>(null);

  const peopleById = useMemo(
    () => new Map(plan.people.map((p) => [p.id, p.name])),
    [plan.people],
  );

  const archivedCount = useMemo(
    () => plan.projects.filter((p) => Boolean(p.archived)).length,
    [plan.projects],
  );

  const hiddenCount = useMemo(
    () => plan.projects.filter((p) => !p.archived && hiddenProjects.has(p.id)).length,
    [plan.projects, hiddenProjects],
  );

  useEffect(() => {
    if (hiddenCount === 0) setShowHidden(false);
  }, [hiddenCount]);

  const sortedProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = plan.projects.filter((p) => {
      if (statusFilter === 'archived') {
        if (!p.archived) return false;
      } else {
        if (p.archived) return false;
        if (hiddenProjects.has(p.id) && !showHidden) return false;
        if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      }
      if (!q) return true;
      const tasksMatch = plan.tasks.some(
        (t) => t.project_id === p.id && t.name.toLowerCase().includes(q),
      );
      return p.name.toLowerCase().includes(q) || tasksMatch;
    });

    const manual = byManualOrder(filtered);
    if (sortCol === 'manual') return manual;
    const manualIdx = new Map(manual.map((p, i) => [p.id, i]));

    const factor = sortDir === 'ascending' ? 1 : -1;
    return [...manual].sort((a, b) => {
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
          cmp = (a.expected_start ?? '9999-99-99').localeCompare(
            b.expected_start ?? '9999-99-99',
          );
          break;
        case 'expected_end':
          cmp = (a.expected_end ?? '9999-99-99').localeCompare(
            b.expected_end ?? '9999-99-99',
          );
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
      return factor * cmp || manualIdx.get(a.id)! - manualIdx.get(b.id)!;
    });
  }, [
    plan.projects,
    plan.tasks,
    search,
    statusFilter,
    sortCol,
    sortDir,
    hiddenProjects,
    showHidden,
  ]);

  const expandableIds = useMemo(
    () =>
      sortedProjects
        .filter((p) => plan.tasks.some((t) => t.project_id === p.id))
        .map((p) => p.id),
    [sortedProjects, plan.tasks],
  );
  const allExpanded =
    expandableIds.length > 0 && expandableIds.every((id) => expanded.has(id));

  const toggleExpandAll = () => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of expandableIds) {
        if (allExpanded) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const toggleProjectHidden = (projectId: string) => {
    setHiddenProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const visibleReorderItems = useMemo<ReorderItem[]>(() => {
    const out: ReorderItem[] = [];
    for (const p of sortedProjects) {
      out.push({ type: 'project', id: p.id, projectId: p.id });
      if (expanded.has(p.id)) {
        const tasks = byManualOrder(plan.tasks.filter((t) => t.project_id === p.id));
        for (const t of tasks) {
          out.push({ type: 'task', id: t.id, projectId: p.id });
        }
      }
    }
    return out;
  }, [sortedProjects, expanded, plan.tasks]);

  const canReorder =
    !isPresentationMode && sortCol === 'manual' && statusFilter !== 'archived';

  const handleReorderDragState = (item: ReorderItem | null) => {
    setReorderDrag(item);
    if (!item) setDropTarget(null);
  };

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
      {!isPresentationMode && (
        <div
          className="px-4 py-2 border-b flex flex-wrap items-center justify-between gap-2 text-xs print:hidden"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-default)',
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            {expandableIds.length > 0 && (
              <button
                type="button"
                onClick={toggleExpandAll}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-medium hover:bg-slate-500/10 cursor-pointer"
                style={{ borderColor: 'var(--border-default)' }}
              >
                {allExpanded ? (
                  <ChevronsDownUp className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <ChevronsUpDown className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{allExpanded ? 'Collapse all' : 'Expand all'}</span>
              </button>
            )}

            <Filter
              className="w-3.5 h-3.5"
              style={{ color: 'var(--text-muted)' }}
              aria-hidden="true"
            />
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
              <option value="all">All Active Statuses</option>
              <option value="backlog">Backlog (Unscheduled)</option>
              <option value="planned">Planned</option>
              <option value="in_progress">In Progress</option>
              <option value="on_hold">On Hold</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived ({archivedCount})</option>
            </select>

            {sortCol !== 'manual' && (
              <button
                type="button"
                onClick={() => {
                  setSortCol('manual');
                  setSortAnnouncement('Returned to manual project order');
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-300 font-medium cursor-pointer"
              >
                <ArrowDownUp className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Reset to manual order</span>
              </button>
            )}

            {hiddenCount > 0 && statusFilter !== 'archived' && (
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowHidden((s) => !s)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-medium cursor-pointer ${
                    showHidden
                      ? 'border-amber-500/60 bg-amber-500/15 text-amber-800 dark:text-amber-300'
                      : 'border-slate-400/50 bg-slate-500/10 hover:bg-slate-500/18'
                  }`}
                >
                  {showHidden ? (
                    <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>
                    {showHidden ? `Showing ${hiddenCount} hidden` : `${hiddenCount} hidden`}
                  </span>
                </button>
                {showHidden && (
                  <button
                    type="button"
                    onClick={() => {
                      setHiddenProjects(() => new Set());
                      setShowHidden(false);
                    }}
                    className="px-2 py-1 rounded text-[11px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    Unhide all
                  </button>
                )}
              </div>
            )}

            {(archivedCount > 0 || statusFilter === 'archived') && (
              <button
                type="button"
                onClick={() =>
                  setStatusFilter((s) => (s === 'archived' ? 'all' : 'archived'))
                }
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-medium cursor-pointer ${
                  statusFilter === 'archived'
                    ? 'border-amber-500/60 bg-amber-500/15 text-amber-800 dark:text-amber-300'
                    : 'hover:bg-slate-500/10'
                }`}
                style={
                  statusFilter === 'archived'
                    ? undefined
                    : { borderColor: 'var(--border-default)' }
                }
              >
                <Archive className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {statusFilter === 'archived'
                    ? `Viewing Archived (${archivedCount})`
                    : `Archived (${archivedCount})`}
                </span>
              </button>
            )}
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
      )}

      <div role="status" className="sr-status">
        {sortAnnouncement}
      </div>

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
                People &amp; TBD
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
              const childTasks = byManualOrder(
                plan.tasks.filter((t) => t.project_id === proj.id),
              );
              const hasTasks = childTasks.length > 0;
              const isOpen = expanded.has(proj.id);
              const isHidden = hiddenProjects.has(proj.id);
              const metrics = computeScheduleMetrics(proj);

              const projAsgs = plan.assignments.filter((a) => a.project_id === proj.id);
              const peopleNames = Array.from(
                new Set(
                  projAsgs
                    .filter((a) => Boolean(a.person_id))
                    .map((a) => peopleById.get(a.person_id!))
                    .filter((x): x is string => Boolean(x)),
                ),
              );
              const tbdSlots = projAsgs.filter((a) => !a.person_id);

              const projRowKey = `project:${proj.id}`;
              const projReorderItem: ReorderItem = {
                type: 'project',
                id: proj.id,
                projectId: proj.id,
              };
              const projIndicator = dropIndicatorShadow(
                dropTarget?.rowKey === projRowKey ? dropTarget.placement : null,
              );

              return (
                <React.Fragment key={proj.id}>
                  <tr
                    data-reorder-row
                    onDragOver={(e) => {
                      if (
                        !canReorder ||
                        !reorderDrag ||
                        !e.dataTransfer.types.includes(REORDER_MIME)
                      ) {
                        return;
                      }
                      const placement = resolveReorderDrop(
                        reorderDrag,
                        projReorderItem,
                        e.clientY,
                        e.currentTarget.getBoundingClientRect(),
                      );
                      if (placement) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (
                          dropTarget?.rowKey !== projRowKey ||
                          dropTarget.placement !== placement
                        ) {
                          setDropTarget({ rowKey: projRowKey, placement });
                        }
                      }
                    }}
                    onDragLeave={(e) => {
                      if (
                        dropTarget?.rowKey === projRowKey &&
                        !e.currentTarget.contains(e.relatedTarget as Node | null)
                      ) {
                        setDropTarget(null);
                      }
                    }}
                    onDrop={(e) => {
                      if (!canReorder || !e.dataTransfer.types.includes(REORDER_MIME)) {
                        return;
                      }
                      const raw = e.dataTransfer.getData(REORDER_MIME);
                      if (!raw) return;
                      try {
                        const dragged = JSON.parse(raw) as ReorderItem;
                        const placement = resolveReorderDrop(
                          dragged,
                          projReorderItem,
                          e.clientY,
                          e.currentTarget.getBoundingClientRect(),
                        );
                        if (placement) {
                          e.preventDefault();
                          applyReorderDrop(dragged, projReorderItem, placement, {
                            reorderProject,
                            reorderTask,
                          });
                        }
                      } catch {
                        // ignore malformed drag payload
                      } finally {
                        setReorderDrag(null);
                        setDropTarget(null);
                      }
                    }}
                    style={{ boxShadow: projIndicator }}
                    className={`group hover:bg-slate-500/4 ${isHidden ? 'opacity-65' : ''}`}
                  >
                    <td
                      className="py-2 px-3 border-b"
                      style={{
                        borderColor: 'var(--border-default)',
                        boxShadow: projIndicator,
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        {!isPresentationMode &&
                          statusFilter !== 'archived' &&
                          (canReorder ? (
                            <ReorderHandle
                              item={projReorderItem}
                              label={proj.name}
                              onDragStateChange={handleReorderDragState}
                              onKeyboardMove={(delta) =>
                                keyboardReorder(visibleReorderItems, projReorderItem, delta, {
                                  reorderProject,
                                  reorderTask,
                                })
                              }
                            />
                          ) : (
                            <span
                              title='Column sort active — click "Reset to manual order" to drag-reorder'
                              className="p-0.5 -ml-1 opacity-20 shrink-0 cursor-not-allowed"
                            >
                              <GripVertical className="w-3.5 h-3.5" aria-hidden="true" />
                            </span>
                          ))}

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

                        {isPresentationMode ? (
                          <span className="font-semibold">{proj.name}</span>
                        ) : (
                          <>
                            <input
                              type="text"
                              value={proj.name}
                              onChange={(e) =>
                                updateProject(proj.id, { name: e.target.value })
                              }
                              aria-label="Project name"
                              className="font-semibold bg-transparent px-1 py-0.5 rounded hover:bg-slate-500/8 focus:bg-slate-500/10 flex-1 min-w-[140px]"
                            />
                            {proj.archived ? (
                              <button
                                type="button"
                                onClick={() => setProjectsArchived([proj.id], false)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-300 text-[11px] font-semibold cursor-pointer shrink-0 print:hidden"
                              >
                                <ArchiveRestore className="w-3 h-3" aria-hidden="true" />
                                Restore
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => toggleProjectHidden(proj.id)}
                                  title={
                                    isHidden
                                      ? `Unhide ${proj.name}`
                                      : `Hide ${proj.name} from your view`
                                  }
                                  aria-label={
                                    isHidden ? `Unhide ${proj.name}` : `Hide ${proj.name}`
                                  }
                                  className={`p-1 rounded cursor-pointer shrink-0 print:hidden ${
                                    isHidden
                                      ? 'text-amber-600 dark:text-amber-400 bg-amber-500/15'
                                      : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-slate-500/15'
                                  }`}
                                  style={isHidden ? undefined : { color: 'var(--text-muted)' }}
                                >
                                  {isHidden ? (
                                    <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                                  ) : (
                                    <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                                  )}
                                </button>
                                {proj.status === 'completed' && (
                                  <button
                                    type="button"
                                    onClick={() => setProjectsArchived([proj.id], true)}
                                    title={`Archive ${proj.name}`}
                                    aria-label={`Archive ${proj.name}`}
                                    className="p-1 rounded hover:bg-slate-500/15 cursor-pointer shrink-0 print:hidden"
                                    style={{ color: 'var(--text-muted)' }}
                                  >
                                    <Archive className="w-3.5 h-3.5" aria-hidden="true" />
                                  </button>
                                )}
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedEntity({
                                  type: 'project',
                                  id: proj.id,
                                  projectId: proj.id,
                                })
                              }
                              className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer shrink-0 print:hidden"
                            >
                              Edit
                            </button>
                          </>
                        )}
                      </div>
                    </td>

                    <td
                      className="py-2 px-3 border-b"
                      style={{ borderColor: 'var(--border-default)' }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (isPresentationMode) return;
                          setSelectedEntity({
                            type: 'project',
                            id: proj.id,
                            projectId: proj.id,
                          });
                        }}
                        className={`text-left flex flex-wrap items-center gap-1 ${
                          isPresentationMode ? 'cursor-default' : 'hover:underline cursor-pointer'
                        }`}
                      >
                        {peopleNames.length > 0 && (
                          <span>{peopleNames.join(', ')}</span>
                        )}
                        {tbdSlots.map((tbd) => (
                          <span
                            key={tbd.id}
                            className="px-1.5 py-0.2 rounded border border-dashed border-amber-500/70 bg-amber-500/12 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
                          >
                            {tbd.placeholder_label || 'TBD'}
                          </span>
                        ))}
                        {peopleNames.length === 0 &&
                          tbdSlots.length === 0 &&
                          !isPresentationMode && (
                            <span style={{ color: 'var(--text-muted)' }}>+ Assign</span>
                          )}
                      </button>
                    </td>

                    <td
                      className="py-2 px-3 border-b"
                      style={{ borderColor: 'var(--border-default)' }}
                    >
                      {isPresentationMode ? (
                        <StatusPill status={proj.status} />
                      ) : (
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
                          <option value="backlog">Backlog</option>
                          <option value="planned">Planned</option>
                          <option value="in_progress">In Progress</option>
                          <option value="on_hold">On Hold</option>
                          <option value="completed">Completed</option>
                        </select>
                      )}
                    </td>

                    <td
                      className="py-2 px-3 border-b"
                      style={{ borderColor: 'var(--border-default)' }}
                    >
                      {isPresentationMode ? (
                        <PriorityBadge priority={proj.priority} />
                      ) : (
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
                      )}
                    </td>

                    <td
                      className="py-2 px-3 border-b"
                      style={{ borderColor: 'var(--border-default)' }}
                    >
                      {isPresentationMode ? (
                        <span>{formatShortDate(proj.expected_start)}</span>
                      ) : (
                        <input
                          type="date"
                          disabled={hasTasks && Boolean(proj.expected_start)}
                          value={proj.expected_start ?? ''}
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
                      )}
                    </td>

                    <td
                      className="py-2 px-3 border-b"
                      style={{ borderColor: 'var(--border-default)' }}
                    >
                      {isPresentationMode ? (
                        <span>{formatShortDate(proj.expected_end)}</span>
                      ) : (
                        <input
                          type="date"
                          disabled={hasTasks && Boolean(proj.expected_end)}
                          min={proj.expected_start ?? undefined}
                          value={proj.expected_end ?? ''}
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
                      )}
                    </td>

                    <td
                      className="py-2 px-3 border-b"
                      style={{ borderColor: 'var(--border-default)' }}
                    >
                      {isPresentationMode ? (
                        <span>{formatShortDate(proj.required_by)}</span>
                      ) : (
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
                      )}
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
                      {!proj.expected_start || !proj.expected_end ? (
                        isPresentationMode ? (
                          <span>~{formatDurationLabel(proj.estimated_days ?? 10)} est.</span>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <span>~</span>
                            <input
                              type="number"
                              min={1}
                              max={500}
                              value={proj.estimated_days ?? 10}
                              onChange={(e) =>
                                updateProject(proj.id, {
                                  estimated_days: Math.max(
                                    1,
                                    Number(e.target.value) || 10,
                                  ),
                                })
                              }
                              aria-label={`Estimated working days for ${proj.name}`}
                              className="w-13 px-1.5 py-0.5 rounded border text-right"
                              style={{
                                borderColor: 'var(--border-default)',
                                backgroundColor: 'var(--bg-subtle)',
                              }}
                            />
                            <span>wd est.</span>
                          </div>
                        )
                      ) : (
                        <>
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
                        </>
                      )}
                    </td>

                    <td
                      className="py-2 px-3 border-b"
                      style={{ borderColor: 'var(--border-default)' }}
                    >
                      {isPresentationMode ? (
                        <span className="font-medium">{proj.percent_complete}%</span>
                      ) : (
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
                      )}
                    </td>
                  </tr>

                  {isOpen &&
                    childTasks.map((task) => {
                      const tm = computeScheduleMetrics(task);
                      const taskAsgs = plan.assignments.filter(
                        (a) => a.task_id === task.id,
                      );
                      const taskPeople = taskAsgs
                        .map((a) =>
                          a.person_id
                            ? peopleById.get(a.person_id)
                            : a.placeholder_label || 'TBD',
                        )
                        .filter((x): x is string => Boolean(x));

                      const taskRowKey = `task:${task.id}`;
                      const taskReorderItem: ReorderItem = {
                        type: 'task',
                        id: task.id,
                        projectId: proj.id,
                      };
                      const taskIndicator = dropIndicatorShadow(
                        dropTarget?.rowKey === taskRowKey ? dropTarget.placement : null,
                      );

                      return (
                        <tr
                          key={task.id}
                          data-reorder-row
                          onDragOver={(e) => {
                            if (
                              !canReorder ||
                              !reorderDrag ||
                              !e.dataTransfer.types.includes(REORDER_MIME)
                            ) {
                              return;
                            }
                            const placement = resolveReorderDrop(
                              reorderDrag,
                              taskReorderItem,
                              e.clientY,
                              e.currentTarget.getBoundingClientRect(),
                            );
                            if (placement) {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                              if (
                                dropTarget?.rowKey !== taskRowKey ||
                                dropTarget.placement !== placement
                              ) {
                                setDropTarget({ rowKey: taskRowKey, placement });
                              }
                            }
                          }}
                          onDragLeave={(e) => {
                            if (
                              dropTarget?.rowKey === taskRowKey &&
                              !e.currentTarget.contains(e.relatedTarget as Node | null)
                            ) {
                              setDropTarget(null);
                            }
                          }}
                          onDrop={(e) => {
                            if (!canReorder || !e.dataTransfer.types.includes(REORDER_MIME)) {
                              return;
                            }
                            const raw = e.dataTransfer.getData(REORDER_MIME);
                            if (!raw) return;
                            try {
                              const dragged = JSON.parse(raw) as ReorderItem;
                              const placement = resolveReorderDrop(
                                dragged,
                                taskReorderItem,
                                e.clientY,
                                e.currentTarget.getBoundingClientRect(),
                              );
                              if (placement) {
                                e.preventDefault();
                                applyReorderDrop(dragged, taskReorderItem, placement, {
                                  reorderProject,
                                  reorderTask,
                                });
                              }
                            } catch {
                              // ignore malformed drag payload
                            } finally {
                              setReorderDrag(null);
                              setDropTarget(null);
                            }
                          }}
                          style={{
                            backgroundColor: 'var(--bg-subtle)',
                            boxShadow: taskIndicator,
                          }}
                        >
                          <td
                            className="py-1.5 pl-8 pr-3 border-b"
                            style={{
                              borderColor: 'var(--border-default)',
                              boxShadow: taskIndicator,
                            }}
                          >
                            <div className="flex items-center gap-1.5">
                              {!isPresentationMode &&
                                statusFilter !== 'archived' &&
                                (canReorder ? (
                                  <ReorderHandle
                                    item={taskReorderItem}
                                    label={task.name}
                                    onDragStateChange={handleReorderDragState}
                                    onKeyboardMove={(delta) =>
                                      keyboardReorder(
                                        visibleReorderItems,
                                        taskReorderItem,
                                        delta,
                                        { reorderProject, reorderTask },
                                      )
                                    }
                                  />
                                ) : (
                                  <ReorderHandleSpacer />
                                ))}
                              <HealthDot health={tm.health} />
                              {isPresentationMode ? (
                                <span>{task.name}</span>
                              ) : (
                                <>
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
                                    className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer print:hidden"
                                  >
                                    Details
                                  </button>
                                </>
                              )}
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
                            {isPresentationMode ? (
                              <StatusPill status={task.status} />
                            ) : (
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
                                <option value="backlog">Backlog</option>
                          <option value="planned">Planned</option>
                                <option value="in_progress">In Progress</option>
                                <option value="on_hold">On Hold</option>
                                <option value="completed">Completed</option>
                              </select>
                            )}
                          </td>

                          <td
                            className="py-1.5 px-3 border-b"
                            style={{ borderColor: 'var(--border-default)' }}
                          >
                            {isPresentationMode ? (
                              <PriorityBadge priority={task.priority} />
                            ) : (
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
                            )}
                          </td>

                          <td
                            className="py-1.5 px-3 border-b"
                            style={{ borderColor: 'var(--border-default)' }}
                          >
                            {isPresentationMode ? (
                              <span>{formatShortDate(task.expected_start)}</span>
                            ) : (
                              <input
                                type="date"
                                value={task.expected_start ?? ''}
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
                            )}
                          </td>

                          <td
                            className="py-1.5 px-3 border-b"
                            style={{ borderColor: 'var(--border-default)' }}
                          >
                            {isPresentationMode ? (
                              <span>{formatShortDate(task.expected_end)}</span>
                            ) : (
                              <input
                                type="date"
                                min={task.expected_start ?? undefined}
                                value={task.expected_end ?? ''}
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
                            )}
                          </td>

                          <td
                            className="py-1.5 px-3 border-b"
                            style={{ borderColor: 'var(--border-default)' }}
                          >
                            {isPresentationMode ? (
                              <span>{formatShortDate(task.required_by)}</span>
                            ) : (
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
                            )}
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
                            {isPresentationMode ? (
                              <span>{task.percent_complete}%</span>
                            ) : (
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
                            )}
                          </td>
                        </tr>
                      );
                    })}

                  {isOpen && !isPresentationMode && (
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
            {sortedProjects.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="p-8 text-center text-xs"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {statusFilter === 'archived'
                    ? 'No archived projects yet. Archive completed projects from the Gantt Completed tray or project inspector.'
                    : 'No projects match the active search or status filter.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
