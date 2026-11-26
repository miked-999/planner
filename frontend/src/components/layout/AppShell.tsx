import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  CalendarRange,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  DatabaseBackup,
  Eye,
  FlaskConical,
  GanttChart,
  GitCompareArrows,
  History,
  Inbox,
  LayoutDashboard,
  Moon,
  Plus,
  Redo2,
  Sun,
  Table2,
  TableProperties,
  Undo2,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { formatMediumDate } from '../../engine/dates';
import { type AppView, usePlan } from '../../store/PlanContext';

function ThemeToggleButton() {
  const [renderedDark, setRenderedDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const meta = document.querySelector('meta[name="color-scheme"]')?.getAttribute('content');
    if (meta === 'dark') return true;
    if (meta === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const syncState = () => {
      const meta = document
        .querySelector('meta[name="color-scheme"]')
        ?.getAttribute('content');
      if (meta === 'dark') setRenderedDark(true);
      else if (meta === 'light') setRenderedDark(false);
      else setRenderedDark(mql.matches);
    };
    mql.addEventListener('change', syncState);
    window.addEventListener('storage', syncState);
    return () => {
      mql.removeEventListener('change', syncState);
      window.removeEventListener('storage', syncState);
    };
  }, []);

  const toggleScheme = () => {
    const target = renderedDark ? 'light' : 'dark';
    const systemScheme = window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
    const metaEl = document.querySelector('meta[name="color-scheme"]');

    try {
      if (target === systemScheme) {
        localStorage.removeItem('color-scheme');
        if (metaEl) metaEl.setAttribute('content', 'light dark');
      } else {
        localStorage.setItem('color-scheme', target);
        if (metaEl) metaEl.setAttribute('content', target);
      }
    } catch {
      if (metaEl) metaEl.setAttribute('content', target);
    }
    setRenderedDark(target === 'dark');
  };

  return (
    <button
      type="button"
      onClick={toggleScheme}
      title={renderedDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={renderedDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="p-2 rounded-lg border transition-colors cursor-pointer hover:opacity-85"
      style={{
        borderColor: 'var(--border-default)',
        backgroundColor: 'var(--bg-surface)',
        color: 'var(--text-secondary)',
      }}
    >
      {renderedDark ? (
        <Sun className="w-4 h-4" aria-hidden="true" />
      ) : (
        <Moon className="w-4 h-4" aria-hidden="true" />
      )}
    </button>
  );
}

const NAV_ITEMS: { id: AppView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'timeline', label: 'Project Timeline', icon: GanttChart },
  { id: 'people', label: 'People Timeline', icon: Users },
  { id: 'capacity', label: 'Resource Capacity', icon: BarChart3 },
  { id: 'table', label: 'Project Table', icon: Table2 },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const {
    plan,
    todayIso,
    activeView,
    setActiveView,
    saveStatus,
    errorMessage,
    clearError,
    canUndo,
    canRedo,
    undo,
    redo,
    isWhatIfMode,
    whatIfStepCount,
    whatIfSummary,
    enterWhatIfMode,
    applyWhatIfChanges,
    discardWhatIfChanges,
    createProject,
    setSelectedEntity,
    setTeamDrawerOpen,
    setPortabilityModalOpen,
    snapshotModalOpen,
    setSnapshotModalOpen,
    checkpointsModalOpen,
    setCheckpointsModalOpen,
    setCompareSummaryModalOpen,
    activeBaseline,
    comparisonDiff,
    clearBaselineCompare,
    isPresentationMode,
    setIsPresentationMode,
  } = usePlan();

  const [collapsed, setCollapsed] = useState(false);
  const [whatIfNote, setWhatIfNote] = useState('');
  const backlogCount = plan.projects.filter(
    (p) => !p.expected_start || !p.expected_end || p.status === 'backlog',
  ).length;

  // Allow pressing Escape to exit Presentation Mode when no modal is open
  useEffect(() => {
    if (!isPresentationMode || snapshotModalOpen || checkpointsModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsPresentationMode(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPresentationMode, snapshotModalOpen, checkpointsModalOpen, setIsPresentationMode]);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Stakeholder Presentation Mode Header */}
      {isPresentationMode ? (
        <header
          className="h-14 shrink-0 flex items-center justify-between px-5 border-b gap-4 print:hidden"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-default)',
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
              <Eye className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="truncate">
              <span className="font-semibold text-sm">Project &amp; Resource Plan</span>
              <span
                className="ml-2.5 text-xs"
                style={{ color: 'var(--text-secondary)' }}
              >
                Read-only Stakeholder View · {formatMediumDate(todayIso)}
              </span>
            </div>
          </div>

          {/* Inline View Switcher Pills */}
          <nav aria-label="Presentation views" className="hidden md:flex items-center gap-1 p-1 rounded-lg border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }}>
            {NAV_ITEMS.map((item) => {
              const active = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveView(item.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                    active ? 'bg-blue-600 text-white shadow-2xs' : 'hover:opacity-85'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCheckpointsModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer hover:opacity-85"
              style={{ borderColor: 'var(--border-default)' }}
            >
              <History className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Compare</span>
            </button>
            <button
              type="button"
              onClick={() => setSnapshotModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Export PNG / PDF</span>
            </button>
            <ThemeToggleButton />
            <button
              type="button"
              onClick={() => setIsPresentationMode(false)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer hover:opacity-85"
              style={{ borderColor: 'var(--border-default)' }}
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Exit</span>
            </button>
          </div>
        </header>
      ) : (
        /* Standard Planning Top Header Bar */
        <header
          className="h-14 shrink-0 flex items-center justify-between px-4 border-b gap-3 print:hidden"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-default)',
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <CalendarRange className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="truncate">
              <span className="font-semibold text-sm tracking-tight">Project Planner</span>
              <span
                className="hidden sm:inline-block ml-2 text-xs px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  color: 'var(--text-secondary)',
                }}
              >
                {plan.projects.length} projects
                {backlogCount > 0 ? ` (${backlogCount} backlog)` : ''} ·{' '}
                {plan.people.length} people
              </span>
            </div>

            <span
              className="text-xs ml-2 hidden lg:inline-block"
              style={{ color: 'var(--text-muted)' }}
            >
              {isWhatIfMode
                ? 'Sandbox (DB paused)'
                : saveStatus === 'saving'
                  ? 'Saving…'
                  : saveStatus === 'error'
                    ? 'Save error'
                    : 'Saved locally'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Undo / Redo */}
            <div
              className="flex items-center rounded-lg border overflow-hidden"
              style={{ borderColor: 'var(--border-default)' }}
            >
              <button
                type="button"
                onClick={undo}
                disabled={!canUndo}
                title="Undo (Cmd/Ctrl+Z)"
                aria-label="Undo"
                className="p-2 disabled:opacity-35 hover:opacity-80 cursor-pointer disabled:cursor-default"
                style={{ color: 'var(--text-secondary)' }}
              >
                <Undo2 className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={redo}
                disabled={!canRedo}
                title="Redo (Cmd/Ctrl+Shift+Z)"
                aria-label="Redo"
                className="p-2 border-l disabled:opacity-35 hover:opacity-80 cursor-pointer disabled:cursor-default"
                style={{
                  borderColor: 'var(--border-default)',
                  color: 'var(--text-secondary)',
                }}
              >
                <Redo2 className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {/* What-if Mode Toggle */}
            {!isWhatIfMode ? (
              <button
                type="button"
                onClick={enterWhatIfMode}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer hover:border-amber-500/60"
                style={{
                  borderColor: 'var(--border-default)',
                  backgroundColor: 'var(--bg-subtle)',
                  color: 'var(--text-primary)',
                }}
              >
                <FlaskConical className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
                <span className="hidden md:inline">What-if Mode</span>
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/35">
                <FlaskConical className="w-3.5 h-3.5" aria-hidden="true" />
                What-if Active
              </span>
            )}

            {/* Checkpoints / Baselines / Compare */}
            <button
              type="button"
              onClick={() => setCheckpointsModalOpen(true)}
              title="Save plan checkpoints or compare against a baseline"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer transition-colors ${
                activeBaseline
                  ? 'border-indigo-500/60 bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 font-semibold'
                  : 'hover:opacity-85'
              }`}
              style={
                activeBaseline
                  ? undefined
                  : {
                      borderColor: 'var(--border-default)',
                      backgroundColor: 'var(--bg-surface)',
                      color: 'var(--text-primary)',
                    }
              }
            >
              <History className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden lg:inline">Checkpoints</span>
            </button>

            {/* Presentation Mode */}
            <button
              type="button"
              onClick={() => {
                setSelectedEntity(null);
                setIsPresentationMode(true);
              }}
              title="Clean read-only Stakeholder Presentation Mode"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer hover:opacity-85"
              style={{
                borderColor: 'var(--border-default)',
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-primary)',
              }}
            >
              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden xl:inline">Present</span>
            </button>

            {/* Snapshot Export (PNG / PDF) */}
            <button
              type="button"
              onClick={() => setSnapshotModalOpen(true)}
              title="Export PNG or Landscape PDF Snapshot"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer hover:opacity-85"
              style={{
                borderColor: 'var(--border-default)',
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-primary)',
              }}
            >
              <Camera className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden lg:inline">Snapshot</span>
            </button>

            {/* New Backlog Item + New Scheduled Project */}
            <button
              type="button"
              onClick={() => createProject(undefined, true)}
              title="Add an unscheduled project to the backlog (no dates required)"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-purple-500/35 bg-purple-500/10 hover:bg-purple-500/18 text-purple-700 dark:text-purple-300 transition-colors cursor-pointer"
            >
              <Inbox className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden md:inline">+ Backlog</span>
            </button>

            <button
              type="button"
              onClick={() => createProject()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>New Project</span>
            </button>

            {/* Data / Export / Backup */}
            <button
              type="button"
              onClick={() => setPortabilityModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer hover:opacity-85"
              style={{
                borderColor: 'var(--border-default)',
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-primary)',
              }}
            >
              <DatabaseBackup className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden xl:inline">Data</span>
            </button>

            <ThemeToggleButton />
          </div>
        </header>
      )}

      {/* What-if Active Sandbox Banner */}
      {isWhatIfMode && !isPresentationMode && (
        <div className="shrink-0 bg-amber-500/14 border-b border-amber-500/35 px-4 py-2 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex items-center gap-3 text-xs">
            <span className="font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
              <FlaskConical className="w-4 h-4" aria-hidden="true" />
              What-if Sandbox:
            </span>
            <span style={{ color: 'var(--text-primary)' }}>
              Experiment freely — your live SQLite plan is untouched until you apply.
            </span>
            {whatIfSummary && (
              <span className="hidden md:inline-flex items-center gap-2 ml-2">
                <span className="px-2 py-0.5 rounded bg-amber-500/20 font-medium">
                  {whatIfStepCount} edit{whatIfStepCount === 1 ? '' : 's'}
                </span>
                {whatIfSummary.lateProjectsDelta !== 0 && (
                  <span
                    className={`px-2 py-0.5 rounded font-medium ${
                      whatIfSummary.lateProjectsDelta > 0
                        ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                        : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                    }`}
                  >
                    {whatIfSummary.lateProjectsDelta > 0 ? '+' : ''}
                    {whatIfSummary.lateProjectsDelta} late project
                    {Math.abs(whatIfSummary.lateProjectsDelta) === 1 ? '' : 's'}
                  </span>
                )}
                {whatIfSummary.overallocatedPeopleDelta !== 0 && (
                  <span
                    className={`px-2 py-0.5 rounded font-medium ${
                      whatIfSummary.overallocatedPeopleDelta > 0
                        ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                        : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                    }`}
                  >
                    {whatIfSummary.overallocatedPeopleDelta > 0 ? '+' : ''}
                    {whatIfSummary.overallocatedPeopleDelta} overallocated
                  </span>
                )}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={whatIfNote}
              onChange={(e) => setWhatIfNote(e.target.value)}
              placeholder="Optional why-note (saves checkpoint on apply)…"
              aria-label="Optional why-note when applying What-if changes"
              className="w-64 px-2.5 py-1 rounded-md border border-amber-600/35 text-xs"
              style={{ backgroundColor: 'var(--bg-surface)' }}
            />
            <button
              type="button"
              onClick={() => {
                setWhatIfNote('');
                discardWhatIfChanges();
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border border-amber-600/30 hover:bg-amber-500/15 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              Discard
            </button>
            <button
              type="button"
              onClick={() => {
                applyWhatIfChanges(whatIfNote);
                setWhatIfNote('');
              }}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-md text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              Apply Changes
            </button>
          </div>
        </div>
      )}

      {/* Active Baseline Comparison Banner */}
      {activeBaseline && comparisonDiff && (
        <div className="shrink-0 bg-indigo-500/12 border-b border-indigo-500/35 px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-xs print:hidden">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="font-semibold text-indigo-700 dark:text-indigo-300 inline-flex items-center gap-1.5">
              <GitCompareArrows className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Comparing vs. &ldquo;{activeBaseline.label}&rdquo;</span>
            </span>
            {activeBaseline.note && (
              <span
                className="hidden lg:inline truncate max-w-xs italic"
                style={{ color: 'var(--text-secondary)' }}
                title={activeBaseline.note}
              >
                — &ldquo;{activeBaseline.note}&rdquo;
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 ml-1">
              {comparisonDiff.summary.slippedCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400 font-semibold">
                  {comparisonDiff.summary.slippedCount} slipped
                </span>
              )}
              {comparisonDiff.summary.addedCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-semibold">
                  +{comparisonDiff.summary.addedCount} added
                </span>
              )}
              {comparisonDiff.summary.reassignedCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 font-semibold">
                  {comparisonDiff.summary.reassignedCount} reassigned
                </span>
              )}
              {comparisonDiff.summary.totalChangedProjects === 0 && (
                <span style={{ color: 'var(--text-secondary)' }}>No changes</span>
              )}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCompareSummaryModalOpen(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-semibold cursor-pointer"
            >
              <TableProperties className="w-3.5 h-3.5" aria-hidden="true" />
              Delta Summary ({comparisonDiff.summary.totalChangedProjects})
            </button>
            <button
              type="button"
              onClick={() => setCheckpointsModalOpen(true)}
              className="px-2.5 py-1 rounded-md border border-indigo-500/35 hover:bg-indigo-500/15 font-medium cursor-pointer"
            >
              Switch
            </button>
            <button
              type="button"
              onClick={clearBaselineCompare}
              aria-label="Exit baseline comparison"
              className="p-1 rounded-md hover:bg-indigo-500/20 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* Error Toast Strip */}
      {errorMessage && (
        <div className="shrink-0 bg-red-500/15 border-b border-red-500/30 px-4 py-2 flex items-center justify-between text-xs text-red-600 dark:text-red-400 print:hidden">
          <span>{errorMessage}</span>
          <button type="button" onClick={clearError} className="underline cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* Body: Sidebar + Main Workspace */}
      <div className="flex-1 flex min-h-0">
        {!isPresentationMode && (
          <aside
            className={`shrink-0 border-r flex flex-col justify-between transition-[width] duration-150 print:hidden ${
              collapsed ? 'w-14' : 'w-52'
            }`}
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-default)',
            }}
          >
            <nav aria-label="Main views" className="p-2 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveView(item.id)}
                    title={collapsed ? item.label : undefined}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      active
                        ? 'bg-blue-600 text-white shadow-2xs'
                        : 'hover:bg-slate-500/10'
                    }`}
                    style={active ? undefined : { color: 'var(--text-secondary)' }}
                  >
                    <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </button>
                );
              })}

              <div
                className="my-2 border-t pt-2"
                style={{ borderColor: 'var(--border-default)' }}
              >
                <button
                  type="button"
                  onClick={() => setTeamDrawerOpen(true)}
                  title={collapsed ? 'Manage Team & Leave' : undefined}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium hover:bg-slate-500/10 cursor-pointer"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <UserCog className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {!collapsed && <span className="truncate">Team &amp; Leave</span>}
                </button>
              </div>
            </nav>

            <div className="p-2 border-t" style={{ borderColor: 'var(--border-default)' }}>
              <button
                type="button"
                onClick={() => setCollapsed((c) => !c)}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs hover:bg-slate-500/10 cursor-pointer"
                style={{ color: 'var(--text-muted)' }}
              >
                {collapsed ? (
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <>
                    <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                    <span>Collapse</span>
                  </>
                )}
              </button>
            </div>
          </aside>
        )}

        <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
