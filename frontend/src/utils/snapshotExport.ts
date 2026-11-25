import {
  computePersonAvailability,
  computeTbdWeeklyDemand,
  computeWeeklyCapacityMatrix,
  resolveAssignmentWindow,
} from '../engine/capacity';
import {
  calendarDaysBetween,
  formatMediumDate,
  formatShortDate,
  generateWeeks,
} from '../engine/dates';
import { findViolatedDependencyIds } from '../engine/dependencies';
import { computeScheduleMetrics } from '../engine/rollup';
import type { EntityType, PlanDocument } from '../types/plan';

export type SnapshotKind = 'roadmap' | 'people' | 'capacity';

export interface SnapshotOptions {
  kind: SnapshotKind;
  title: string;
  startIso: string;
  endIso: string;
  includeTasks: boolean;
  todayIso: string;
}

const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif';

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
}

export function renderPlanSnapshotCanvas(
  plan: PlanDocument,
  opts: SnapshotOptions,
): HTMLCanvasElement {
  const weeks = generateWeeks(
    opts.startIso,
    opts.endIso < opts.startIso ? opts.startIso : opts.endIso,
  );

  if (opts.kind === 'capacity') {
    return renderCapacityCanvas(plan, weeks, opts);
  }
  if (opts.kind === 'people') {
    return renderPeopleCanvas(plan, weeks, opts);
  }
  return renderRoadmapCanvas(plan, weeks, opts);
}

function drawBannerHeader(
  ctx: CanvasRenderingContext2D,
  width: number,
  title: string,
  subtitle: string,
  legendItems: { color: string; label: string; dashed?: boolean }[],
) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, 68);

  ctx.fillStyle = '#0f172a';
  ctx.font = `700 18px ${FONT_STACK}`;
  ctx.fillText(title, 24, 30);

  ctx.fillStyle = '#64748b';
  ctx.font = `500 12px ${FONT_STACK}`;
  ctx.fillText(subtitle, 24, 50);

  // Right-aligned legend
  let curX = width - 24;
  ctx.font = `500 11px ${FONT_STACK}`;
  for (let i = legendItems.length - 1; i >= 0; i -= 1) {
    const item = legendItems[i];
    const textW = ctx.measureText(item.label).width;
    curX -= textW;
    ctx.fillStyle = '#475569';
    ctx.fillText(item.label, curX, 38);
    curX -= 16;
    if (item.dashed) {
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(curX, 29, 10, 10);
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(curX + 5, 34, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    curX -= 16;
  }

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 68);
  ctx.lineTo(width, 68);
  ctx.stroke();
}

function renderRoadmapCanvas(
  plan: PlanDocument,
  weeks: ReturnType<typeof generateWeeks>,
  opts: SnapshotOptions,
): HTMLCanvasElement {
  const scale = 2;
  const leftColW = 280;
  const dayPx = weeks.length > 16 ? 12 : 16;
  const timelineW = Math.max(560, weeks.length * 7 * dayPx);
  const totalW = leftColW + timelineW + 32;
  const headerTop = 68;
  const gridHeaderH = 48;
  const rowH = 36;

  const peopleById = new Map(plan.people.map((p) => [p.id, p.name]));

  interface SnapRow {
    key: string;
    type: EntityType;
    id: string;
    name: string;
    color: string;
    start: string;
    end: string;
    requiredBy: string | null;
    pct: number;
    health: string;
    isLate: boolean;
    hasTbd: boolean;
    assignees: string;
  }

  const scheduledProjects = plan.projects.filter(
    (p): p is typeof p & { expected_start: string; expected_end: string } =>
      Boolean(p.expected_start && p.expected_end),
  );
  const backlogCount = plan.projects.length - scheduledProjects.length;

  const rows: SnapRow[] = [];
  for (const p of scheduledProjects) {
    const m = computeScheduleMetrics(p);
    const asgs = plan.assignments.filter((a) => a.project_id === p.id);
    const names = Array.from(
      new Set(
        asgs
          .map((a) =>
            a.person_id ? peopleById.get(a.person_id) : a.placeholder_label || 'TBD',
          )
          .filter((x): x is string => Boolean(x)),
      ),
    ).join(', ');
    rows.push({
      key: `project:${p.id}`,
      type: 'project',
      id: p.id,
      name: p.name,
      color: p.color,
      start: p.expected_start,
      end: p.expected_end,
      requiredBy: p.required_by,
      pct: p.percent_complete,
      health: m.health,
      isLate: m.isForecastLate,
      hasTbd: asgs.some((a) => !a.person_id),
      assignees: names,
    });

    if (opts.includeTasks) {
      const children = plan.tasks.filter(
        (t): t is typeof t & { expected_start: string; expected_end: string } =>
          t.project_id === p.id && Boolean(t.expected_start && t.expected_end),
      );
      for (const t of children) {
        const tm = computeScheduleMetrics(t);
        const tasgs = plan.assignments.filter((a) => a.task_id === t.id);
        rows.push({
          key: `task:${t.id}`,
          type: 'task',
          id: t.id,
          name: t.name,
          color: p.color,
          start: t.expected_start,
          end: t.expected_end,
          requiredBy: t.required_by,
          pct: t.percent_complete,
          health: tm.health,
          isLate: tm.isForecastLate,
          hasTbd: tasgs.some((a) => !a.person_id),
          assignees: '',
        });
      }
    }
  }

  const bodyH = Math.max(120, rows.length * rowH);
  const totalH = headerTop + gridHeaderH + bodyH + 24;

  const canvas = document.createElement('canvas');
  canvas.width = totalW * scale;
  canvas.height = totalH * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, totalW, totalH);

  const rangeStart = weeks[0].weekStart;
  const rangeEnd = weeks[weeks.length - 1].weekEnd;
  drawBannerHeader(
    ctx,
    totalW,
    opts.title || 'Project Roadmap',
    `${formatMediumDate(rangeStart)} – ${formatMediumDate(rangeEnd)} · As of ${formatMediumDate(opts.todayIso)}${
      backlogCount > 0 ? ` · ${backlogCount} unscheduled in backlog` : ''
    }`,
    [
      { color: '#10b981', label: 'On track' },
      { color: '#f59e0b', label: 'Required-by / Tight' },
      { color: '#ef4444', label: 'Late / Conflict' },
      { color: '#d97706', label: 'TBD Slot', dashed: true },
    ],
  );

  const gridLeft = 16 + leftColW;
  const gridTop = headerTop + gridHeaderH;
  const dateToX = (iso: string) =>
    gridLeft + calendarDaysBetween(rangeStart, iso) * dayPx;

  // Header background
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(16, headerTop, leftColW + timelineW, gridHeaderH);
  ctx.strokeStyle = '#cbd5e1';
  ctx.strokeRect(16, headerTop, leftColW + timelineW, gridHeaderH + bodyH);

  ctx.fillStyle = '#0f172a';
  ctx.font = `600 12px ${FONT_STACK}`;
  ctx.fillText('Project / Phase', 28, headerTop + 30);

  // Month & week headings
  let curMonth = '';
  weeks.forEach((w, idx) => {
    const wx = gridLeft + idx * 7 * dayPx;
    if (w.monthLabel !== curMonth) {
      curMonth = w.monthLabel;
      ctx.fillStyle = '#0f172a';
      ctx.font = `600 11px ${FONT_STACK}`;
      ctx.fillText(w.monthLabel, wx + 6, headerTop + 17);
    }
    ctx.fillStyle = '#64748b';
    ctx.font = `500 10px ${FONT_STACK}`;
    ctx.fillText(
      dayPx >= 14 ? `${w.weekLabel} · ${formatShortDate(w.weekStart)}` : w.weekLabel,
      wx + 5,
      headerTop + 38,
    );

    // Vertical week line + weekend tint
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(wx + 5 * dayPx, gridTop, 2 * dayPx, bodyH);

    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(wx, headerTop + 24);
    ctx.lineTo(wx, gridTop + bodyH);
    ctx.stroke();
  });

  // Left column separator
  ctx.strokeStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.moveTo(gridLeft, headerTop);
  ctx.lineTo(gridLeft, gridTop + bodyH);
  ctx.stroke();

  const healthColors: Record<string, string> = {
    green: '#10b981',
    amber: '#f59e0b',
    red: '#ef4444',
    blue: '#3b82f6',
    grey: '#94a3b8',
  };

  // Rows & Bars
  const rowIndex = new Map<string, { idx: number; row: SnapRow }>();
  rows.forEach((r, idx) => {
    rowIndex.set(r.key, { idx, row: r });
    const ry = gridTop + idx * rowH;

    if (idx % 2 === 1) {
      ctx.fillStyle = 'rgba(241, 245, 249, 0.45)';
      ctx.fillRect(16, ry, leftColW + timelineW, rowH);
    }

    ctx.strokeStyle = '#f1f5f9';
    ctx.beginPath();
    ctx.moveTo(16, ry + rowH);
    ctx.lineTo(gridLeft + timelineW, ry + rowH);
    ctx.stroke();

    // Health dot + label
    const indent = r.type === 'task' ? 44 : 28;
    ctx.fillStyle = healthColors[r.health] ?? '#3b82f6';
    ctx.beginPath();
    ctx.arc(indent, ry + rowH / 2, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = r.type === 'project' ? '#0f172a' : '#334155';
    ctx.font = `${r.type === 'project' ? '600' : '400'} 12px ${FONT_STACK}`;
    const maxTextW = leftColW - (indent - 16) - (r.hasTbd ? 44 : 16);
    ctx.fillText(truncateText(ctx, r.name, maxTextW), indent + 10, ry + rowH / 2 + 4);

    if (r.hasTbd) {
      ctx.strokeStyle = '#d97706';
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(gridLeft - 36, ry + 10, 28, 15);
      ctx.setLineDash([]);
      ctx.fillStyle = '#b45309';
      ctx.font = `700 9px ${FONT_STACK}`;
      ctx.fillText('TBD', gridLeft - 31, ry + 21);
    }

    // Clip bar inside timeline range
    const rawX1 = dateToX(r.start);
    const rawX2 = dateToX(r.end) + dayPx;
    const x1 = Math.max(gridLeft, rawX1);
    const x2 = Math.min(gridLeft + timelineW, rawX2);

    if (x2 > x1) {
      const bh = r.type === 'project' ? 22 : 16;
      const by = ry + (rowH - bh) / 2;
      const bw = Math.max(4, x2 - x1);

      ctx.fillStyle = `${r.color}28`;
      roundRect(ctx, x1, by, bw, bh, 5);
      ctx.fill();

      if (r.pct > 0) {
        const pw = Math.max(4, (bw * r.pct) / 100);
        ctx.fillStyle = r.color;
        roundRect(ctx, x1, by, pw, bh, 5);
        ctx.fill();
      }

      ctx.strokeStyle = r.isLate ? '#ef4444' : r.color;
      ctx.lineWidth = r.isLate ? 1.5 : 1;
      roundRect(ctx, x1, by, bw, bh, 5);
      ctx.stroke();

      if (bw > 48) {
        ctx.fillStyle = r.pct >= 50 ? '#ffffff' : '#0f172a';
        ctx.font = `600 10px ${FONT_STACK}`;
        const barLabel =
          bw > 130 && r.assignees ? `${r.pct}% · ${r.assignees}` : `${r.pct}%`;
        ctx.fillText(truncateText(ctx, barLabel, bw - 12), x1 + 6, by + bh / 2 + 3.5);
      }
    }

    // Required-by diamond
    if (r.requiredBy) {
      const rx = dateToX(r.requiredBy) + dayPx;
      if (rx >= gridLeft && rx <= gridLeft + timelineW) {
        const cy = ry + rowH / 2;
        ctx.fillStyle = r.isLate ? '#ef4444' : '#f59e0b';
        ctx.beginPath();
        ctx.moveTo(rx, cy - 5);
        ctx.lineTo(rx + 5, cy);
        ctx.lineTo(rx, cy + 5);
        ctx.lineTo(rx - 5, cy);
        ctx.closePath();
        ctx.fill();
      }
    }
  });

  // Dependency connectors
  const violated = findViolatedDependencyIds(plan);
  for (const dep of plan.dependencies) {
    const src = rowIndex.get(`${dep.from_type}:${dep.from_id}`);
    const tgt = rowIndex.get(`${dep.to_type}:${dep.to_id}`);
    if (!src || !tgt) continue;
    const x1 = dateToX(src.row.end) + dayPx;
    const x2 = dateToX(tgt.row.start);
    if (x1 < gridLeft || x2 > gridLeft + timelineW) continue;
    const y1 = gridTop + src.idx * rowH + rowH / 2;
    const y2 = gridTop + tgt.idx * rowH + rowH / 2;
    const isBroken = violated.has(dep.id);

    ctx.strokeStyle = isBroken ? '#ef4444' : '#64748b';
    ctx.lineWidth = 1.25;
    if (isBroken) ctx.setLineDash([4, 2]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + 8, y1);
    ctx.lineTo(x1 + 8, y2);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Today vertical line
  const todayX = dateToX(opts.todayIso) + dayPx * 0.5;
  if (todayX >= gridLeft && todayX <= gridLeft + timelineW) {
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(todayX, headerTop + 24);
    ctx.lineTo(todayX, gridTop + bodyH);
    ctx.stroke();
  }

  return canvas;
}

function renderPeopleCanvas(
  plan: PlanDocument,
  weeks: ReturnType<typeof generateWeeks>,
  opts: SnapshotOptions,
): HTMLCanvasElement {
  const scale = 2;
  const leftColW = 240;
  const dayPx = weeks.length > 16 ? 12 : 16;
  const timelineW = Math.max(560, weeks.length * 7 * dayPx);
  const totalW = leftColW + timelineW + 32;
  const headerTop = 68;
  const gridHeaderH = 48;
  const laneH = 22;
  const laneGap = 5;

  const projectMap = new Map(plan.projects.map((p) => [p.id, p]));
  const taskMap = new Map(plan.tasks.map((t) => [t.id, t]));

  interface GroupRow {
    title: string;
    badge: string;
    isTbd: boolean;
    bars: {
      label: string;
      color: string;
      start: string;
      end: string;
      pct: number;
      lane: number;
      isLeave?: boolean;
    }[];
    height: number;
  }

  const groups: GroupRow[] = [];

  // Optional TBD row
  const tbdAsgs = plan.assignments.filter((a) => !a.person_id);
  if (tbdAsgs.length > 0) {
    const laneEnds: string[] = [];
    const bars: GroupRow['bars'] = [];
    for (const a of tbdAsgs) {
      const proj = projectMap.get(a.project_id);
      const task = a.task_id ? taskMap.get(a.task_id) : undefined;
      if (!proj || proj.status === 'completed') continue;
      const win = resolveAssignmentWindow(a, proj, task);
      if (!win) continue;
      let lane = laneEnds.findIndex((end) => win.start > end);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(win.end);
      } else {
        laneEnds[lane] = win.end;
      }
      bars.push({
        label: `${a.placeholder_label || 'TBD'} · ${proj.name}`,
        color: proj.color,
        start: win.start,
        end: win.end,
        pct: a.allocation_pct ?? 100,
        lane,
      });
    }
    if (bars.length > 0) {
      const lanes = Math.max(1, laneEnds.length);
      groups.push({
        title: 'Unassigned (TBD)',
        badge: `${bars.length} open`,
        isTbd: true,
        bars,
        height: Math.max(44, 16 + lanes * laneH + (lanes - 1) * laneGap),
      });
    }
  }

  for (const person of plan.people) {
    const avail = computePersonAvailability(plan, person.id, opts.todayIso);
    const rawItems: Omit<GroupRow['bars'][number], 'lane'>[] = [];
    for (const a of plan.assignments) {
      if (a.person_id !== person.id) continue;
      const proj = projectMap.get(a.project_id);
      const task = a.task_id ? taskMap.get(a.task_id) : undefined;
      if (!proj || proj.status === 'completed') continue;
      const win = resolveAssignmentWindow(a, proj, task);
      if (!win) continue;
      rawItems.push({
        label: task ? `${proj.name} · ${task.name}` : proj.name,
        color: proj.color,
        start: win.start,
        end: win.end,
        pct: a.allocation_pct ?? 100,
      });
    }
    for (const u of plan.unavailabilities) {
      if (u.person_id !== person.id) continue;
      rawItems.push({
        label: u.reason || 'Annual Leave',
        color: '#64748b',
        start: u.start_date,
        end: u.end_date,
        pct: u.allocation_pct ?? 100,
        isLeave: true,
      });
    }
    rawItems.sort((x, y) => x.start.localeCompare(y.start));
    const laneEnds: string[] = [];
    const bars = rawItems.map((it) => {
      let lane = laneEnds.findIndex((e) => it.start > e);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(it.end);
      } else {
        laneEnds[lane] = it.end;
      }
      return { ...it, lane };
    });
    const lanes = Math.max(1, laneEnds.length);
    groups.push({
      title: person.name,
      badge: avail.isAvailableNow
        ? `Now (${avail.freePct}%)`
        : `Free ${formatShortDate(avail.availableDate)}`,
      isTbd: false,
      bars,
      height: Math.max(44, 16 + lanes * laneH + (lanes - 1) * laneGap),
    });
  }

  const bodyH = Math.max(120, groups.reduce((acc, g) => acc + g.height, 0));
  const totalH = headerTop + gridHeaderH + bodyH + 24;

  const canvas = document.createElement('canvas');
  canvas.width = totalW * scale;
  canvas.height = totalH * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, totalW, totalH);

  const rangeStart = weeks[0].weekStart;
  const rangeEnd = weeks[weeks.length - 1].weekEnd;
  drawBannerHeader(
    ctx,
    totalW,
    opts.title || 'Team Schedule & Availability',
    `${formatMediumDate(rangeStart)} – ${formatMediumDate(rangeEnd)} · As of ${formatMediumDate(opts.todayIso)}`,
    [
      { color: '#2563eb', label: 'Assigned Work' },
      { color: '#64748b', label: 'Leave / Blocked' },
      { color: '#d97706', label: 'Open TBD Slot', dashed: true },
    ],
  );

  const gridLeft = 16 + leftColW;
  const gridTop = headerTop + gridHeaderH;
  const dateToX = (iso: string) =>
    gridLeft + calendarDaysBetween(rangeStart, iso) * dayPx;

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(16, headerTop, leftColW + timelineW, gridHeaderH);
  ctx.strokeStyle = '#cbd5e1';
  ctx.strokeRect(16, headerTop, leftColW + timelineW, gridHeaderH + bodyH);

  ctx.fillStyle = '#0f172a';
  ctx.font = `600 12px ${FONT_STACK}`;
  ctx.fillText('Team Member', 28, headerTop + 30);

  let curMonth = '';
  weeks.forEach((w, idx) => {
    const wx = gridLeft + idx * 7 * dayPx;
    if (w.monthLabel !== curMonth) {
      curMonth = w.monthLabel;
      ctx.fillStyle = '#0f172a';
      ctx.font = `600 11px ${FONT_STACK}`;
      ctx.fillText(w.monthLabel, wx + 6, headerTop + 17);
    }
    ctx.fillStyle = '#64748b';
    ctx.font = `500 10px ${FONT_STACK}`;
    ctx.fillText(w.weekLabel, wx + 5, headerTop + 38);
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(wx, headerTop + 24);
    ctx.lineTo(wx, gridTop + bodyH);
    ctx.stroke();
  });

  ctx.strokeStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.moveTo(gridLeft, headerTop);
  ctx.lineTo(gridLeft, gridTop + bodyH);
  ctx.stroke();

  let curY = gridTop;
  for (const grp of groups) {
    if (grp.isTbd) {
      ctx.fillStyle = 'rgba(245, 158, 11, 0.06)';
      ctx.fillRect(16, curY, leftColW + timelineW, grp.height);
    }
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(16, curY + grp.height);
    ctx.lineTo(gridLeft + timelineW, curY + grp.height);
    ctx.stroke();

    ctx.fillStyle = grp.isTbd ? '#b45309' : '#0f172a';
    ctx.font = `600 12px ${FONT_STACK}`;
    ctx.fillText(truncateText(ctx, grp.title, leftColW - 95), 28, curY + 24);

    ctx.fillStyle = '#64748b';
    ctx.font = `500 10px ${FONT_STACK}`;
    ctx.fillText(grp.badge, gridLeft - 78, curY + 24);

    for (const bar of grp.bars) {
      const x1 = Math.max(gridLeft, dateToX(bar.start));
      const x2 = Math.min(gridLeft + timelineW, dateToX(bar.end) + dayPx);
      if (x2 <= x1) continue;
      const bw = x2 - x1;
      const by = curY + 8 + bar.lane * (laneH + laneGap);

      if (grp.isTbd) {
        ctx.fillStyle = `${bar.color}20`;
        roundRect(ctx, x1, by, bw, laneH, 4);
        ctx.fill();
        ctx.strokeStyle = bar.color;
        ctx.setLineDash([4, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#0f172a';
      } else {
        ctx.fillStyle = bar.color;
        roundRect(ctx, x1, by, bw, laneH, 4);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
      }

      if (bw > 44) {
        ctx.font = `600 10px ${FONT_STACK}`;
        ctx.fillText(
          truncateText(ctx, `${bar.label} (${bar.pct}%)`, bw - 10),
          x1 + 5,
          by + 14.5,
        );
      }
    }

    curY += grp.height;
  }

  return canvas;
}

function renderCapacityCanvas(
  plan: PlanDocument,
  weeks: ReturnType<typeof generateWeeks>,
  opts: SnapshotOptions,
): HTMLCanvasElement {
  const scale = 2;
  const leftColW = 210;
  const colW = 76;
  const gridW = weeks.length * colW;
  const totalW = Math.max(760, leftColW + gridW + 32);
  const headerTop = 68;
  const gridHeaderH = 44;
  const rowH = 36;

  const matrix = computeWeeklyCapacityMatrix(plan, weeks);
  const tbdRow = computeTbdWeeklyDemand(plan, weeks);
  const hasTbd = plan.assignments.some((a) => !a.person_id);

  const rowCount = plan.people.length + (hasTbd ? 1 : 0);
  const bodyH = Math.max(80, rowCount * rowH);
  const totalH = headerTop + gridHeaderH + bodyH + 24;

  const canvas = document.createElement('canvas');
  canvas.width = totalW * scale;
  canvas.height = totalH * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, totalW, totalH);

  const rangeStart = weeks[0].weekStart;
  const rangeEnd = weeks[weeks.length - 1].weekEnd;
  drawBannerHeader(
    ctx,
    totalW,
    opts.title || 'Team Resource Capacity Heatmap',
    `${formatMediumDate(rangeStart)} – ${formatMediumDate(rangeEnd)}`,
    [
      { color: '#ef4444', label: '>100% Conflict' },
      { color: '#10b981', label: '75–100% Full' },
      { color: '#f59e0b', label: '1–74% Partial' },
    ],
  );

  const gridLeft = 16 + leftColW;
  const gridTop = headerTop + gridHeaderH;

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(16, headerTop, leftColW + gridW, gridHeaderH);
  ctx.strokeStyle = '#cbd5e1';
  ctx.strokeRect(16, headerTop, leftColW + gridW, gridHeaderH + bodyH);

  ctx.fillStyle = '#0f172a';
  ctx.font = `600 12px ${FONT_STACK}`;
  ctx.fillText('Person', 28, headerTop + 26);

  weeks.forEach((w, i) => {
    const cx = gridLeft + i * colW;
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(cx, headerTop);
    ctx.lineTo(cx, gridTop + bodyH);
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = `600 11px ${FONT_STACK}`;
    ctx.fillText(w.weekLabel, cx + 8, headerTop + 18);
    ctx.fillStyle = '#64748b';
    ctx.font = `400 10px ${FONT_STACK}`;
    ctx.fillText(formatShortDate(w.weekStart), cx + 8, headerTop + 34);
  });

  let rowIdx = 0;
  if (hasTbd) {
    const ry = gridTop;
    ctx.fillStyle = '#b45309';
    ctx.font = `600 12px ${FONT_STACK}`;
    ctx.fillText('Unassigned (TBD)', 28, ry + 22);

    weeks.forEach((w, i) => {
      const pct = tbdRow.get(w.weekStart)?.weeklyPct ?? 0;
      const cx = gridLeft + i * colW;
      if (pct > 0) {
        ctx.fillStyle = 'rgba(245, 158, 11, 0.16)';
        roundRect(ctx, cx + 4, ry + 5, colW - 8, rowH - 10, 5);
        ctx.fill();
        ctx.strokeStyle = '#d97706';
        ctx.setLineDash([3, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#92400e';
        ctx.font = `700 11px ${FONT_STACK}`;
        ctx.fillText(`${pct}%`, cx + 22, ry + 22);
      } else {
        ctx.fillStyle = '#94a3b8';
        ctx.font = `400 11px ${FONT_STACK}`;
        ctx.fillText('—', cx + 32, ry + 22);
      }
    });

    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(16, ry + rowH);
    ctx.lineTo(gridLeft + gridW, ry + rowH);
    ctx.stroke();
    rowIdx += 1;
  }

  for (const person of plan.people) {
    const ry = gridTop + rowIdx * rowH;
    const pRow = matrix.get(person.id);

    ctx.fillStyle = '#0f172a';
    ctx.font = `600 12px ${FONT_STACK}`;
    ctx.fillText(truncateText(ctx, person.name, leftColW - 24), 28, ry + 22);

    weeks.forEach((w, i) => {
      const pct = pRow?.get(w.weekStart)?.weeklyPct ?? 0;
      const cx = gridLeft + i * colW;

      let bg = '';
      let fg = '#64748b';
      if (pct > 100) {
        bg = 'rgba(239, 68, 68, 0.18)';
        fg = '#b91c1c';
      } else if (pct >= 75) {
        bg = 'rgba(16, 185, 129, 0.18)';
        fg = '#047857';
      } else if (pct > 0) {
        bg = 'rgba(245, 158, 11, 0.18)';
        fg = '#b45309';
      }

      if (bg) {
        ctx.fillStyle = bg;
        roundRect(ctx, cx + 4, ry + 5, colW - 8, rowH - 10, 5);
        ctx.fill();
      }
      ctx.fillStyle = fg;
      ctx.font = `${pct > 0 ? '600' : '400'} 11px ${FONT_STACK}`;
      ctx.fillText(`${pct}%`, cx + 22, ry + 22);
    });

    ctx.strokeStyle = '#f1f5f9';
    ctx.beginPath();
    ctx.moveTo(16, ry + rowH);
    ctx.lineTo(gridLeft + gridW, ry + rowH);
    ctx.stroke();
    rowIdx += 1;
  }

  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Failed to generate PNG blob'));
    }, 'image/png');
  });
}

export async function downloadSnapshotPng(
  canvas: HTMLCanvasElement,
  filename: string,
): Promise<void> {
  const blob = await canvasToBlob(canvas);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function copySnapshotToClipboard(canvas: HTMLCanvasElement): Promise<void> {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('Clipboard image API not supported in this browser');
  }
  const blob = await canvasToBlob(canvas);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export function printSnapshotAsLandscapePdf(
  canvas: HTMLCanvasElement,
  title: string,
): void {
  const dataUrl = canvas.toDataURL('image/png');
  const win = window.open('', '_blank');
  if (!win) {
    window.print();
    return;
  }
  win.document.write(`<!doctype html>
<html>
  <head>
    <title>${title.replace(/</g, '&lt;')}</title>
    <style>
      @page { size: landscape; margin: 10mm; }
      html, body { margin: 0; padding: 0; background: #fff; text-align: center; }
      img { max-width: 100%; max-height: 96vh; height: auto; object-fit: contain; }
    </style>
  </head>
  <body>
    <img src="${dataUrl}" alt="Plan snapshot" onload="setTimeout(() => { window.print(); }, 120);" />
  </body>
</html>`);
  win.document.close();
}
