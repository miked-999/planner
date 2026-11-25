import { useMemo } from 'react';
import {
  AlertTriangle,
  CalendarCheck2,
  Clock,
  FolderKanban,
  Plus,
  Sparkles,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  computePersonAvailability,
  computeWeeklyCapacityMatrix,
} from '../engine/capacity';
import {
  addCalendarDays,
  formatShortDate,
  generateWeeks,
  mondayOfWeek,
} from '../engine/dates';
import { findViolatedDependencyIds } from '../engine/dependencies';
import { computeScheduleMetrics } from '../engine/rollup';
import { usePlan } from '../store/PlanContext';
import { HeadroomBadge, HealthDot, StatusPill } from '../components/ui/StatusBadges';

export function DashboardView() {
  const {
    plan,
    todayIso,
    setActiveView,
    setSelectedEntity,
    createProject,
    loadSamplePlan,
  } = usePlan();

  const horizon4WeeksIso = useMemo(() => addCalendarDays(todayIso, 28), [todayIso]);

  const stats = useMemo(() => {
    const activeProjects = plan.projects.filter((p) => p.status === 'in_progress');
    const upcomingProjects = plan.projects.filter((p) => p.status === 'planned');
    const completingIn4Weeks = plan.projects.filter(
      (p) =>
        p.status !== 'completed' &&
        p.expected_end >= todayIso &&
        p.expected_end <= horizon4WeeksIso,
    );
    const lateProjects = plan.projects.filter(
      (p) => computeScheduleMetrics(p).isForecastLate,
    );

    const weeks8 = generateWeeks(mondayOfWeek(todayIso), addCalendarDays(todayIso, 56));
    const capMatrix = computeWeeklyCapacityMatrix(plan, weeks8);

    const overallocatedPeople: {
      id: string;
      name: string;
      peakPct: number;
      firstConflictWeek: string;
    }[] = [];

    for (const person of plan.people) {
      const row = capMatrix.get(person.id);
      if (!row) continue;
      let peak = 0;
      let firstWeek = '';
      for (const w of weeks8) {
        const pct = row.get(w.weekStart)?.weeklyPct ?? 0;
        if (pct > 100) {
          if (!firstWeek) firstWeek = w.shortRange;
          if (pct > peak) peak = pct;
        }
      }
      if (peak > 100) {
        overallocatedPeople.push({
          id: person.id,
          name: person.name,
          peakPct: peak,
          firstConflictWeek: firstWeek,
        });
      }
    }

    const peopleAvailability = plan.people
      .map((p) => ({
        person: p,
        avail: computePersonAvailability(plan, p.id, todayIso),
      }))
      .sort((a, b) => a.avail.availableDate.localeCompare(b.avail.availableDate));

    const becomingAvailableIn4Weeks = peopleAvailability.filter(
      ({ avail }) => avail.availableDate <= horizon4WeeksIso,
    );

    const upcomingDeliveries = plan.projects
      .filter((p) => p.status !== 'completed')
      .sort((a, b) => a.expected_end.localeCompare(b.expected_end))
      .slice(0, 6);

    const violatedDepIds = findViolatedDependencyIds(plan);

    return {
      activeProjects,
      upcomingProjects,
      completingIn4Weeks,
      lateProjects,
      overallocatedPeople,
      peopleAvailability,
      becomingAvailableIn4Weeks,
      upcomingDeliveries,
      violatedDepCount: violatedDepIds.size,
    };
  }, [plan, todayIso, horizon4WeeksIso]);

  if (plan.projects.length === 0 && plan.people.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="max-w-md space-y-4">
          <h2 className="text-lg font-semibold">Welcome to Project &amp; Resource Planner</h2>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            A lightweight forward-planning workspace alongside Jira. Load the sample plan to
            explore timelines, capacity heatmaps, dependency cascades, and What-if Mode, or
            create your first project.
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => createProject()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              New Project
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
        </div>
      </div>
    );
  }

  const kpis = [
    {
      label: 'Active Projects',
      value: stats.activeProjects.length,
      icon: FolderKanban,
      tone: 'text-blue-600 dark:text-blue-400 bg-blue-500/12',
      onClick: () => setActiveView('timeline'),
    },
    {
      label: 'Upcoming Projects',
      value: stats.upcomingProjects.length,
      icon: Clock,
      tone: 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/12',
      onClick: () => setActiveView('timeline'),
    },
    {
      label: 'Completing in 4 Weeks',
      value: stats.completingIn4Weeks.length,
      icon: CalendarCheck2,
      tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/12',
      onClick: () => setActiveView('table'),
    },
    {
      label: 'Forecast to Miss Deadline',
      value: stats.lateProjects.length,
      icon: AlertTriangle,
      tone:
        stats.lateProjects.length > 0
          ? 'text-red-600 dark:text-red-400 bg-red-500/15'
          : 'text-slate-500 bg-slate-500/10',
      onClick: () => setActiveView('table'),
    },
    {
      label: 'People Overallocated',
      value: stats.overallocatedPeople.length,
      icon: Users,
      tone:
        stats.overallocatedPeople.length > 0
          ? 'text-red-600 dark:text-red-400 bg-red-500/15'
          : 'text-slate-500 bg-slate-500/10',
      onClick: () => setActiveView('capacity'),
    },
    {
      label: 'Available in Next 4 Weeks',
      value: stats.becomingAvailableIn4Weeks.length,
      icon: UserCheck,
      tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/12',
      onClick: () => setActiveView('people'),
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-6 text-xs">
      {/* 6 Headline KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.label}
              type="button"
              onClick={card.onClick}
              className="p-4 rounded-xl border text-left transition-transform hover:-translate-y-0.5 cursor-pointer space-y-2"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-default)',
              }}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${card.tone}`}>
                <Icon className="w-4 h-4" aria-hidden="true" />
              </div>
              <div className="text-2xl font-bold tracking-tight">{card.value}</div>
              <div className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                {card.label}
              </div>
            </button>
          );
        })}
      </div>

      {/* Three Management Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Panel 1: Upcoming Completions */}
        <section
          className="rounded-xl border p-4 space-y-3"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-default)',
          }}
        >
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Upcoming Project Completions</h2>
            <button
              type="button"
              onClick={() => setActiveView('timeline')}
              className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              View timeline →
            </button>
          </div>

          <div className="divide-y" style={{ borderColor: 'var(--border-default)' }}>
            {stats.upcomingDeliveries.map((proj) => {
              const m = computeScheduleMetrics(proj);
              return (
                <button
                  key={proj.id}
                  type="button"
                  onClick={() => {
                    setSelectedEntity({
                      type: 'project',
                      id: proj.id,
                      projectId: proj.id,
                    });
                    setActiveView('timeline');
                  }}
                  className="w-full py-2.5 flex items-center justify-between gap-2 text-left hover:opacity-85 cursor-pointer"
                  style={{ borderColor: 'var(--border-default)' }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-semibold truncate">
                      <HealthDot health={m.health} />
                      <span className="truncate">{proj.name}</span>
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      Ends {formatShortDate(proj.expected_end)} · {proj.percent_complete}%
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    <HeadroomBadge headroomDays={m.headroomDays} />
                    <StatusPill status={proj.status} />
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Panel 2: Resource Availability */}
        <section
          className="rounded-xl border p-4 space-y-3"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-default)',
          }}
        >
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Upcoming Resource Availability</h2>
            <button
              type="button"
              onClick={() => setActiveView('people')}
              className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              People timeline →
            </button>
          </div>

          <div className="divide-y" style={{ borderColor: 'var(--border-default)' }}>
            {stats.peopleAvailability.map(({ person, avail }) => (
              <button
                key={person.id}
                type="button"
                onClick={() => setActiveView('people')}
                className="w-full py-2.5 flex items-center justify-between gap-2 text-left hover:opacity-85 cursor-pointer"
                style={{ borderColor: 'var(--border-default)' }}
              >
                <div>
                  <div className="font-semibold">{person.name}</div>
                  <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                    Current load: {avail.currentWeekPct}%
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded font-medium text-[11px] ${
                    avail.isAvailableNow
                      ? 'bg-emerald-500/14 text-emerald-700 dark:text-emerald-400'
                      : 'bg-blue-500/12 text-blue-600 dark:text-blue-400'
                  }`}
                >
                  {avail.isAvailableNow
                    ? `Now (${avail.freePct}% free)`
                    : `${formatShortDate(avail.availableDate)} (${avail.freePct}% free)`}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Panel 3: Planning Conflicts & Risks */}
        <section
          className="rounded-xl border p-4 space-y-3"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-default)',
          }}
        >
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Delivery &amp; Capacity Attention</h2>
            <button
              type="button"
              onClick={() => setActiveView('capacity')}
              className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              Capacity view →
            </button>
          </div>

          {stats.lateProjects.length === 0 &&
          stats.overallocatedPeople.length === 0 &&
          stats.violatedDepCount === 0 ? (
            <div
              className="p-4 rounded-lg border text-center"
              style={{
                borderColor: 'var(--border-default)',
                color: 'var(--text-secondary)',
              }}
            >
              🟢 No deadline breaches, broken dependencies, or resource overallocations.
            </div>
          ) : (
            <div className="space-y-2">
              {stats.lateProjects.map((p) => {
                const m = computeScheduleMetrics(p);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedEntity({ type: 'project', id: p.id, projectId: p.id });
                      setActiveView('timeline');
                    }}
                    className="w-full p-2.5 rounded-lg bg-red-500/10 border border-red-500/25 text-left hover:bg-red-500/15 cursor-pointer"
                  >
                    <div className="font-semibold text-red-600 dark:text-red-400">
                      Late Forecast: {p.name}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                      {m.daysOverdue} working days past required-by ({formatShortDate(p.required_by)})
                    </div>
                  </button>
                );
              })}

              {stats.overallocatedPeople.map((op) => (
                <button
                  key={op.id}
                  type="button"
                  onClick={() => setActiveView('capacity')}
                  className="w-full p-2.5 rounded-lg bg-amber-500/12 border border-amber-500/30 text-left hover:bg-amber-500/18 cursor-pointer"
                >
                  <div className="font-semibold text-amber-700 dark:text-amber-400">
                    Overallocated: {op.name} ({op.peakPct}%)
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                    Starting {op.firstConflictWeek}
                  </div>
                </button>
              ))}

              {stats.violatedDepCount > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveView('timeline')}
                  className="w-full p-2.5 rounded-lg bg-red-500/10 border border-red-500/25 text-left cursor-pointer"
                >
                  <div className="font-semibold text-red-600 dark:text-red-400">
                    {stats.violatedDepCount} Broken Finish-to-Start Dependency Link
                    {stats.violatedDepCount === 1 ? '' : 's'}
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                    Successor scheduled before predecessor finishes (shown in dashed red).
                  </div>
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
