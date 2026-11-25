import { useId, useMemo, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  ExternalLink,
  UserPlus,
  X,
} from 'lucide-react';
import { computeWeeklyCapacityMatrix } from '../engine/capacity';
import {
  addCalendarDays,
  formatShortDate,
  generateWeeks,
  mondayOfWeek,
} from '../engine/dates';
import { usePlan } from '../store/PlanContext';
import type { WeeklyCellCapacity } from '../types/plan';

export function CapacityView() {
  const {
    plan,
    todayIso,
    upsertAssignment,
    setSelectedEntity,
    setActiveView,
    setTeamDrawerOpen,
  } = usePlan();

  const captionId = useId();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedCell, setSelectedCell] = useState<{
    personId: string;
    weekStart: string;
  } | null>(null);

  const weeks = useMemo(() => {
    const startMonday = addCalendarDays(mondayOfWeek(todayIso), weekOffset * 7);
    const endMonday = addCalendarDays(startMonday, 11 * 7); // 12-week horizon
    return generateWeeks(startMonday, endMonday);
  }, [todayIso, weekOffset]);

  const matrix = useMemo(
    () => computeWeeklyCapacityMatrix(plan, weeks),
    [plan, weeks],
  );

  const activeCellData: {
    personName: string;
    weekRange: string;
    cell: WeeklyCellCapacity;
  } | null = useMemo(() => {
    if (!selectedCell) return null;
    const person = plan.people.find((p) => p.id === selectedCell.personId);
    const week = weeks.find((w) => w.weekStart === selectedCell.weekStart);
    const cell = matrix.get(selectedCell.personId)?.get(selectedCell.weekStart);
    if (!person || !week || !cell) return null;
    return {
      personName: person.name,
      weekRange: `${week.weekLabel} (${week.shortRange})`,
      cell,
    };
  }, [selectedCell, plan.people, weeks, matrix]);

  if (plan.people.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="max-w-sm space-y-3">
          <h2 className="text-base font-semibold">No Team Capacity Data Yet</h2>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Add team members and assign them to projects to view weekly utilisation and
            spot overallocations.
          </p>
          <button
            type="button"
            onClick={() => setTeamDrawerOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
          >
            <UserPlus className="w-4 h-4" aria-hidden="true" />
            Manage Team
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div
        className="px-4 py-2 border-b flex flex-wrap items-center justify-between gap-2 text-xs"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-default)',
        }}
      >
        <div className="flex items-center gap-2">
          <div
            className="inline-flex items-center rounded-md border overflow-hidden"
            style={{ borderColor: 'var(--border-default)' }}
          >
            <button
              type="button"
              onClick={() => setWeekOffset((w) => w - 4)}
              aria-label="Previous 4 weeks"
              className="p-1.5 hover:bg-slate-500/10 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setWeekOffset(0)}
              className="px-2.5 py-1 text-[11px] font-medium hover:bg-slate-500/10 cursor-pointer inline-flex items-center gap-1"
            >
              <Crosshair className="w-3 h-3 text-red-500" aria-hidden="true" />
              Current 12 Weeks
            </button>
            <button
              type="button"
              onClick={() => setWeekOffset((w) => w + 4)}
              aria-label="Next 4 weeks"
              className="p-1.5 hover:bg-slate-500/10 cursor-pointer"
            >
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
            &gt;100% Conflict
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            75–100% Allocated
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            1–74% Partial
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full border border-slate-400" />
            0% Available
          </span>
        </div>
      </div>

      {/* Main Content + Optional Breakdown Inspector */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        <div
          tabIndex={0}
          role="region"
          aria-labelledby={captionId}
          className="flex-1 overflow-auto p-4"
        >
          <table
            className="w-full min-w-[840px] text-xs"
            style={{ borderCollapse: 'separate', borderSpacing: 0 }}
          >
            <caption id={captionId} className="sr-status">
              Weekly team resource capacity heatmap
            </caption>
            <thead className="sticky top-0 z-20">
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-30 text-left py-2.5 px-3 border-b border-r font-semibold w-48"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-default)',
                  }}
                >
                  Person
                </th>
                {weeks.map((w) => {
                  const isNow = todayIso >= w.weekStart && todayIso <= w.sundayEnd;
                  return (
                    <th
                      key={w.weekStart}
                      scope="col"
                      className={`py-2 px-2 border-b border-r text-center font-medium min-w-[78px] ${
                        isNow ? 'text-blue-600 dark:text-blue-400 font-semibold' : ''
                      }`}
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        borderColor: 'var(--border-default)',
                      }}
                    >
                      <div>{w.weekLabel}</div>
                      <div className="text-[10px] font-normal opacity-75">
                        {formatShortDate(w.weekStart)}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {plan.people.map((person) => {
                const pRow = matrix.get(person.id);
                return (
                  <tr key={person.id}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 text-left py-2.5 px-3 border-b border-r font-semibold truncate"
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        borderColor: 'var(--border-default)',
                      }}
                    >
                      {person.name}
                    </th>
                    {weeks.map((w) => {
                      const cell = pRow?.get(w.weekStart);
                      const pct = cell?.weeklyPct ?? 0;
                      const isActive =
                        selectedCell?.personId === person.id &&
                        selectedCell?.weekStart === w.weekStart;

                      let cellTone = 'hover:bg-slate-500/8';
                      let dotTone = '';
                      if (pct > 100) {
                        cellTone =
                          'bg-red-500/16 text-red-700 dark:text-red-300 font-semibold hover:bg-red-500/25';
                        dotTone = 'bg-red-500';
                      } else if (pct >= 75) {
                        cellTone =
                          'bg-emerald-500/14 text-emerald-800 dark:text-emerald-300 font-medium hover:bg-emerald-500/22';
                        dotTone = 'bg-emerald-500';
                      } else if (pct > 0) {
                        cellTone =
                          'bg-amber-500/14 text-amber-800 dark:text-amber-300 font-medium hover:bg-amber-500/22';
                        dotTone = 'bg-amber-400';
                      }

                      return (
                        <td
                          key={w.weekStart}
                          className="p-1 border-b border-r text-center"
                          style={{ borderColor: 'var(--border-default)' }}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedCell({
                                personId: person.id,
                                weekStart: w.weekStart,
                              })
                            }
                            className={`w-full py-2 px-1.5 rounded-md inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer relative ${cellTone} ${
                              isActive ? 'ring-2 ring-blue-500' : ''
                            }`}
                          >
                            {dotTone && (
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${dotTone}`}
                              />
                            )}
                            <span
                              style={
                                pct === 0 ? { color: 'var(--text-muted)' } : undefined
                              }
                            >
                              {pct}%
                            </span>
                            {cell?.hasDailySpike && (
                              <span
                                title={`Daily overlap peak: ${cell.peakDailyPct}%`}
                                className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500"
                              />
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Cell Breakdown Side Panel */}
        {activeCellData && (
          <aside
            aria-label="Weekly workload breakdown"
            className="w-full lg:w-84 shrink-0 border-t lg:border-t-0 lg:border-l p-4 overflow-y-auto space-y-4 text-xs"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-default)',
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold text-sm">{activeCellData.personName}</h2>
                <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  {activeCellData.weekRange} ·{' '}
                  <strong>{activeCellData.cell.weeklyPct}% weekly load</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCell(null)}
                aria-label="Close cell breakdown"
                className="p-1 rounded hover:bg-slate-500/10 cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {activeCellData.cell.weeklyPct > 100 && (
              <div className="p-2.5 rounded-lg bg-red-500/12 border border-red-500/30 flex items-center gap-2 text-red-600 dark:text-red-400">
                <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  Overallocated by {activeCellData.cell.weeklyPct - 100}% this week.
                  Adjust percentages below or shift dates.
                </span>
              </div>
            )}

            {activeCellData.cell.items.length === 0 ? (
              <div
                className="p-4 rounded-lg border text-center"
                style={{
                  borderColor: 'var(--border-default)',
                  color: 'var(--text-muted)',
                }}
              >
                100% available this week — no active assignments or leave.
              </div>
            ) : (
              <div className="space-y-2.5">
                {activeCellData.cell.items.map((item) => {
                  const rawAsg =
                    item.kind === 'assignment'
                      ? plan.assignments.find((a) => a.id === item.id)
                      : undefined;

                  return (
                    <div
                      key={item.id}
                      className="p-3 rounded-lg border space-y-2"
                      style={{
                        borderColor: 'var(--border-default)',
                        backgroundColor: 'var(--bg-subtle)',
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-semibold">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: item.color }}
                            />
                            <span className="truncate">{item.label}</span>
                          </div>
                          {item.sublabel && (
                            <div
                              className="text-[11px] pl-4 truncate"
                              style={{ color: 'var(--text-secondary)' }}
                            >
                              Phase: {item.sublabel}
                            </div>
                          )}
                          <div
                            className="text-[11px] pl-4 mt-0.5"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            Active {item.activeDaysInPeriod}/5 working days
                            {item.isImplicitDefault ? ' · Default 100%' : ''}
                          </div>
                        </div>

                        {item.projectId && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedEntity(
                                item.taskId
                                  ? {
                                      type: 'task',
                                      id: item.taskId,
                                      projectId: item.projectId!,
                                    }
                                  : {
                                      type: 'project',
                                      id: item.projectId!,
                                      projectId: item.projectId!,
                                    },
                              );
                              setActiveView('timeline');
                            }}
                            title="Open on timeline"
                            className="p-1 rounded hover:bg-slate-500/15 cursor-pointer"
                            style={{ color: 'var(--text-secondary)' }}
                          >
                            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>

                      {rawAsg && (
                        <div className="flex items-center justify-between gap-2 pt-1 border-t" style={{ borderColor: 'var(--border-default)' }}>
                          <label className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                            Allocation %:
                          </label>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={5}
                              max={200}
                              step={5}
                              placeholder="100"
                              value={rawAsg.allocation_pct ?? ''}
                              onChange={(e) => {
                                const val = e.target.value.trim();
                                upsertAssignment({
                                  ...rawAsg,
                                  allocation_pct: val === '' ? null : Number(val),
                                });
                              }}
                              className="w-16 px-2 py-1 rounded border text-right font-medium"
                              style={{
                                borderColor: 'var(--border-default)',
                                backgroundColor: 'var(--bg-surface)',
                              }}
                            />
                            <span>%</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
