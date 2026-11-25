import React, { useEffect, useState } from 'react';
import {
  ArchiveRestore,
  Download,
  FileJson,
  FileSpreadsheet,
  HardDriveDownload,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { api } from '../../store/api';
import { usePlan } from '../../store/PlanContext';
import type { BackupInfo } from '../../types/plan';
import { ModalDialog } from '../ui/ModalDialog';

type Tab = 'export' | 'import' | 'backups';

export function PortabilityModal() {
  const {
    portabilityModalOpen,
    setPortabilityModalOpen,
    replaceFromExternalLoad,
    loadSamplePlan,
    clearAllPlanData,
  } = usePlan();

  const [tab, setTab] = useState<Tab>('export');
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupLabel, setBackupLabel] = useState('');
  const [csvText, setCsvText] = useState('');
  const [csvMode, setCsvMode] = useState<'merge' | 'replace'>('merge');
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    msg: string;
  } | null>(null);

  const refreshBackups = () => {
    api
      .listBackups()
      .then(setBackups)
      .catch(() => {});
  };

  useEffect(() => {
    if (portabilityModalOpen) {
      setFeedback(null);
      refreshBackups();
    }
  }, [portabilityModalOpen]);

  const handleJsonFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedback(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const restored = await api.importJson(parsed);
      replaceFromExternalLoad(restored);
      setFeedback({
        type: 'ok',
        msg: `Restored ${restored.projects.length} projects and ${restored.people.length} people from JSON.`,
      });
      refreshBackups();
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Invalid JSON file',
      });
    } finally {
      e.target.value = '';
    }
  };

  const handleCsvFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    e.target.value = '';
  };

  const handleCsvImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await api.importProjectsCsv(csvText, csvMode);
      replaceFromExternalLoad(res.plan);
      setCsvText('');
      setFeedback({
        type: 'ok',
        msg: `Imported ${res.imported_count} project(s)${
          res.created_people.length
            ? ` and added ${res.created_people.join(', ')}`
            : ''
        }.`,
      });
      refreshBackups();
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'CSV import failed',
      });
    }
  };

  const handleCreateBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createBackup(backupLabel.trim() || 'Manual snapshot');
      setBackupLabel('');
      refreshBackups();
      setFeedback({ type: 'ok', msg: 'Local SQLite snapshot saved.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Backup failed',
      });
    }
  };

  const handleRestoreBackup = async (filename: string) => {
    try {
      const restored = await api.restoreBackup(filename);
      replaceFromExternalLoad(restored);
      setFeedback({ type: 'ok', msg: `Restored snapshot ${filename}.` });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Restore failed',
      });
    }
  };

  return (
    <ModalDialog
      open={portabilityModalOpen}
      onClose={() => setPortabilityModalOpen(false)}
      title="Data Portability & Local Backups"
      subtitle="Export lossless JSON or Excel-ready CSVs, import plans, or restore SQLite snapshots."
      maxWidthClass="max-w-2xl"
    >
      <div className="space-y-4 text-xs">
        {/* Tabs */}
        <div
          className="flex gap-1 p-1 rounded-lg border"
          style={{
            backgroundColor: 'var(--bg-subtle)',
            borderColor: 'var(--border-default)',
          }}
        >
          {(
            [
              ['export', 'Export JSON / CSV'],
              ['import', 'Import JSON / CSV'],
              ['backups', `Snapshots (${backups.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setTab(id);
                setFeedback(null);
              }}
              className={`flex-1 py-1.5 px-3 rounded-md font-medium cursor-pointer transition-colors ${
                tab === id ? 'bg-blue-600 text-white shadow-2xs' : ''
              }`}
            >
              {label}
            </button>
          ))}
        </div>

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

        {/* TAB 1: EXPORT */}
        {tab === 'export' && (
          <div className="space-y-3">
            <a
              href="/api/export/json"
              download
              className="flex items-center justify-between p-3.5 rounded-xl border hover:border-blue-500/50 transition-colors"
              style={{ borderColor: 'var(--border-default)' }}
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-blue-500/12 text-blue-600 dark:text-blue-400">
                  <FileJson className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <div className="font-semibold text-sm">Complete Plan JSON (.json)</div>
                  <div style={{ color: 'var(--text-secondary)' }}>
                    Lossless backup including projects, phases, people, allocations, leave, and
                    dependencies.
                  </div>
                </div>
              </div>
              <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
            </a>

            <a
              href="/api/export/csv"
              download
              className="flex items-center justify-between p-3.5 rounded-xl border hover:border-emerald-500/50 transition-colors"
              style={{ borderColor: 'var(--border-default)' }}
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                  <FileSpreadsheet className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <div className="font-semibold text-sm">Excel CSV Bundle (.zip)</div>
                  <div style={{ color: 'var(--text-secondary)' }}>
                    Separate CSV spreadsheets for projects, phases, people, assignments, leave,
                    and dependencies.
                  </div>
                </div>
              </div>
              <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
            </a>

            <a
              href="/api/export/csv/projects"
              download
              className="flex items-center justify-between p-3 rounded-xl border hover:opacity-85 transition-opacity"
              style={{ borderColor: 'var(--border-default)' }}
            >
              <span className="font-medium">Download Projects Table Only (projects.csv)</span>
              <Download className="w-4 h-4" aria-hidden="true" />
            </a>
          </div>
        )}

        {/* TAB 2: IMPORT */}
        {tab === 'import' && (
          <div className="space-y-5">
            <div
              className="p-3.5 rounded-xl border space-y-2"
              style={{ borderColor: 'var(--border-default)' }}
            >
              <div className="font-semibold text-sm flex items-center gap-1.5">
                <Upload className="w-4 h-4 text-blue-500" aria-hidden="true" />
                Restore Plan from JSON
              </div>
              <p style={{ color: 'var(--text-secondary)' }}>
                Replaces the current plan (an automatic SQLite backup snapshot is created first).
              </p>
              <input
                type="file"
                accept=".json,application/json"
                onChange={handleJsonFileUpload}
                className="block w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:font-medium hover:file:bg-blue-700 cursor-pointer"
              />
            </div>

            <form
              onSubmit={handleCsvImportSubmit}
              className="p-3.5 rounded-xl border space-y-3"
              style={{ borderColor: 'var(--border-default)' }}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">Import Projects from CSV</span>
                <select
                  value={csvMode}
                  onChange={(e) => setCsvMode(e.target.value as 'merge' | 'replace')}
                  aria-label="CSV import mode"
                  className="px-2 py-1 rounded border"
                  style={{
                    borderColor: 'var(--border-default)',
                    backgroundColor: 'var(--bg-subtle)',
                  }}
                >
                  <option value="merge">Merge into current plan</option>
                  <option value="replace">Replace current plan</option>
                </select>
              </div>

              <p style={{ color: 'var(--text-secondary)' }}>
                Supported headers: <code>Name, Expected Start, Expected End, Required By, Status, Priority, Complete, Assigned People</code>.
              </p>

              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleCsvFileSelect}
                className="block w-full text-xs file:mr-3 file:py-1 file:px-2.5 file:rounded-md file:border file:bg-transparent cursor-pointer"
              />

              <textarea
                rows={4}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={'Name,Expected Start,Expected End,Required By,Assigned People\nNew Audit,2026-12-07,2026-12-24,2026-12-31,Alice Morgan (50%); Ben Carter'}
                className="w-full p-2.5 rounded-lg border font-mono text-[11px]"
                style={{
                  borderColor: 'var(--border-default)',
                  backgroundColor: 'var(--bg-subtle)',
                }}
              />

              <button
                type="submit"
                disabled={!csvText.trim()}
                className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold cursor-pointer"
              >
                Import CSV Projects
              </button>
            </form>
          </div>
        )}

        {/* TAB 3: BACKUPS & SAMPLE DATA */}
        {tab === 'backups' && (
          <div className="space-y-4">
            <form onSubmit={handleCreateBackup} className="flex gap-2">
              <input
                type="text"
                value={backupLabel}
                onChange={(e) => setBackupLabel(e.target.value)}
                placeholder="Snapshot label (e.g. Before Q1 re-plan)…"
                className="flex-1 px-3 py-1.5 rounded-lg border"
                style={{
                  borderColor: 'var(--border-default)',
                  backgroundColor: 'var(--bg-subtle)',
                }}
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer"
              >
                <HardDriveDownload className="w-3.5 h-3.5" aria-hidden="true" />
                Save Snapshot
              </button>
            </form>

            <div
              className="rounded-lg border divide-y max-h-56 overflow-y-auto"
              style={{ borderColor: 'var(--border-default)' }}
            >
              {backups.length === 0 ? (
                <div className="p-4 text-center" style={{ color: 'var(--text-muted)' }}>
                  No snapshots saved yet.
                </div>
              ) : (
                backups.map((b) => (
                  <div
                    key={b.filename}
                    className="px-3 py-2 flex items-center justify-between gap-2"
                    style={{ borderColor: 'var(--border-default)' }}
                  >
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{b.label}</div>
                      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {new Date(b.created_at).toLocaleString()} · {b.project_count} proj ·{' '}
                        {b.people_count} people
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleRestoreBackup(b.filename)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border font-medium hover:bg-slate-500/10 cursor-pointer"
                        style={{ borderColor: 'var(--border-default)' }}
                      >
                        <ArchiveRestore className="w-3.5 h-3.5" aria-hidden="true" />
                        Restore
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await api.deleteBackup(b.filename);
                          refreshBackups();
                        }}
                        aria-label={`Delete backup ${b.label}`}
                        className="p-1 rounded hover:bg-red-500/15 text-red-500 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div
              className="pt-3 border-t flex flex-wrap items-center justify-between gap-2"
              style={{ borderColor: 'var(--border-default)' }}
            >
              <button
                type="button"
                onClick={async () => {
                  await loadSamplePlan();
                  refreshBackups();
                  setFeedback({ type: 'ok', msg: 'Loaded sample team plan.' });
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium hover:bg-slate-500/10 cursor-pointer"
                style={{ borderColor: 'var(--border-default)' }}
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
                Load Sample Plan
              </button>

              <button
                type="button"
                onClick={async () => {
                  await clearAllPlanData();
                  refreshBackups();
                  setFeedback({
                    type: 'ok',
                    msg: 'Cleared plan (previous state saved in Snapshots).',
                  });
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/12 hover:bg-red-500/20 text-red-600 dark:text-red-400 font-medium cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                Clear Plan
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
