import React from 'react';
import { GripVertical } from 'lucide-react';
import type { DropPlacement } from '../../engine/ordering';

/** Custom drag type so reordering never collides with backlog-card scheduling drags. */
export const REORDER_MIME = 'text/x-planner-reorder';

export interface ReorderItem {
  type: 'project' | 'task';
  id: string;
  projectId: string;
}

export interface ReorderActions {
  reorderProject: (dragId: string, targetId: string, placement: DropPlacement) => void;
  reorderTask: (
    dragTaskId: string,
    targetTaskId: string | null,
    placement: DropPlacement,
  ) => void;
}

/**
 * Works out whether `target` is a valid drop spot for `drag`, and where.
 * - Projects can only be dropped onto other project rows.
 * - Phases can be dropped onto sibling phases, or onto their own project row (moves to top).
 */
export function resolveReorderDrop(
  drag: ReorderItem,
  target: ReorderItem,
  clientY: number,
  rect: DOMRect,
): DropPlacement | null {
  const byMidpoint: DropPlacement = clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  if (drag.type === 'project') {
    if (target.type !== 'project' || target.id === drag.id) return null;
    return byMidpoint;
  }
  if (target.type === 'project') {
    return target.id === drag.projectId ? 'after' : null;
  }
  if (target.projectId !== drag.projectId || target.id === drag.id) return null;
  return byMidpoint;
}

export function applyReorderDrop(
  drag: ReorderItem,
  target: ReorderItem,
  placement: DropPlacement,
  actions: ReorderActions,
): void {
  if (drag.type === 'project') {
    actions.reorderProject(drag.id, target.id, placement);
  } else if (target.type === 'project') {
    actions.reorderTask(drag.id, null, 'before');
  } else {
    actions.reorderTask(drag.id, target.id, placement);
  }
}

/** Moves `current` one step up/down among its visible siblings (projects, or phases of one project). */
export function keyboardReorder(
  visible: readonly ReorderItem[],
  current: ReorderItem,
  delta: -1 | 1,
  actions: ReorderActions,
): void {
  const siblings = visible.filter((v) =>
    current.type === 'project'
      ? v.type === 'project'
      : v.type === 'task' && v.projectId === current.projectId,
  );
  const idx = siblings.findIndex((s) => s.id === current.id);
  const neighbor = siblings[idx + delta];
  if (idx < 0 || !neighbor) return;
  const placement: DropPlacement = delta < 0 ? 'before' : 'after';
  if (current.type === 'project') actions.reorderProject(current.id, neighbor.id, placement);
  else actions.reorderTask(current.id, neighbor.id, placement);
}

/** Inset shadow used to draw the drop indicator line on the hovered row. */
export function dropIndicatorShadow(placement: DropPlacement | null | undefined): string | undefined {
  if (!placement) return undefined;
  return placement === 'before' ? 'inset 0 2px 0 0 #3b82f6' : 'inset 0 -2px 0 0 #3b82f6';
}

interface ReorderHandleProps {
  item: ReorderItem;
  label: string;
  onDragStateChange: (item: ReorderItem | null) => void;
  onKeyboardMove: (delta: -1 | 1) => void;
}

/**
 * Drag handle (⋮⋮) for reordering rows. Mouse: drag the handle. Keyboard: focus the
 * handle and press ↑ / ↓ to move one position.
 */
export function ReorderHandle({
  item,
  label,
  onDragStateChange,
  onKeyboardMove,
}: ReorderHandleProps) {
  const onDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.dataTransfer.setData(REORDER_MIME, JSON.stringify(item));
    e.dataTransfer.effectAllowed = 'move';
    const rowEl = e.currentTarget.closest<HTMLElement>('[data-reorder-row]');
    if (rowEl) {
      e.dataTransfer.setDragImage(rowEl, 16, Math.round(rowEl.clientHeight / 2));
    }
    onDragStateChange(item);
  };

  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onDragEnd={() => onDragStateChange(null)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          onKeyboardMove(e.key === 'ArrowUp' ? -1 : 1);
        }
      }}
      aria-label={`Reorder ${label}. Drag, or press up and down arrow keys to move.`}
      title="Drag to reorder (or focus and use ↑ / ↓)"
      className="p-0.5 -ml-1 rounded cursor-grab active:cursor-grabbing opacity-40 hover:opacity-100 focus-visible:opacity-100 hover:bg-slate-500/15 shrink-0"
    >
      <GripVertical className="w-3.5 h-3.5" aria-hidden="true" />
    </button>
  );
}

/** Same footprint as the handle, so names stay aligned when reordering isn't available. */
export function ReorderHandleSpacer() {
  return <span className="w-3.5 -ml-1 shrink-0" aria-hidden="true" />;
}
