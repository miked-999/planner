import type { HealthStatus, PriorityLevel, ProjectStatus } from '../../types/plan';
import { formatSignedWorkingDays } from '../../engine/dates';

const HEALTH_CONFIG: Record<
  HealthStatus,
  { dotClass: string; label: string }
> = {
  green: { dotClass: 'bg-emerald-500', label: 'On track' },
  amber: { dotClass: 'bg-amber-500', label: 'Tight headroom' },
  red: { dotClass: 'bg-red-500', label: 'Forecast late' },
  blue: { dotClass: 'bg-blue-500', label: 'Planned' },
  grey: { dotClass: 'bg-slate-400', label: 'Completed / Inactive' },
};

export function HealthDot({
  health,
  showLabel = false,
}: {
  health: HealthStatus;
  showLabel?: boolean;
}) {
  const cfg = HEALTH_CONFIG[health];
  return (
    <span className="inline-flex items-center gap-1.5" title={cfg.label}>
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${cfg.dotClass}`} />
      {showLabel && <span className="text-xs">{cfg.label}</span>}
    </span>
  );
}

const STATUS_LABELS: Record<ProjectStatus, { text: string; classes: string }> = {
  planned: {
    text: 'Planned',
    classes: 'bg-blue-500/12 text-blue-600 dark:text-blue-400 border-blue-500/25',
  },
  in_progress: {
    text: 'In Progress',
    classes: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25',
  },
  on_hold: {
    text: 'On Hold',
    classes: 'bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/25',
  },
  completed: {
    text: 'Completed',
    classes: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/25',
  },
};

export function StatusPill({ status }: { status: ProjectStatus }) {
  const cfg = STATUS_LABELS[status];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${cfg.classes}`}
    >
      {cfg.text}
    </span>
  );
}

const PRIORITY_STYLES: Record<PriorityLevel, { text: string; classes: string }> = {
  low: {
    text: 'Low',
    classes: 'text-slate-500 bg-slate-500/10',
  },
  medium: {
    text: 'Medium',
    classes: 'text-amber-600 dark:text-amber-400 bg-amber-500/10',
  },
  high: {
    text: 'High',
    classes: 'text-red-600 dark:text-red-400 bg-red-500/12 font-semibold',
  },
};

export function PriorityBadge({ priority }: { priority: PriorityLevel }) {
  const cfg = PRIORITY_STYLES[priority];
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[11px] ${cfg.classes}`}>
      {cfg.text}
    </span>
  );
}

export function HeadroomBadge({ headroomDays }: { headroomDays: number | null }) {
  if (headroomDays === null) {
    return (
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
        —
      </span>
    );
  }
  if (headroomDays < 0) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-500/15 text-red-600 dark:text-red-400">
        {formatSignedWorkingDays(headroomDays)}
      </span>
    );
  }
  if (headroomDays <= 5) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400">
        {formatSignedWorkingDays(headroomDays)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/12 text-emerald-700 dark:text-emerald-400">
      {formatSignedWorkingDays(headroomDays)}
    </span>
  );
}
