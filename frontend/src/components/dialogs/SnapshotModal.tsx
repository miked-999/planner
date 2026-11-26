import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, Printer } from 'lucide-react';
import { addCalendarDays, mondayOfWeek } from '../../engine/dates';
import { usePlan } from '../../store/PlanContext';
import {
  copySnapshotToClipboard,
  downloadSnapshotPng,
  printSnapshotAsLandscapePdf,
  renderPlanSnapshotCanvas,
  type SnapshotKind,
} from '../../utils/snapshotExport';
import { ModalDialog } from '../ui/ModalDialog';

type RangePreset = '8w' | '12w' | 'full' | 'custom';

export function SnapshotModal() {
  const {
    plan,
    todayIso,
    activeView,
    activeBaseline,
    snapshotModalOpen,
    setSnapshotModalOpen,
  } = usePlan();

  const [kind, setKind] = useState<SnapshotKind>('roadmap');
  const [preset, setPreset] = useState<RangePreset>('12w');
  const [customStart, setCustomStart] = useState(todayIso);
  const [customEnd, setCustomEnd] = useState(() => addCalendarDays(todayIso, 84));
  const [includeTasks, setIncludeTasks] = useState(false);
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [includeBaselineGhost, setIncludeBaselineGhost] = useState(true);
  const [title, setTitle] = useState('Team Project & Resource Plan');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const copyTimerRef = useRef<number | null>(null);
  const lastMsgRef = useRef('');

  useEffect(() => {
    if (!snapshotModalOpen) return;
    if (activeView === 'people') setKind('people');
    else if (activeView === 'capacity') setKind('capacity');
    else setKind('roadmap');
  }, [snapshotModalOpen, activeView]);

  const { startIso, endIso } = useMemo(() => {
    const startMon = mondayOfWeek(todayIso);
    if (preset === '8w') {
      return { startIso: startMon, endIso: addCalendarDays(startMon, 8 * 7 - 3) };
    }
    if (preset === '12w') {
      return { startIso: startMon, endIso: addCalendarDays(startMon, 12 * 7 - 3) };
    }
    if (preset === 'full' && plan.projects.length > 0) {
      const visible = plan.projects.filter(
        (p) => !p.archived && (includeCompleted || p.status !== 'completed'),
      );
      const starts = visible
        .map((p) => p.expected_start)
        .filter((d): d is string => Boolean(d))
        .sort();
      const ends = visible
        .map((p) => p.expected_end)
        .filter((d): d is string => Boolean(d))
        .sort();
      if (starts.length > 0 && ends.length > 0) {
        return {
          startIso: mondayOfWeek(starts[0]),
          endIso: ends[ends.length - 1],
        };
      }
    }
    return {
      startIso: customStart,
      endIso: customEnd < customStart ? customStart : customEnd,
    };
  }, [preset, todayIso, plan.projects, includeCompleted, customStart, customEnd]);

  const { canvas, previewUrl } = useMemo(() => {
    if (!snapshotModalOpen) return { canvas: null, previewUrl: '' };
    const useGhost = Boolean(activeBaseline && includeBaselineGhost && kind === 'roadmap');
    const c = renderPlanSnapshotCanvas(plan, {
      kind,
      title,
      startIso,
      endIso,
      includeTasks,
      includeCompleted,
      todayIso,
      baselinePlan: useGhost ? activeBaseline!.plan : null,
      baselineLabel: useGhost ? activeBaseline!.label : null,
    });
    return { canvas: c, previewUrl: c.toDataURL('image/png') };
  }, [
    snapshotModalOpen,
    plan,
    kind,
    title,
    startIso,
    endIso,
    includeTasks,
    includeCompleted,
    includeBaselineGhost,
    activeBaseline,
    todayIso,
  ]);

  const announceCopyStatus = (ok: boolean) => {
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    let msg = ok ? 'Copied image' : 'Copy failed';
    if (msg === lastMsgRef.current) msg += '\u00A0';
    lastMsgRef.current = msg;

    setCopyState(ok ? 'copied' : 'failed');
    setStatusMessage(msg);
    copyTimerRef.current = window.setTimeout(() => {
      setCopyState('idle');
      setStatusMessage('');
    }, 2200);
  };

  return (
    <ModalDialog
      open={snapshotModalOpen}
      onClose={() => setSnapshotModalOpen(false)}
      title="Stakeholder Snapshot (PNG & Landscape PDF)"
      subtitle="Generate a clean, full-horizon visual image or landscape PDF ready for slide decks, Confluence, or Slack."
      maxWidthClass="max-w-4xl"
    >
      <div className="space-y-4 text-xs">
        {/* Controls Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
              Snapshot View
            </label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as SnapshotKind)}
              className="w-full px-2.5 py-1.5 rounded-lg border"
              style={{
                borderColor: 'var(--border-default)',
                backgroundColor: 'var(--bg-subtle)',
              }}
            >
              <option value="roadmap">Project Roadmap (Gantt)</option>
              <option value="people">Team Schedule &amp; Availability</option>
              <option value="capacity">Resource Capacity Heatmap</option>
            </select>
          </div>

          <div>
            <label className="block mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
              Date Horizon
            </label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as RangePreset)}
              className="w-full px-2.5 py-1.5 rounded-lg border"
              style={{
                borderColor: 'var(--border-default)',
                backgroundColor: 'var(--bg-subtle)',
              }}
            >
              <option value="8w">Current + 8 Weeks</option>
              <option value="12w">Current + 12 Weeks</option>
              <option value="full">Full Plan Horizon</option>
              <option value="custom">Custom Date Range…</option>
            </select>
          </div>

          <div>
            <label className="block mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
              Snapshot Heading
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border"
              style={{
                borderColor: 'var(--border-default)',
                backgroundColor: 'var(--bg-subtle)',
              }}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {preset === 'custom' ? (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                aria-label="Custom start date"
                className="px-2.5 py-1 rounded border"
                style={{
                  borderColor: 'var(--border-default)',
                  backgroundColor: 'var(--bg-subtle)',
                }}
              />
              <span>→</span>
              <input
                type="date"
                min={customStart}
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                aria-label="Custom end date"
                className="px-2.5 py-1 rounded border"
                style={{
                  borderColor: 'var(--border-default)',
                  backgroundColor: 'var(--bg-subtle)',
                }}
              />
            </div>
          ) : (
            <div />
          )}

          {kind === 'roadmap' && (
            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeTasks}
                  onChange={(e) => setIncludeTasks(e.target.checked)}
                />
                <span>Include project phases / subtasks</span>
              </label>

              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeCompleted}
                  onChange={(e) => setIncludeCompleted(e.target.checked)}
                />
                <span>Include completed projects</span>
              </label>

              {activeBaseline && (
                <label className="inline-flex items-center gap-1.5 cursor-pointer text-indigo-700 dark:text-indigo-300 font-medium">
                  <input
                    type="checkbox"
                    checked={includeBaselineGhost}
                    onChange={(e) => setIncludeBaselineGhost(e.target.checked)}
                  />
                  <span>Include baseline ghost bars ({activeBaseline.label})</span>
                </label>
              )}
            </div>
          )}
        </div>

        {/* High-DPI Live Preview */}
        <div
          className="rounded-xl border p-3 overflow-auto max-h-[48svh] bg-slate-100 dark:bg-slate-900"
          style={{ borderColor: 'var(--border-default)' }}
        >
          {previewUrl && (
            <img
              src={previewUrl}
              alt="Rendered stakeholder plan preview"
              className="max-w-full h-auto rounded shadow-xs mx-auto bg-white"
            />
          )}
        </div>

        {/* Export Actions */}
        <div
          className="pt-3 border-t flex flex-wrap items-center justify-end gap-2.5"
          style={{ borderColor: 'var(--border-default)' }}
        >
          {/* Copy button + external role="status" bubble per modern-web-guidance */}
          <span className="inline-flex items-center gap-2">
            <span
              role="status"
              className={`text-[11px] font-medium transition-opacity ${
                statusMessage ? 'opacity-100' : 'opacity-0'
              } ${
                copyState === 'failed'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {statusMessage}
            </span>
            <button
              type="button"
              onClick={async () => {
                if (!canvas) return;
                try {
                  await copySnapshotToClipboard(canvas);
                  announceCopyStatus(true);
                } catch {
                  announceCopyStatus(false);
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium hover:bg-slate-500/10 cursor-pointer"
              style={{ borderColor: 'var(--border-default)' }}
            >
              {copyState === 'copied' ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" />
              ) : (
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>Copy Image</span>
            </button>
          </span>

          <button
            type="button"
            onClick={() => {
              if (!canvas) return;
              printSnapshotAsLandscapePdf(canvas, title);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium hover:bg-slate-500/10 cursor-pointer"
            style={{ borderColor: 'var(--border-default)' }}
          >
            <Printer className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Print / Save PDF</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (!canvas) return;
              void downloadSnapshotPng(canvas, `plan-${kind}-${todayIso}.png`);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Download PNG</span>
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
