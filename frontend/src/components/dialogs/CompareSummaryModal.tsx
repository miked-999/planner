import { ArrowRight, GanttChart, GitCompareArrows, MessageSquareQuote } from 'lucide-react';
import { formatShortDate, formatSignedWorkingDays } from '../../engine/dates';
import { usePlan } from '../../store/PlanContext';
import type { ProjectChangeType } from '../../types/plan';
import { ModalDialog } from '../ui/ModalDialog';
import { StatusPill } from '../ui/StatusBadges';

const CHANGE_BADGES: Record<ProjectChangeType, { label: string; classes: string }> = {
  added: {
    label: 'New Project',
    classes: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  },
  removed: {
    label: 'Removed',
    classes: 'bg-slate-500/20 text-slate-600 dark:text-slate-300',
  },
  newly_scheduled: {
    label: 'Scheduled from Backlog',
    classes: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  },
  moved_to_backlog: {
    label: 'Moved to Backlog',
    classes: 'bg-purple-500/15 text-purple-700 dark:text-purple-300',
  },
  modified: {
    label: 'Updated',
    classes: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  },
};

export function CompareSummaryModal() {
  const {
    activeBaseline,
    comparisonDiff,
    compareSummaryModalOpen,
    setCompareSummaryModalOpen,
    setCheckpointsModalOpen,
    setActiveView,
  } = usePlan();

  if (!activeBaseline || !comparisonDiff) return null;

  const { summary, projectDiffs } = comparisonDiff;

  return (
    <ModalDialog
      open={compareSummaryModalOpen}
      onClose={() => setCompareSummaryModalOpen(false)}
      title={`Changes Since "${activeBaseline.label}"`}
      subtitle={`Baseline captured ${new Date(activeBaseline.created_at).toLocaleString()} by ${activeBaseline.created_by}`}
      maxWidthClass="max-w-4xl"
    >
      <div className="space-y-5 text-xs">
        {/* Checkpoint Why-Note Callout */}
        {activeBaseline.note && (
          <div
            className="p-3 rounded-xl border flex items-start gap-2.5"
            style={{
              backgroundColor: 'var(--bg-subtle)',
              borderColor: 'var(--border-default)',
            }}
          >
            <MessageSquareQuote
              className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div>
              <div
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--text-secondary)' }}
              >
                Baseline Context / Why Note
              </div>
              <div className="mt-0.5 italic">&ldquo;{activeBaseline.note}&rdquo;</div>
            </div>
          </div>
        )}

        {/* 4 Summary Delta Tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div
            className="p-3 rounded-xl border"
            style={{ borderColor: 'var(--border-default)' }}
          >
            <div className="text-xl font-bold text-red-600 dark:text-red-400">
              {summary.slippedCount}
            </div>
            <div style={{ color: 'var(--text-secondary)' }}>Projects Slipped Later</div>
          </div>

          <div
            className="p-3 rounded-xl border"
            style={{ borderColor: 'var(--border-default)' }}
          >
            <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
              {summary.pulledInCount + summary.completedSinceCount}
            </div>
            <div style={{ color: 'var(--text-secondary)' }}>
              Pulled In ({summary.pulledInCount}) · Completed ({summary.completedSinceCount})
            </div>
          </div>

          <div
            className="p-3 rounded-xl border"
            style={{ borderColor: 'var(--border-default)' }}
          >
            <div className="text-xl font-bold text-blue-600 dark:text-blue-400">
              +{summary.addedCount} / −{summary.removedCount}
            </div>
            <div style={{ color: 'var(--text-secondary)' }}>Added / Removed Projects</div>
          </div>

          <div
            className="p-3 rounded-xl border"
            style={{ borderColor: 'var(--border-default)' }}
          >
            <div className="text-xl font-bold text-amber-600 dark:text-amber-400">
              {summary.reassignedCount}
            </div>
            <div style={{ color: 'var(--text-secondary)' }}>Resource Reassignments</div>
          </div>
        </div>

        {/* Project-by-Project Delta Table */}
        {projectDiffs.length === 0 ? (
          <div
            className="p-6 rounded-xl border text-center"
            style={{
              borderColor: 'var(--border-default)',
              color: 'var(--text-secondary)',
            }}
          >
            No project schedule, status, progress, or assignment changes since this
            checkpoint.
          </div>
        ) : (
          <div
            className="rounded-xl border overflow-hidden"
            style={{ borderColor: 'var(--border-default)' }}
          >
            <table className="w-full text-left border-collapse">
              <thead>
                <tr
                  className="border-b text-[11px]"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    borderColor: 'var(--border-default)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <th scope="col" className="py-2.5 px-3 font-semibold">
                    Project
                  </th>
                  <th scope="col" className="py-2.5 px-3 font-semibold">
                    Schedule Delta
                  </th>
                  <th scope="col" className="py-2.5 px-3 font-semibold">
                    Status &amp; Progress
                  </th>
                  <th scope="col" className="py-2.5 px-3 font-semibold">
                    People &amp; Allocation Changes
                  </th>
                </tr>
              </thead>
              <tbody>
                {projectDiffs.map((item) => {
                  const badge = CHANGE_BADGES[item.changeType];
                  return (
                    <tr
                      key={item.projectId}
                      className="border-b last:border-b-0"
                      style={{ borderColor: 'var(--border-default)' }}
                    >
                      <td className="py-2.5 px-3 align-top">
                        <div className="flex items-center gap-2 font-semibold">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: item.color }}
                          />
                          <span>{item.name}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${badge.classes}`}
                          >
                            {badge.label}
                          </span>
                          {item.newlyLate && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-red-500/15 text-red-600 dark:text-red-400">
                              Newly Late
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 align-top">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span style={{ color: 'var(--text-secondary)' }}>
                            {item.baselineStart
                              ? `${formatShortDate(item.baselineStart)}–${formatShortDate(item.baselineEnd)}`
                              : 'Backlog'}
                          </span>
                          <ArrowRight className="w-3 h-3 shrink-0" aria-hidden="true" />
                          <span className="font-medium">
                            {item.currentStart
                              ? `${formatShortDate(item.currentStart)}–${formatShortDate(item.currentEnd)}`
                              : item.changeType === 'removed'
                                ? 'Removed'
                                : 'Backlog'}
                          </span>
                        </div>
                        {item.endShiftDays !== null && item.endShiftDays !== 0 && (
                          <div className="mt-1">
                            <span
                              className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                                item.endShiftDays > 0
                                  ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                                  : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              }`}
                            >
                              End {formatSignedWorkingDays(item.endShiftDays)}
                            </span>
                          </div>
                        )}
                      </td>

                      <td className="py-2.5 px-3 align-top space-y-1">
                        {item.currentStatus && <StatusPill status={item.currentStatus} />}
                        {item.baselinePercent !== null &&
                          item.currentPercent !== null &&
                          item.baselinePercent !== item.currentPercent && (
                            <div
                              className="text-[11px]"
                              style={{ color: 'var(--text-secondary)' }}
                            >
                              {item.baselinePercent}% →{' '}
                              <strong>{item.currentPercent}%</strong>
                            </div>
                          )}
                      </td>

                      <td className="py-2.5 px-3 align-top space-y-1">
                        {item.addedPeople.map((p) => (
                          <div
                            key={`add-${p}`}
                            className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium"
                          >
                            + {p}
                          </div>
                        ))}
                        {item.removedPeople.map((p) => (
                          <div
                            key={`rem-${p}`}
                            className="text-[11px] text-red-600 dark:text-red-400"
                          >
                            − {p}
                          </div>
                        ))}
                        {item.allocationChanges.map((ac) => (
                          <div
                            key={`chg-${ac.name}`}
                            className="text-[11px]"
                            style={{ color: 'var(--text-secondary)' }}
                          >
                            {ac.name}: {ac.beforePct}% → <strong>{ac.afterPct}%</strong>
                          </div>
                        ))}
                        {item.addedPeople.length === 0 &&
                          item.removedPeople.length === 0 &&
                          item.allocationChanges.length === 0 && (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer Actions */}
        <div
          className="pt-3 border-t flex flex-wrap items-center justify-between gap-2"
          style={{ borderColor: 'var(--border-default)' }}
        >
          <button
            type="button"
            onClick={() => {
              setCompareSummaryModalOpen(false);
              setCheckpointsModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium hover:bg-slate-500/10 cursor-pointer"
            style={{ borderColor: 'var(--border-default)' }}
          >
            <GitCompareArrows className="w-3.5 h-3.5" aria-hidden="true" />
            Switch Checkpoint
          </button>

          <button
            type="button"
            onClick={() => {
              setCompareSummaryModalOpen(false);
              setActiveView('timeline');
            }}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold cursor-pointer"
          >
            <GanttChart className="w-3.5 h-3.5" aria-hidden="true" />
            View Ghost Bars on Timeline
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
