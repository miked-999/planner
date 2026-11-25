import { AlertTriangle, ArrowRight, CalendarClock, Users } from 'lucide-react';
import { formatShortDate, formatSignedWorkingDays } from '../../engine/dates';
import { usePlan } from '../../store/PlanContext';
import { ModalDialog } from '../ui/ModalDialog';

export function CascadePreviewModal() {
  const { pendingCascade, acceptCascade, applyDirectMoveOnly, cancelCascade } = usePlan();

  if (!pendingCascade) return null;

  const newlyLateCount = pendingCascade.shifts.filter((s) => s.newlyLate).length;
  const conflictCount = pendingCascade.availabilityDeltas.filter(
    (d) => d.newConflictWeeks.length > 0,
  ).length;

  return (
    <ModalDialog
      open={Boolean(pendingCascade)}
      onClose={cancelCascade}
      title="Downstream Dependency Impact"
      subtitle={`Schedule changes to "${pendingCascade.triggerLabel}" affect ${pendingCascade.shifts.length} dependent item${pendingCascade.shifts.length === 1 ? '' : 's'}.`}
      maxWidthClass="max-w-3xl"
      lightDismiss={false}
    >
      <div className="space-y-4 text-xs">
        {(newlyLateCount > 0 || conflictCount > 0) && (
          <div className="p-3 rounded-lg bg-red-500/12 border border-red-500/30 flex items-start gap-2.5 text-red-600 dark:text-red-400">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-0.5">
              <div className="font-semibold">Schedule Risk Detected</div>
              <div>
                {newlyLateCount > 0 && (
                  <span>
                    {newlyLateCount} activity{newlyLateCount === 1 ? '' : 'ies'} will newly breach
                    required-by deadlines.{' '}
                  </span>
                )}
                {conflictCount > 0 && (
                  <span>
                    {conflictCount} team member{conflictCount === 1 ? '' : 's'} will have new
                    &gt;100% resource conflicts.
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Shifted items table */}
        <div>
          <h2 className="font-semibold mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
            Affected Downstream Schedule
          </h2>
          <div
            className="rounded-lg border overflow-hidden"
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
                  <th scope="col" className="py-2 px-3 font-medium">Activity</th>
                  <th scope="col" className="py-2 px-3 font-medium">Before</th>
                  <th scope="col" className="py-2 px-3 font-medium">After Cascade</th>
                  <th scope="col" className="py-2 px-3 font-medium">Impact</th>
                  <th scope="col" className="py-2 px-3 font-medium">Deadline</th>
                </tr>
              </thead>
              <tbody>
                {pendingCascade.shifts.map((s) => (
                  <tr
                    key={`${s.entityType}:${s.id}`}
                    className="border-b last:border-b-0"
                    style={{ borderColor: 'var(--border-default)' }}
                  >
                    <td className="py-2 px-3 font-medium">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: s.color }}
                        />
                        <div>
                          <div>{s.name}</div>
                          {s.entityType === 'task' && (
                            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                              in {s.projectName}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-2 px-3" style={{ color: 'var(--text-secondary)' }}>
                      {formatShortDate(s.beforeStart)} – {formatShortDate(s.beforeEnd)}
                    </td>
                    <td className="py-2 px-3 font-medium">
                      {formatShortDate(s.afterStart)} – {formatShortDate(s.afterEnd)}
                    </td>
                    <td className="py-2 px-3">
                      <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 font-medium">
                        {formatSignedWorkingDays(s.shiftWorkingDays)}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      {s.willMissDeadline ? (
                        <span className="px-2 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400 font-semibold">
                          Misses {formatShortDate(s.requiredBy)}
                        </span>
                      ) : s.requiredBy ? (
                        <span style={{ color: 'var(--text-secondary)' }}>
                          Within {formatShortDate(s.requiredBy)}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* People Availability & Conflict Deltas */}
        {pendingCascade.availabilityDeltas.length > 0 && (
          <div>
            <h2 className="font-semibold mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              <Users className="w-3.5 h-3.5" aria-hidden="true" />
              People Availability &amp; Conflicts
            </h2>
            <div
              className="rounded-lg border divide-y"
              style={{ borderColor: 'var(--border-default)' }}
            >
              {pendingCascade.availabilityDeltas.map((d) => (
                <div
                  key={d.personId}
                  className="px-3 py-2 flex flex-wrap items-center justify-between gap-2"
                  style={{ borderColor: 'var(--border-default)' }}
                >
                  <span className="font-medium">{d.personName}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {d.availabilityChanged && (
                      <span
                        className="inline-flex items-center gap-1 text-[11px]"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        Available: {formatShortDate(d.beforeAvailableDate)}
                        <ArrowRight className="w-3 h-3" aria-hidden="true" />
                        <strong style={{ color: 'var(--text-primary)' }}>
                          {formatShortDate(d.afterAvailableDate)}
                        </strong>
                      </span>
                    )}
                    {d.newConflictWeeks.map((cw) => (
                      <span
                        key={cw}
                        className="px-2 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400 text-[11px] font-medium"
                      >
                        Conflict: {cw}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div
          className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t"
          style={{ borderColor: 'var(--border-default)' }}
        >
          <button
            type="button"
            onClick={cancelCascade}
            className="px-3 py-1.5 rounded-lg border font-medium cursor-pointer hover:opacity-80"
            style={{ borderColor: 'var(--border-default)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={applyDirectMoveOnly}
            className="px-3 py-1.5 rounded-lg border font-medium cursor-pointer hover:opacity-85"
            style={{
              borderColor: 'var(--border-strong)',
              backgroundColor: 'var(--bg-subtle)',
            }}
          >
            Move Only Selected Item
          </button>
          <button
            type="button"
            autoFocus
            onClick={acceptCascade}
            className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer"
          >
            Apply Cascade ({pendingCascade.shifts.length})
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
