import React, { useState } from 'react';
import { CalendarOff, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { computePersonAvailability } from '../../engine/capacity';
import { addWorkingDays, formatShortDate, snapToWorkingDay } from '../../engine/dates';
import { usePlan } from '../../store/PlanContext';
import { ModalDialog } from '../ui/ModalDialog';

export function TeamDrawerModal() {
  const {
    plan,
    todayIso,
    teamDrawerOpen,
    setTeamDrawerOpen,
    addPerson,
    renamePerson,
    removePerson,
    addUnavailability,
    removeUnavailability,
  } = usePlan();

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const startDefault = snapToWorkingDay(todayIso, 'forward');
  const [leavePersonId, setLeavePersonId] = useState('');
  const [leaveStart, setLeaveStart] = useState(startDefault);
  const [leaveEnd, setLeaveEnd] = useState(addWorkingDays(startDefault, 4));
  const [leaveReason, setLeaveReason] = useState('Annual Leave');

  const handleAddPerson = (e: React.FormEvent) => {
    e.preventDefault();
    const created = addPerson(newName);
    if (created) {
      setNewName('');
      if (!leavePersonId) setLeavePersonId(created.id);
    }
  };

  const handleAddLeave = (e: React.FormEvent) => {
    e.preventDefault();
    const pid = leavePersonId || plan.people[0]?.id;
    if (!pid || !leaveStart || !leaveEnd) return;
    addUnavailability({
      person_id: pid,
      start_date: leaveStart,
      end_date: leaveEnd < leaveStart ? leaveStart : leaveEnd,
      reason: leaveReason.trim() || 'Annual Leave',
      allocation_pct: 100,
    });
  };

  return (
    <ModalDialog
      open={teamDrawerOpen}
      onClose={() => setTeamDrawerOpen(false)}
      title="Team Members & Unavailability"
      subtitle="Add or rename people, view next availability, and block out annual leave."
      maxWidthClass="max-w-2xl"
    >
      <div className="space-y-6 text-xs">
        {/* Add Team Member */}
        <form onSubmit={handleAddPerson} className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Add team member name (e.g. Sam Taylor)…"
            aria-label="New team member name"
            className="flex-1 px-3 py-2 rounded-lg border text-xs"
            style={{
              borderColor: 'var(--border-default)',
              backgroundColor: 'var(--bg-subtle)',
            }}
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
            Add Person
          </button>
        </form>

        {/* People List */}
        <div
          className="rounded-lg border divide-y"
          style={{ borderColor: 'var(--border-default)' }}
        >
          {plan.people.length === 0 ? (
            <div className="p-4 text-center" style={{ color: 'var(--text-muted)' }}>
              No team members yet. Add someone above to start assigning work.
            </div>
          ) : (
            plan.people.map((person) => {
              const avail = computePersonAvailability(plan, person.id, todayIso);
              const asgCount = plan.assignments.filter(
                (a) => a.person_id === person.id,
              ).length;
              const isEditing = editingId === person.id;

              return (
                <div
                  key={person.id}
                  className="px-3 py-2.5 flex items-center justify-between gap-3"
                  style={{ borderColor: 'var(--border-default)' }}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {isEditing ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          renamePerson(person.id, editingValue);
                          setEditingId(null);
                        }}
                        className="flex items-center gap-1.5 flex-1"
                      >
                        <input
                          type="text"
                          autoFocus
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          className="px-2 py-1 rounded border text-xs flex-1"
                          style={{ borderColor: 'var(--border-strong)' }}
                        />
                        <button
                          type="submit"
                          className="px-2 py-1 rounded bg-blue-600 text-white font-medium cursor-pointer"
                        >
                          Save
                        </button>
                      </form>
                    ) : (
                      <>
                        <span className="font-semibold truncate">{person.name}</span>
                        <span
                          className="px-2 py-0.5 rounded-full text-[11px]"
                          style={{
                            backgroundColor: 'var(--bg-subtle)',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {asgCount} assignment{asgCount === 1 ? '' : 's'}
                        </span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                        avail.isAvailableNow
                          ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
                          : 'bg-blue-500/12 text-blue-600 dark:text-blue-400'
                      }`}
                    >
                      {avail.isAvailableNow
                        ? `Available now (${avail.freePct}% free)`
                        : `Free ${formatShortDate(avail.availableDate)}`}
                    </span>

                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(person.id);
                        setEditingValue(person.name);
                      }}
                      aria-label={`Rename ${person.name}`}
                      className="p-1.5 rounded hover:bg-slate-500/10 cursor-pointer"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>

                    <button
                      type="button"
                      onClick={() => removePerson(person.id)}
                      aria-label={`Remove ${person.name}`}
                      className="p-1.5 rounded hover:bg-red-500/15 text-red-500 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Unavailability / Annual Leave Section */}
        {plan.people.length > 0 && (
          <div className="space-y-3 pt-2">
            <h2 className="font-semibold flex items-center gap-1.5 uppercase tracking-wider text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              <CalendarOff className="w-3.5 h-3.5" aria-hidden="true" />
              Annual Leave &amp; Blocked Periods
            </h2>

            <form
              onSubmit={handleAddLeave}
              className="grid grid-cols-1 sm:grid-cols-4 gap-2 p-3 rounded-lg border"
              style={{
                borderColor: 'var(--border-default)',
                backgroundColor: 'var(--bg-subtle)',
              }}
            >
              <select
                value={leavePersonId || plan.people[0]?.id || ''}
                onChange={(e) => setLeavePersonId(e.target.value)}
                aria-label="Person for leave"
                className="px-2.5 py-1.5 rounded border text-xs"
                style={{
                  borderColor: 'var(--border-default)',
                  backgroundColor: 'var(--bg-surface)',
                }}
              >
                {plan.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>

              <input
                type="date"
                value={leaveStart}
                onChange={(e) => setLeaveStart(e.target.value)}
                aria-label="Leave start date"
                className="px-2.5 py-1.5 rounded border text-xs"
                style={{
                  borderColor: 'var(--border-default)',
                  backgroundColor: 'var(--bg-surface)',
                }}
              />

              <input
                type="date"
                value={leaveEnd}
                min={leaveStart}
                onChange={(e) => setLeaveEnd(e.target.value)}
                aria-label="Leave end date"
                className="px-2.5 py-1.5 rounded border text-xs"
                style={{
                  borderColor: 'var(--border-default)',
                  backgroundColor: 'var(--bg-surface)',
                }}
              />

              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={leaveReason}
                  onChange={(e) => setLeaveReason(e.target.value)}
                  placeholder="Reason"
                  aria-label="Leave reason"
                  className="min-w-0 flex-1 px-2.5 py-1.5 rounded border text-xs"
                  style={{
                    borderColor: 'var(--border-default)',
                    backgroundColor: 'var(--bg-surface)',
                  }}
                />
                <button
                  type="submit"
                  aria-label="Add leave block"
                  className="px-2.5 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </form>

            {plan.unavailabilities.length > 0 && (
              <div
                className="rounded-lg border divide-y"
                style={{ borderColor: 'var(--border-default)' }}
              >
                {plan.unavailabilities.map((u) => {
                  const person = plan.people.find((p) => p.id === u.person_id);
                  return (
                    <div
                      key={u.id}
                      className="px-3 py-2 flex items-center justify-between gap-2"
                      style={{ borderColor: 'var(--border-default)' }}
                    >
                      <div>
                        <span className="font-medium">{person?.name ?? u.person_id}</span>
                        <span className="mx-1.5" style={{ color: 'var(--text-muted)' }}>
                          ·
                        </span>
                        <span>{u.reason}</span>
                        <span
                          className="ml-2 text-[11px]"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          ({formatShortDate(u.start_date)} – {formatShortDate(u.end_date)})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeUnavailability(u.id)}
                        aria-label="Remove leave block"
                        className="p-1 rounded hover:bg-red-500/15 text-red-500 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
