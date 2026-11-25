import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  DatabaseBackup,
  FlaskConical,
  GanttChart,
  LayoutDashboard,
  Moon,
  Plus,
  Redo2,
  Sun,
  Table2,
  Undo2,
  UserCog,
  Users,
  X,
} from 'lucide-react';
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
    setTeamDrawerOpen,
    setPortabilityModalOpen,
  } = usePlan();

  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top Header Bar */}
      <header
        className="h-14 shrink-0 flex items-center justify-between px-4 border-b gap-3"
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
              {plan.projects.length} projects · {plan.people.length} people
            </span>
          </div>

          <span className="text-xs ml-2 hidden md:inline-block" style={{ color: 'var(--text-muted)' }}>
            {isWhatIfMode
              ? 'Sandbox (DB paused)'
              : saveStatus === 'saving'
                ? 'Saving…'
                : saveStatus === 'error'
                  ? 'Save error'
                  : 'Saved locally'}
          </span>
        </div>

        {/* Right Controls */}
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
              <span>What-if Mode</span>
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/35">
              <FlaskConical className="w-3.5 h-3.5" aria-hidden="true" />
              What-if Active
            </span>
          )}

          {/* New Project */}
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer hover:opacity-85"
            style={{
              borderColor: 'var(--border-default)',
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-primary)',
            }}
          >
            <DatabaseBackup className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Import / Export</span>
          </button>

          <ThemeToggleButton />
        </div>
      </header>

      {/* What-if Active Sandbox Banner */}
      {isWhatIfMode && (
        <div className="shrink-0 bg-amber-500/14 border-b border-amber-500/35 px-4 py-2 flex flex-wrap items-center justify-between gap-3">
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={discardWhatIfChanges}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border border-amber-600/30 hover:bg-amber-500/15 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              Discard Changes
            </button>
            <button
              type="button"
              onClick={applyWhatIfChanges}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-md text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              Apply Changes
            </button>
          </div>
        </div>
      )}

      {/* Error Toast Strip */}
      {errorMessage && (
        <div className="shrink-0 bg-red-500/15 border-b border-red-500/30 px-4 py-2 flex items-center justify-between text-xs text-red-600 dark:text-red-400">
          <span>{errorMessage}</span>
          <button type="button" onClick={clearError} className="underline cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* Body: Sidebar + Main Workspace */}
      <div className="flex-1 flex min-h-0">
        <aside
          className={`shrink-0 border-r flex flex-col justify-between transition-[width] duration-150 ${
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

        <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
