import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { computeWeeklyCapacityMatrix } from '../engine/capacity';
import { addWorkingDays, generateWeeks, snapToWorkingDay, todayIsoLocal } from '../engine/dates';
import { canAddDependency, previewDependencyCascade } from '../engine/dependencies';
import { computeScheduleMetrics, recalculateProjectRollups } from '../engine/rollup';
import type {
  Assignment,
  CascadePreview,
  Dependency,
  Person,
  PlanDocument,
  Project,
  Task,
  Unavailability,
} from '../types/plan';
import { api } from './api';

export type AppView = 'timeline' | 'people' | 'capacity' | 'table' | 'dashboard';
export type SaveStatus = 'loading' | 'saved' | 'saving' | 'error';

export interface SelectedEntity {
  type: 'project' | 'task';
  id: string;
  projectId: string;
}

export interface WhatIfSummary {
  changedProjectsCount: number;
  lateProjectsDelta: number;
  overallocatedPeopleDelta: number;
}

const EMPTY_PLAN: PlanDocument = {
  projects: [],
  tasks: [],
  people: [],
  assignments: [],
  unavailabilities: [],
  dependencies: [],
};

const MAX_HISTORY = 50;

const PROJECT_PALETTE = [
  '#2563eb',
  '#7c3aed',
  '#059669',
  '#d97706',
  '#dc2626',
  '#0891b2',
  '#4f46e5',
  '#db2777',
];

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
}

interface PlanContextValue {
  plan: PlanDocument;
  livePlan: PlanDocument;
  todayIso: string;
  saveStatus: SaveStatus;
  errorMessage: string | null;
  clearError: () => void;

  // Navigation & UI panels
  activeView: AppView;
  setActiveView: (v: AppView) => void;
  selectedEntity: SelectedEntity | null;
  setSelectedEntity: (sel: SelectedEntity | null) => void;
  teamDrawerOpen: boolean;
  setTeamDrawerOpen: (open: boolean) => void;
  portabilityModalOpen: boolean;
  setPortabilityModalOpen: (open: boolean) => void;
  snapshotModalOpen: boolean;
  setSnapshotModalOpen: (open: boolean) => void;
  isPresentationMode: boolean;
  setIsPresentationMode: (active: boolean) => void;

  // Undo / Redo
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;

  // What-if Mode
  isWhatIfMode: boolean;
  whatIfStepCount: number;
  whatIfSummary: WhatIfSummary | null;
  enterWhatIfMode: () => void;
  applyWhatIfChanges: () => void;
  discardWhatIfChanges: () => void;

  // Cascade Preview
  pendingCascade: CascadePreview | null;
  acceptCascade: () => void;
  applyDirectMoveOnly: () => void;
  cancelCascade: () => void;

  // Plan mutations
  commitPlan: (next: PlanDocument) => void;
  commitWithCascadeCheck: (next: PlanDocument, triggerLabel: string) => void;
  replaceFromExternalLoad: (loaded: PlanDocument) => void;
  loadSamplePlan: () => Promise<void>;
  clearAllPlanData: () => Promise<void>;

  // Entity helpers
  createProject: (partial?: Partial<Project>) => Project;
  duplicateProject: (projectId: string) => void;
  deleteProject: (projectId: string) => void;
  updateProject: (projectId: string, patch: Partial<Project>, checkCascade?: boolean) => void;
  addTask: (projectId: string, name?: string) => Task | null;
  updateTask: (taskId: string, patch: Partial<Task>, checkCascade?: boolean) => void;
  deleteTask: (taskId: string) => void;

  addPerson: (name: string) => Person | null;
  renamePerson: (personId: string, name: string) => void;
  removePerson: (personId: string) => void;

  upsertAssignment: (
    assignment: Omit<Assignment, 'id'> & { id?: string },
  ) => void;
  assignPersonToPlaceholder: (assignmentId: string, personId: string) => void;
  removeAssignment: (assignmentId: string) => void;

  addUnavailability: (entry: Omit<Unavailability, 'id'>) => void;
  removeUnavailability: (id: string) => void;

  addDependency: (
    dep: Omit<Dependency, 'id'>,
  ) => { ok: boolean; reason?: string };
  removeDependency: (depId: string) => void;
}

const PlanContext = createContext<PlanContextValue | null>(null);

function countOverallocatedPeople(plan: PlanDocument, todayIso: string): number {
  if (plan.people.length === 0 || plan.projects.length === 0) return 0;
  const starts = plan.projects.map((p) => p.expected_start).concat(todayIso).sort();
  const ends = plan.projects.map((p) => p.expected_end).concat(todayIso).sort();
  const weeks = generateWeeks(starts[0], ends[ends.length - 1]);
  const matrix = computeWeeklyCapacityMatrix(plan, weeks);
  let count = 0;
  for (const p of plan.people) {
    const row = matrix.get(p.id);
    if (!row) continue;
    const hasOver = Array.from(row.values()).some(
      (c) => c.weekStart >= todayIso && c.weeklyPct > 100,
    );
    if (hasOver) count += 1;
  }
  return count;
}

export function PlanProvider({ children }: { children: React.ReactNode }) {
  const [livePlan, setLivePlan] = useState<PlanDocument>(EMPTY_PLAN);
  const [undoStack, setUndoStack] = useState<PlanDocument[]>([]);
  const [redoStack, setRedoStack] = useState<PlanDocument[]>([]);

  const [isWhatIfMode, setIsWhatIfMode] = useState(false);
  const [whatIfPlan, setWhatIfPlan] = useState<PlanDocument | null>(null);
  const [whatIfUndo, setWhatIfUndo] = useState<PlanDocument[]>([]);
  const [whatIfRedo, setWhatIfRedo] = useState<PlanDocument[]>([]);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<AppView>('timeline');
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity | null>(null);
  const [teamDrawerOpen, setTeamDrawerOpen] = useState(false);
  const [portabilityModalOpen, setPortabilityModalOpen] = useState(false);
  const [snapshotModalOpen, setSnapshotModalOpen] = useState(false);
  const [isPresentationMode, setIsPresentationMode] = useState(false);
  const [pendingCascade, setPendingCascade] = useState<CascadePreview | null>(null);

  const todayIso = useMemo(() => todayIsoLocal(), []);
  const saveCounterRef = useRef(0);

  const plan = isWhatIfMode && whatIfPlan ? whatIfPlan : livePlan;

  const persistLivePlan = useCallback(async (nextLive: PlanDocument) => {
    const seq = ++saveCounterRef.current;
    setSaveStatus('saving');
    try {
      await api.savePlan(nextLive);
      if (seq === saveCounterRef.current) {
        setSaveStatus('saved');
      }
    } catch (err) {
      if (seq === saveCounterRef.current) {
        setSaveStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'Failed to save plan');
      }
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    api
      .getPlan()
      .then((loaded) => {
        if (!mounted) return;
        setLivePlan(recalculateProjectRollups(loaded));
        setSaveStatus('saved');
      })
      .catch((err) => {
        if (!mounted) return;
        setSaveStatus('error');
        setErrorMessage(err instanceof Error ? err.message : 'Could not connect to local API');
      });
    return () => {
      mounted = false;
    };
  }, []);

  const commitPlan = useCallback(
    (rawNext: PlanDocument) => {
      const normalized = recalculateProjectRollups(rawNext);
      if (isWhatIfMode) {
        setWhatIfPlan((prev) => {
          if (prev) {
            setWhatIfUndo((u) => [...u.slice(-(MAX_HISTORY - 1)), prev]);
            setWhatIfRedo([]);
          }
          return normalized;
        });
      } else {
        setLivePlan((prev) => {
          setUndoStack((u) => [...u.slice(-(MAX_HISTORY - 1)), prev]);
          setRedoStack([]);
          return normalized;
        });
        void persistLivePlan(normalized);
      }
    },
    [isWhatIfMode, persistLivePlan],
  );

  const commitWithCascadeCheck = useCallback(
    (rawNext: PlanDocument, triggerLabel: string) => {
      const preview = previewDependencyCascade(plan, rawNext, triggerLabel, todayIso);
      if (preview.hasDownstreamChanges) {
        setPendingCascade(preview);
      } else {
        commitPlan(preview.directOnlyPlan);
      }
    },
    [plan, todayIso, commitPlan],
  );

  const acceptCascade = useCallback(() => {
    if (!pendingCascade) return;
    const target = pendingCascade.proposedPlan;
    setPendingCascade(null);
    commitPlan(target);
  }, [pendingCascade, commitPlan]);

  const applyDirectMoveOnly = useCallback(() => {
    if (!pendingCascade) return;
    const target = pendingCascade.directOnlyPlan;
    setPendingCascade(null);
    commitPlan(target);
  }, [pendingCascade, commitPlan]);

  const cancelCascade = useCallback(() => {
    setPendingCascade(null);
  }, []);

  const undo = useCallback(() => {
    if (isWhatIfMode) {
      if (whatIfUndo.length === 0 || !whatIfPlan) return;
      const prev = whatIfUndo[whatIfUndo.length - 1];
      setWhatIfUndo((u) => u.slice(0, -1));
      setWhatIfRedo((r) => [...r, whatIfPlan]);
      setWhatIfPlan(prev);
      return;
    }
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((u) => u.slice(0, -1));
    setRedoStack((r) => [...r, livePlan]);
    setLivePlan(prev);
    void persistLivePlan(prev);
  }, [isWhatIfMode, whatIfUndo, whatIfPlan, undoStack, livePlan, persistLivePlan]);

  const redo = useCallback(() => {
    if (isWhatIfMode) {
      if (whatIfRedo.length === 0 || !whatIfPlan) return;
      const next = whatIfRedo[whatIfRedo.length - 1];
      setWhatIfRedo((r) => r.slice(0, -1));
      setWhatIfUndo((u) => [...u, whatIfPlan]);
      setWhatIfPlan(next);
      return;
    }
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((u) => [...u, livePlan]);
    setLivePlan(next);
    void persistLivePlan(next);
  }, [isWhatIfMode, whatIfRedo, whatIfPlan, redoStack, livePlan, persistLivePlan]);

  // Global Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        (e.key.toLowerCase() === 'z' && e.shiftKey) ||
        e.key.toLowerCase() === 'y'
      ) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  const enterWhatIfMode = useCallback(() => {
    setWhatIfPlan(structuredClone(livePlan));
    setWhatIfUndo([]);
    setWhatIfRedo([]);
    setIsWhatIfMode(true);
  }, [livePlan]);

  const applyWhatIfChanges = useCallback(() => {
    if (!whatIfPlan) {
      setIsWhatIfMode(false);
      return;
    }
    const normalized = recalculateProjectRollups(whatIfPlan);
    setUndoStack((u) => [...u.slice(-(MAX_HISTORY - 1)), livePlan]);
    setRedoStack([]);
    setLivePlan(normalized);
    setIsWhatIfMode(false);
    setWhatIfPlan(null);
    setWhatIfUndo([]);
    setWhatIfRedo([]);
    void persistLivePlan(normalized);
  }, [whatIfPlan, livePlan, persistLivePlan]);

  const discardWhatIfChanges = useCallback(() => {
    setIsWhatIfMode(false);
    setWhatIfPlan(null);
    setWhatIfUndo([]);
    setWhatIfRedo([]);
    setPendingCascade(null);
  }, []);

  const whatIfSummary = useMemo<WhatIfSummary | null>(() => {
    if (!isWhatIfMode || !whatIfPlan) return null;
    const liveProjMap = new Map(livePlan.projects.map((p) => [p.id, p]));
    let changedProjectsCount = Math.abs(whatIfPlan.projects.length - livePlan.projects.length);
    for (const wp of whatIfPlan.projects) {
      const lp = liveProjMap.get(wp.id);
      if (
        !lp ||
        lp.expected_start !== wp.expected_start ||
        lp.expected_end !== wp.expected_end ||
        lp.status !== wp.status ||
        lp.percent_complete !== wp.percent_complete
      ) {
        if (lp) changedProjectsCount += 1;
      }
    }
    const liveLate = livePlan.projects.filter(
      (p) => computeScheduleMetrics(p).isForecastLate,
    ).length;
    const whatIfLate = whatIfPlan.projects.filter(
      (p) => computeScheduleMetrics(p).isForecastLate,
    ).length;

    const liveOver = countOverallocatedPeople(livePlan, todayIso);
    const whatIfOver = countOverallocatedPeople(whatIfPlan, todayIso);

    return {
      changedProjectsCount,
      lateProjectsDelta: whatIfLate - liveLate,
      overallocatedPeopleDelta: whatIfOver - liveOver,
    };
  }, [isWhatIfMode, whatIfPlan, livePlan, todayIso]);

  const replaceFromExternalLoad = useCallback((loaded: PlanDocument) => {
    const normalized = recalculateProjectRollups(loaded);
    setIsWhatIfMode(false);
    setWhatIfPlan(null);
    setUndoStack([]);
    setRedoStack([]);
    setSelectedEntity(null);
    setLivePlan(normalized);
    setSaveStatus('saved');
  }, []);

  const loadSamplePlan = useCallback(async () => {
    setSaveStatus('saving');
    try {
      const seeded = await api.seedSamplePlan();
      replaceFromExternalLoad(seeded);
    } catch (err) {
      setSaveStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load sample plan');
    }
  }, [replaceFromExternalLoad]);

  const clearAllPlanData = useCallback(async () => {
    setSaveStatus('saving');
    try {
      const cleared = await api.clearPlan();
      replaceFromExternalLoad(cleared);
    } catch (err) {
      setSaveStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Failed to clear plan');
    }
  }, [replaceFromExternalLoad]);

  // --- Entity helper actions ---
  const createProject = useCallback(
    (partial?: Partial<Project>): Project => {
      const defaultStart = snapToWorkingDay(todayIso, 'forward');
      const defaultEnd = addWorkingDays(defaultStart, 9); // 2 working weeks
      const newProj: Project = {
        id: uid('proj'),
        name: partial?.name?.trim() || 'New Project',
        description: partial?.description ?? '',
        expected_start: partial?.expected_start ?? defaultStart,
        actual_start: partial?.actual_start ?? null,
        expected_end: partial?.expected_end ?? defaultEnd,
        original_expected_end:
          partial?.original_expected_end ?? partial?.expected_end ?? defaultEnd,
        required_by: partial?.required_by ?? null,
        actual_end: partial?.actual_end ?? null,
        percent_complete: partial?.percent_complete ?? 0,
        auto_progress: partial?.auto_progress ?? true,
        status: partial?.status ?? 'planned',
        priority: partial?.priority ?? 'medium',
        color:
          partial?.color ??
          PROJECT_PALETTE[plan.projects.length % PROJECT_PALETTE.length],
        notes: partial?.notes ?? '',
        sort_order: plan.projects.length,
      };
      commitPlan({
        ...plan,
        projects: [...plan.projects, newProj],
      });
      setSelectedEntity({ type: 'project', id: newProj.id, projectId: newProj.id });
      return newProj;
    },
    [plan, todayIso, commitPlan],
  );

  const duplicateProject = useCallback(
    (projectId: string) => {
      const src = plan.projects.find((p) => p.id === projectId);
      if (!src) return;
      const newProjId = uid('proj');
      const copyProj: Project = {
        ...src,
        id: newProjId,
        name: `${src.name} (Copy)`,
        sort_order: plan.projects.length,
      };

      const srcTasks = plan.tasks.filter((t) => t.project_id === projectId);
      const taskIdMap = new Map<string, string>();
      const copiedTasks: Task[] = srcTasks.map((t) => {
        const newTid = uid('task');
        taskIdMap.set(t.id, newTid);
        return { ...t, id: newTid, project_id: newProjId };
      });

      const copiedAssignments: Assignment[] = plan.assignments
        .filter((a) => a.project_id === projectId)
        .map((a) => ({
          ...a,
          id: uid('asg'),
          project_id: newProjId,
          task_id: a.task_id ? (taskIdMap.get(a.task_id) ?? null) : null,
        }));

      const copiedIntraDeps: Dependency[] = plan.dependencies
        .filter(
          (d) =>
            d.from_type === 'task' &&
            d.to_type === 'task' &&
            taskIdMap.has(d.from_id) &&
            taskIdMap.has(d.to_id),
        )
        .map((d) => ({
          id: uid('dep'),
          from_type: 'task',
          from_id: taskIdMap.get(d.from_id)!,
          to_type: 'task',
          to_id: taskIdMap.get(d.to_id)!,
        }));

      commitPlan({
        ...plan,
        projects: [...plan.projects, copyProj],
        tasks: [...plan.tasks, ...copiedTasks],
        assignments: [...plan.assignments, ...copiedAssignments],
        dependencies: [...plan.dependencies, ...copiedIntraDeps],
      });
      setSelectedEntity({ type: 'project', id: newProjId, projectId: newProjId });
    },
    [plan, commitPlan],
  );

  const deleteProject = useCallback(
    (projectId: string) => {
      const childTaskIds = new Set(
        plan.tasks.filter((t) => t.project_id === projectId).map((t) => t.id),
      );
      if (selectedEntity?.projectId === projectId) {
        setSelectedEntity(null);
      }
      commitPlan({
        ...plan,
        projects: plan.projects.filter((p) => p.id !== projectId),
        tasks: plan.tasks.filter((t) => t.project_id !== projectId),
        assignments: plan.assignments.filter((a) => a.project_id !== projectId),
        dependencies: plan.dependencies.filter((d) => {
          const fromRemoved =
            (d.from_type === 'project' && d.from_id === projectId) ||
            (d.from_type === 'task' && childTaskIds.has(d.from_id));
          const toRemoved =
            (d.to_type === 'project' && d.to_id === projectId) ||
            (d.to_type === 'task' && childTaskIds.has(d.to_id));
          return !fromRemoved && !toRemoved;
        }),
      });
    },
    [plan, selectedEntity, commitPlan],
  );

  const updateProject = useCallback(
    (projectId: string, patch: Partial<Project>, checkCascade = false) => {
      const existing = plan.projects.find((p) => p.id === projectId);
      if (!existing) return;
      const merged: Project = { ...existing, ...patch };
      if (merged.expected_end < merged.expected_start) {
        merged.expected_end = merged.expected_start;
      }
      const next: PlanDocument = {
        ...plan,
        projects: plan.projects.map((p) => (p.id === projectId ? merged : p)),
      };
      if (checkCascade) {
        commitWithCascadeCheck(next, merged.name);
      } else {
        commitPlan(next);
      }
    },
    [plan, commitPlan, commitWithCascadeCheck],
  );

  const addTask = useCallback(
    (projectId: string, name = 'New Phase'): Task | null => {
      const proj = plan.projects.find((p) => p.id === projectId);
      if (!proj) return null;
      const siblings = plan.tasks.filter((t) => t.project_id === projectId);
      const start =
        siblings.length > 0
          ? snapToWorkingDay(siblings[siblings.length - 1].expected_end, 'forward')
          : proj.expected_start;
      const taskStart =
        siblings.length > 0 ? addWorkingDays(start, 1) : proj.expected_start;
      const taskEnd = addWorkingDays(taskStart, 4);

      const newTask: Task = {
        id: uid('task'),
        project_id: projectId,
        name,
        description: '',
        expected_start: taskStart,
        actual_start: null,
        expected_end: taskEnd,
        original_expected_end: taskEnd,
        required_by: null,
        actual_end: null,
        percent_complete: 0,
        status: 'planned',
        priority: proj.priority,
        notes: '',
        sort_order: siblings.length,
      };
      commitWithCascadeCheck(
        {
          ...plan,
          tasks: [...plan.tasks, newTask],
        },
        `${proj.name} — ${newTask.name}`,
      );
      return newTask;
    },
    [plan, commitWithCascadeCheck],
  );

  const updateTask = useCallback(
    (taskId: string, patch: Partial<Task>, checkCascade = false) => {
      const existing = plan.tasks.find((t) => t.id === taskId);
      if (!existing) return;
      const merged: Task = { ...existing, ...patch };
      if (merged.expected_end < merged.expected_start) {
        merged.expected_end = merged.expected_start;
      }
      const next: PlanDocument = {
        ...plan,
        tasks: plan.tasks.map((t) => (t.id === taskId ? merged : t)),
      };
      if (checkCascade) {
        commitWithCascadeCheck(next, merged.name);
      } else {
        commitPlan(next);
      }
    },
    [plan, commitPlan, commitWithCascadeCheck],
  );

  const deleteTask = useCallback(
    (taskId: string) => {
      if (selectedEntity?.type === 'task' && selectedEntity.id === taskId) {
        setSelectedEntity({
          type: 'project',
          id: selectedEntity.projectId,
          projectId: selectedEntity.projectId,
        });
      }
      commitPlan({
        ...plan,
        tasks: plan.tasks.filter((t) => t.id !== taskId),
        assignments: plan.assignments.filter((a) => a.task_id !== taskId),
        dependencies: plan.dependencies.filter(
          (d) =>
            !(d.from_type === 'task' && d.from_id === taskId) &&
            !(d.to_type === 'task' && d.to_id === taskId),
        ),
      });
    },
    [plan, selectedEntity, commitPlan],
  );

  const addPerson = useCallback(
    (name: string): Person | null => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const person: Person = {
        id: uid('person'),
        name: trimmed,
        sort_order: plan.people.length,
      };
      commitPlan({
        ...plan,
        people: [...plan.people, person],
      });
      return person;
    },
    [plan, commitPlan],
  );

  const renamePerson = useCallback(
    (personId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      commitPlan({
        ...plan,
        people: plan.people.map((p) => (p.id === personId ? { ...p, name: trimmed } : p)),
      });
    },
    [plan, commitPlan],
  );

  const removePerson = useCallback(
    (personId: string) => {
      commitPlan({
        ...plan,
        people: plan.people.filter((p) => p.id !== personId),
        assignments: plan.assignments.filter((a) => a.person_id !== personId),
        unavailabilities: plan.unavailabilities.filter((u) => u.person_id !== personId),
      });
    },
    [plan, commitPlan],
  );

  const upsertAssignment = useCallback(
    (input: Omit<Assignment, 'id'> & { id?: string }) => {
      if (input.id) {
        commitPlan({
          ...plan,
          assignments: plan.assignments.map((a) =>
            a.id === input.id ? { ...a, ...input, id: input.id } : a,
          ),
        });
        return;
      }
      // Only deduplicate named person assignments; allow multiple distinct TBD slots on a project
      const existing = input.person_id
        ? plan.assignments.find(
            (a) =>
              a.person_id === input.person_id &&
              a.project_id === input.project_id &&
              (a.task_id ?? null) === (input.task_id ?? null),
          )
        : undefined;
      if (existing) {
        commitPlan({
          ...plan,
          assignments: plan.assignments.map((a) =>
            a.id === existing.id ? { ...existing, ...input, id: existing.id } : a,
          ),
        });
      } else {
        commitPlan({
          ...plan,
          assignments: [
            ...plan.assignments,
            {
              id: uid('asg'),
              person_id: input.person_id ?? null,
              placeholder_label: input.person_id
                ? null
                : input.placeholder_label?.trim() || 'TBD',
              project_id: input.project_id,
              task_id: input.task_id ?? null,
              allocation_pct: input.allocation_pct,
              start_date: input.start_date ?? null,
              end_date: input.end_date ?? null,
            },
          ],
        });
      }
    },
    [plan, commitPlan],
  );

  const assignPersonToPlaceholder = useCallback(
    (assignmentId: string, personId: string) => {
      const target = plan.assignments.find((a) => a.id === assignmentId);
      if (!target) return;
      commitPlan({
        ...plan,
        assignments: plan.assignments.map((a) =>
          a.id === assignmentId
            ? { ...a, person_id: personId, placeholder_label: null }
            : a,
        ),
      });
    },
    [plan, commitPlan],
  );

  const removeAssignment = useCallback(
    (assignmentId: string) => {
      commitPlan({
        ...plan,
        assignments: plan.assignments.filter((a) => a.id !== assignmentId),
      });
    },
    [plan, commitPlan],
  );

  const addUnavailability = useCallback(
    (entry: Omit<Unavailability, 'id'>) => {
      commitPlan({
        ...plan,
        unavailabilities: [
          ...plan.unavailabilities,
          { ...entry, id: uid('leave') },
        ],
      });
    },
    [plan, commitPlan],
  );

  const removeUnavailability = useCallback(
    (id: string) => {
      commitPlan({
        ...plan,
        unavailabilities: plan.unavailabilities.filter((u) => u.id !== id),
      });
    },
    [plan, commitPlan],
  );

  const addDependency = useCallback(
    (dep: Omit<Dependency, 'id'>): { ok: boolean; reason?: string } => {
      const check = canAddDependency(
        plan,
        dep.from_type,
        dep.from_id,
        dep.to_type,
        dep.to_id,
      );
      if (!check.ok) {
        return check;
      }
      const candidate: Dependency = { ...dep, id: uid('dep') };
      const nextPlan: PlanDocument = {
        ...plan,
        dependencies: [...plan.dependencies, candidate],
      };
      commitWithCascadeCheck(nextPlan, 'New dependency link');
      return { ok: true };
    },
    [plan, commitWithCascadeCheck],
  );

  const removeDependency = useCallback(
    (depId: string) => {
      commitPlan({
        ...plan,
        dependencies: plan.dependencies.filter((d) => d.id !== depId),
      });
    },
    [plan, commitPlan],
  );

  const canUndo = isWhatIfMode ? whatIfUndo.length > 0 : undoStack.length > 0;
  const canRedo = isWhatIfMode ? whatIfRedo.length > 0 : redoStack.length > 0;

  const value = useMemo<PlanContextValue>(
    () => ({
      plan,
      livePlan,
      todayIso,
      saveStatus,
      errorMessage,
      clearError: () => setErrorMessage(null),
      activeView,
      setActiveView,
      selectedEntity,
      setSelectedEntity,
      teamDrawerOpen,
      setTeamDrawerOpen,
      portabilityModalOpen,
      setPortabilityModalOpen,
      snapshotModalOpen,
      setSnapshotModalOpen,
      isPresentationMode,
      setIsPresentationMode,
      canUndo,
      canRedo,
      undo,
      redo,
      isWhatIfMode,
      whatIfStepCount: whatIfUndo.length,
      whatIfSummary,
      enterWhatIfMode,
      applyWhatIfChanges,
      discardWhatIfChanges,
      pendingCascade,
      acceptCascade,
      applyDirectMoveOnly,
      cancelCascade,
      commitPlan,
      commitWithCascadeCheck,
      replaceFromExternalLoad,
      loadSamplePlan,
      clearAllPlanData,
      createProject,
      duplicateProject,
      deleteProject,
      updateProject,
      addTask,
      updateTask,
      deleteTask,
      addPerson,
      renamePerson,
      removePerson,
      upsertAssignment,
      assignPersonToPlaceholder,
      removeAssignment,
      addUnavailability,
      removeUnavailability,
      addDependency,
      removeDependency,
    }),
    [
      plan,
      livePlan,
      todayIso,
      saveStatus,
      errorMessage,
      activeView,
      selectedEntity,
      teamDrawerOpen,
      portabilityModalOpen,
      snapshotModalOpen,
      isPresentationMode,
      canUndo,
      canRedo,
      undo,
      redo,
      isWhatIfMode,
      whatIfUndo.length,
      whatIfSummary,
      enterWhatIfMode,
      applyWhatIfChanges,
      discardWhatIfChanges,
      pendingCascade,
      acceptCascade,
      applyDirectMoveOnly,
      cancelCascade,
      commitPlan,
      commitWithCascadeCheck,
      replaceFromExternalLoad,
      loadSamplePlan,
      clearAllPlanData,
      createProject,
      duplicateProject,
      deleteProject,
      updateProject,
      addTask,
      updateTask,
      deleteTask,
      addPerson,
      renamePerson,
      removePerson,
      upsertAssignment,
      assignPersonToPlaceholder,
      removeAssignment,
      addUnavailability,
      removeUnavailability,
      addDependency,
      removeDependency,
    ],
  );

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan(): PlanContextValue {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error('usePlan must be used inside PlanProvider');
  return ctx;
}
