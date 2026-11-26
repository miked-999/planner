import React, { useEffect, useState } from 'react';
import {
  ArchiveRestore,
  BookmarkPlus,
  CalendarClock,
  FlaskConical,
  GitCompareArrows,
  Pencil,
  TableProperties,
  Trash2,
} from 'lucide-react';
import { api } from '../../store/api';
import { usePlan } from '../../store/PlanContext';
import type { CheckpointSummary } from '../../types/plan';
import { ModalDialog } from '../ui/ModalDialog';

type FilterKind = 'all' | 'milestones' | 'auto_weekly';

export function CheckpointsModal() {
  const {
    plan,
    checkpointsModalOpen,
    setCheckpointsModalOpen,
    setCompareSummaryModalOpen,
    activeBaseline,
    selectBaselineForCompare,
    clearBaselineCompare,
    replaceFromExternalLoad,
    setActiveView,
  } = usePlan();

  const [checkpoints, setCheckpoints] = useState<CheckpointSummary[]>([]);
  const [filterKind, setFilterKind] = useState<FilterKind>('all');
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editNote, setEditNote] = useState('');
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    msg: string;
  } | null>(null);

  const refresh = () => {
    api
      .listCheckpoints()
      .then(setCheckpoints)
      .catch(() => {});
  };

  useEffect(() => {
    if (checkpointsModalOpen) {
      setFeedback(null);
      refresh();
    }
  }, [checkpointsModalOpen]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    try {
      await api.createCheckpoint({
        label: label.trim(),
        note: note.trim(),
        kind: 'manual',
        plan,
      });
      setLabel('');
      setNote('');
      refresh();
      setFeedback({ type: 'ok', msg: 'Saved milestone checkpoint.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Failed to save checkpoint',
      });
    }
  };

  const handleSaveEdit = async (id: string) => {
    try {
      await api.updateCheckpoint(id, {
        label: editLabel.trim() || 'Checkpoint',
        note: editNote,
      });
      if (activeBaseline?.id === id) {
        await selectBaselineForCompare(id);
      }
      setEditingId(null);
      refresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Failed to update checkpoint',
      });
    }
  };

  const visibleCheckpoints = checkpoints.filter((c) => {
    if (filterKind === 'milestones') return c.kind !== 'auto_weekly';
    if (filterKind === 'auto_weekly') return c.kind === 'auto_weekly';
    return true;
  });

  return (
    <ModalDialog
      open={checkpointsModalOpen}
      onClose={() => setCheckpointsModalOpen(false)}
      title="Plan Checkpoints & Version Comparison"
      subtitle="Save named milestones with why-notes, or compare your current plan against automatic weekly baselines."
      maxWidthClass="max-w-3xl"
    >
      <div className="space-y-5 text-xs">
        {/* Create Milestone Checkpoint Form */}
        <form
          onSubmit={handleCreate}
          className="p-3.5 rounded-xl border space-y-2.5"
          style={{
            borderColor: 'var(--border-default)',
            backgroundColor: 'var(--bg-subtle)',
          }}
        >
          <div className="font-semibold text-sm flex items-center gap-1.5">
            <BookmarkPlus className="w-4 h-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
            Save Named Milestone Checkpoint
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Milestone name (e.g. Q1 Plan Signed Off)…"
              aria-label="Checkpoint name"
              className="sm:col-span-2 px-3 py-1.5 rounded-lg border font-medium"
              style={{
                borderColor: 'var(--border-default)',
                backgroundColor: 'var(--bg-surface)',
              }}
            />
            <button
              type="submit"
              disabled={!label.trim()}
              className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold cursor-pointer"
            >
              Save Checkpoint
            </button>
          </div>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional Why / Context note (e.g. Agreed to push Beta by 1w so Ben can finish Data Pipeline cutover)…"
            aria-label="Why or context note"
            className="w-full px-3 py-1.5 rounded-lg border"
            style={{
              borderColor: 'var(--border-default)',
              backgroundColor: 'var(--bg-surface)',
            }}
          />
        </form>

        {feedback && (
          <div
            className={`p-2.5 rounded-lg border font-medium ${
              feedback.type === 'ok'
                ? 'bg-emerald-500/12 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                : 'bg-red-500/12 border-red-500/30 text-red-600 dark:text-red-400'
            }`}
          >
            {feedback.msg}
          </div>
        )}

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            className="inline-flex gap-1 p-1 rounded-lg border"
            style={{
              borderColor: 'var(--border-default)',
              backgroundColor: 'var(--bg-subtle)',
            }}
          >
            {(
              [
                ['all', `All (${checkpoints.length})`],
                [
                  'milestones',
                  `Milestones (${checkpoints.filter((c) => c.kind !== 'auto_weekly').length})`,
                ],
                [
                  'auto_weekly',
                  `Auto-Weekly (${checkpoints.filter((c) => c.kind === 'auto_weekly').length})`,
                ],
              ] as const
            ).map(([id, text]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilterKind(id)}
                className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                  filterKind === id ? 'bg-blue-600 text-white' : ''
                }`}
              >
                {text}
              </button>
            ))}
          </div>

          {activeBaseline && (
            <button
              type="button"
              onClick={clearBaselineCompare}
              className="text-indigo-600 dark:text-indigo-400 font-medium hover:underline cursor-pointer"
            >
              Stop comparing &ldquo;{activeBaseline.label}&rdquo;
            </button>
          )}
        </div>

        {/* Checkpoints List */}
        <div
          className="rounded-xl border divide-y max-h-[44svh] overflow-y-auto"
          style={{ borderColor: 'var(--border-default)' }}
        >
          {visibleCheckpoints.length === 0 ? (
            <div className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>
              No checkpoints saved in this category yet. Automatic weekly checkpoints are
              captured automatically as you work.
            </div>
          ) : (
            visibleCheckpoints.map((chk) => {
              const isComparing = activeBaseline?.id === chk.id;
              const isEditing = editingId === chk.id;

              return (
                <div
                  key={chk.id}
                  className={`p-3.5 space-y-2 ${
                    isComparing ? 'bg-indigo-500/8' : ''
                  }`}
                  style={{ borderColor: 'var(--border-default)' }}
                >
                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        className="w-full px-2.5 py-1 rounded border font-semibold"
                        style={{ borderColor: 'var(--border-strong)' }}
                      />
                      <textarea
                        rows={2}
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        placeholder="Why / context note…"
                        className="w-full px-2.5 py-1 rounded border"
                        style={{ borderColor: 'var(--border-strong)' }}
                      />
                      <div className="flex gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-2.5 py-1 rounded border cursor-pointer"
                          style={{ borderColor: 'var(--border-default)' }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSaveEdit(chk.id)}
                          className="px-3 py-1 rounded bg-blue-600 text-white font-semibold cursor-pointer"
                        >
                          Save Note
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">{chk.label}</span>
                            {chk.kind === 'auto_weekly' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.2 rounded-full text-[10px] font-medium bg-slate-500/15 text-slate-600 dark:text-slate-300">
                                <CalendarClock className="w-3 h-3" aria-hidden="true" />
                                Auto-Weekly
                              </span>
                            ) : chk.kind === 'what_if' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.2 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-700 dark:text-amber-300">
                                <FlaskConical className="w-3 h-3" aria-hidden="true" />
                                What-if Decision
                              </span>
                            ) : (
                              <span className="px-2 py-0.2 rounded-full text-[10px] font-medium bg-blue-500/15 text-blue-600 dark:text-blue-400">
                                Milestone
                              </span>
                            )}
                            {isComparing && (
                              <span className="px-2 py-0.2 rounded-full text-[10px] font-semibold bg-indigo-600 text-white">
                                Active Baseline
                              </span>
                            )}
                          </div>
                          <div
                            className="text-[11px]"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {new Date(chk.created_at).toLocaleString()} · {chk.created_by} ·{' '}
                            {chk.project_count} projects · {chk.people_count} people
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={async () => {
                              await selectBaselineForCompare(chk.id);
                              setActiveView('timeline');
                              setCheckpointsModalOpen(false);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold cursor-pointer"
                          >
                            <GitCompareArrows className="w-3.5 h-3.5" aria-hidden="true" />
                            Ghost Bars
                          </button>

                          <button
                            type="button"
                            onClick={async () => {
                              await selectBaselineForCompare(chk.id);
                              setCheckpointsModalOpen(false);
                              setCompareSummaryModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border font-medium hover:bg-slate-500/10 cursor-pointer"
                            style={{ borderColor: 'var(--border-strong)' }}
                          >
                            <TableProperties className="w-3.5 h-3.5" aria-hidden="true" />
                            Delta Table
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(chk.id);
                              setEditLabel(chk.label);
                              setEditNote(chk.note);
                            }}
                            title="Edit checkpoint name or why-note"
                            aria-label={`Edit ${chk.label}`}
                            className="p-1.5 rounded hover:bg-slate-500/10 cursor-pointer"
                            style={{ color: 'var(--text-secondary)' }}
                          >
                            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>

                          <button
                            type="button"
                            onClick={async () => {
                              const restored = await api.restoreCheckpoint(chk.id);
                              replaceFromExternalLoad(restored);
                              setFeedback({
                                type: 'ok',
                                msg: `Restored plan to "${chk.label}".`,
                              });
                            }}
                            title="Restore plan to this checkpoint (saves a safety backup first)"
                            aria-label={`Restore ${chk.label}`}
                            className="p-1.5 rounded hover:bg-slate-500/10 cursor-pointer"
                            style={{ color: 'var(--text-secondary)' }}
                          >
                            <ArchiveRestore className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>

                          <button
                            type="button"
                            onClick={async () => {
                              await api.deleteCheckpoint(chk.id);
                              if (activeBaseline?.id === chk.id) {
                                clearBaselineCompare();
                              }
                              refresh();
                            }}
                            aria-label={`Delete ${chk.label}`}
                            className="p-1.5 rounded hover:bg-red-500/15 text-red-500 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>

                      {chk.note && (
                        <div
                          className="px-3 py-2 rounded-lg border-l-2 border-indigo-500 text-[11px] italic"
                          style={{
                            backgroundColor: 'var(--bg-subtle)',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          &ldquo;{chk.note}&rdquo;
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </ModalDialog>
  );
}
