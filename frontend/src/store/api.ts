import type { BackupInfo, PlanDocument } from '../types/plan';

async function handleJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      detail = data.detail || JSON.stringify(data);
    } catch {
      detail = await res.text();
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getPlan(): Promise<PlanDocument> {
    return fetch('/api/plan').then((r) => handleJson<PlanDocument>(r));
  },

  savePlan(plan: PlanDocument): Promise<PlanDocument> {
    return fetch('/api/plan', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plan),
    }).then((r) => handleJson<PlanDocument>(r));
  },

  seedSamplePlan(): Promise<PlanDocument> {
    return fetch('/api/plan/seed', { method: 'POST' }).then((r) =>
      handleJson<PlanDocument>(r),
    );
  },

  clearPlan(): Promise<PlanDocument> {
    return fetch('/api/plan/clear', { method: 'POST' }).then((r) =>
      handleJson<PlanDocument>(r),
    );
  },

  importJson(payload: unknown): Promise<PlanDocument> {
    return fetch('/api/import/json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((r) => handleJson<PlanDocument>(r));
  },

  importProjectsCsv(
    csvText: string,
    mode: 'merge' | 'replace',
  ): Promise<{ imported_count: number; created_people: string[]; plan: PlanDocument }> {
    return fetch('/api/import/csv/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv_text: csvText, mode }),
    }).then((r) =>
      handleJson<{ imported_count: number; created_people: string[]; plan: PlanDocument }>(r),
    );
  },

  listBackups(): Promise<BackupInfo[]> {
    return fetch('/api/backups').then((r) => handleJson<BackupInfo[]>(r));
  },

  createBackup(label: string): Promise<BackupInfo> {
    return fetch('/api/backups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    }).then((r) => handleJson<BackupInfo>(r));
  },

  restoreBackup(filename: string): Promise<PlanDocument> {
    return fetch(`/api/backups/${encodeURIComponent(filename)}/restore`, {
      method: 'POST',
    }).then((r) => handleJson<PlanDocument>(r));
  },

  deleteBackup(filename: string): Promise<void> {
    return fetch(`/api/backups/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    }).then((r) => {
      if (!r.ok) throw new Error('Failed to delete backup');
    });
  },
};
