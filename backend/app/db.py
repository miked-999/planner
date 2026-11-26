"""SQLite persistence layer with WAL mode and atomic plan synchronization."""

from __future__ import annotations

import os
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .schemas import (
    Assignment,
    CheckpointDetail,
    CheckpointKind,
    CheckpointSummary,
    Dependency,
    Person,
    PlanDocument,
    Project,
    Task,
    Unavailability,
)

REPO_ROOT = Path(__file__).resolve().parents[2]


def get_db_path() -> Path:
    env_path = os.environ.get("PLANNER_DB_PATH")
    path = Path(env_path) if env_path else REPO_ROOT / "data" / "planner.db"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def get_backup_dir() -> Path:
    env_dir = os.environ.get("PLANNER_BACKUP_DIR")
    path = Path(env_dir) if env_dir else get_db_path().parent / "backups"
    path.mkdir(parents=True, exist_ok=True)
    return path


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    expected_start TEXT,
    actual_start TEXT,
    expected_end TEXT,
    estimated_days INTEGER DEFAULT 10,
    original_expected_end TEXT,
    required_by TEXT,
    actual_end TEXT,
    percent_complete INTEGER NOT NULL DEFAULT 0,
    auto_progress INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'planned',
    priority TEXT NOT NULL DEFAULT 'medium',
    color TEXT NOT NULL DEFAULT '#3b82f6',
    notes TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    expected_start TEXT,
    actual_start TEXT,
    expected_end TEXT,
    original_expected_end TEXT,
    required_by TEXT,
    actual_end TEXT,
    percent_complete INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'planned',
    priority TEXT NOT NULL DEFAULT 'medium',
    notes TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS assignments (
    id TEXT PRIMARY KEY,
    person_id TEXT REFERENCES people(id) ON DELETE CASCADE,
    placeholder_label TEXT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    allocation_pct INTEGER,
    start_date TEXT,
    end_date TEXT
);

CREATE TABLE IF NOT EXISTS unavailabilities (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT 'Annual Leave',
    allocation_pct INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS dependencies (
    id TEXT PRIMARY KEY,
    from_type TEXT NOT NULL,
    from_id TEXT NOT NULL,
    to_type TEXT NOT NULL,
    to_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoints (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'manual',
    week_key TEXT,
    created_by TEXT NOT NULL DEFAULT 'Local User',
    created_at TEXT NOT NULL,
    plan_version INTEGER NOT NULL DEFAULT 1,
    project_count INTEGER NOT NULL DEFAULT 0,
    people_count INTEGER NOT NULL DEFAULT 0,
    plan_json TEXT NOT NULL
);
"""


def connect(db_path: Path | None = None) -> sqlite3.Connection:
    target = db_path or get_db_path()
    conn = sqlite3.connect(str(target))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def init_db(db_path: Path | None = None) -> None:
    conn = connect(db_path)
    try:
        # Temporarily disable FK checks if table rebuilds are needed
        conn.execute("PRAGMA foreign_keys=OFF;")
        with conn:
            conn.executescript(SCHEMA_SQL)

            # v3 migration: nullable expected_start/expected_end + estimated_days on projects
            p_cols = conn.execute("PRAGMA table_info(projects)").fetchall()
            p_col_names = {r["name"] for r in p_cols}
            p_start_col = next((r for r in p_cols if r["name"] == "expected_start"), None)
            if p_cols and (
                "estimated_days" not in p_col_names
                or (p_start_col is not None and p_start_col["notnull"] == 1)
            ):
                est_expr = "estimated_days" if "estimated_days" in p_col_names else "10"
                conn.executescript(
                    f"""
                    CREATE TABLE projects_v3 (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        description TEXT NOT NULL DEFAULT '',
                        expected_start TEXT,
                        actual_start TEXT,
                        expected_end TEXT,
                        estimated_days INTEGER DEFAULT 10,
                        original_expected_end TEXT,
                        required_by TEXT,
                        actual_end TEXT,
                        percent_complete INTEGER NOT NULL DEFAULT 0,
                        auto_progress INTEGER NOT NULL DEFAULT 1,
                        status TEXT NOT NULL DEFAULT 'planned',
                        priority TEXT NOT NULL DEFAULT 'medium',
                        color TEXT NOT NULL DEFAULT '#3b82f6',
                        notes TEXT NOT NULL DEFAULT '',
                        sort_order INTEGER NOT NULL DEFAULT 0
                    );
                    INSERT INTO projects_v3 (
                        id, name, description, expected_start, actual_start, expected_end,
                        estimated_days, original_expected_end, required_by, actual_end,
                        percent_complete, auto_progress, status, priority, color, notes, sort_order
                    )
                    SELECT
                        id, name, description, expected_start, actual_start, expected_end,
                        {est_expr}, original_expected_end, required_by, actual_end,
                        percent_complete, auto_progress, status, priority, color, notes, sort_order
                    FROM projects;
                    DROP TABLE projects;
                    ALTER TABLE projects_v3 RENAME TO projects;
                    """
                )

            # v3 migration: nullable expected_start/expected_end on tasks
            t_cols = conn.execute("PRAGMA table_info(tasks)").fetchall()
            t_start_col = next((r for r in t_cols if r["name"] == "expected_start"), None)
            if t_cols and t_start_col is not None and t_start_col["notnull"] == 1:
                conn.executescript(
                    """
                    CREATE TABLE tasks_v3 (
                        id TEXT PRIMARY KEY,
                        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                        name TEXT NOT NULL,
                        description TEXT NOT NULL DEFAULT '',
                        expected_start TEXT,
                        actual_start TEXT,
                        expected_end TEXT,
                        original_expected_end TEXT,
                        required_by TEXT,
                        actual_end TEXT,
                        percent_complete INTEGER NOT NULL DEFAULT 0,
                        status TEXT NOT NULL DEFAULT 'planned',
                        priority TEXT NOT NULL DEFAULT 'medium',
                        notes TEXT NOT NULL DEFAULT '',
                        sort_order INTEGER NOT NULL DEFAULT 0
                    );
                    INSERT INTO tasks_v3 SELECT * FROM tasks;
                    DROP TABLE tasks;
                    ALTER TABLE tasks_v3 RENAME TO tasks;
                    """
                )

            # v2 migration: nullable person_id + placeholder_label on assignments
            cols = conn.execute("PRAGMA table_info(assignments)").fetchall()
            col_names = {row["name"] for row in cols}
            person_col = next((row for row in cols if row["name"] == "person_id"), None)
            needs_rebuild = (
                "placeholder_label" not in col_names
                or (person_col is not None and person_col["notnull"] == 1)
            )
            if needs_rebuild and cols:
                has_placeholder = "placeholder_label" in col_names
                select_placeholder = "placeholder_label" if has_placeholder else "NULL"
                conn.executescript(
                    f"""
                    CREATE TABLE assignments_v2 (
                        id TEXT PRIMARY KEY,
                        person_id TEXT REFERENCES people(id) ON DELETE CASCADE,
                        placeholder_label TEXT,
                        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                        task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
                        allocation_pct INTEGER,
                        start_date TEXT,
                        end_date TEXT
                    );
                    INSERT INTO assignments_v2 (
                        id, person_id, placeholder_label, project_id, task_id, allocation_pct, start_date, end_date
                    )
                    SELECT id, person_id, {select_placeholder}, project_id, task_id, allocation_pct, start_date, end_date
                    FROM assignments;
                    DROP TABLE assignments;
                    ALTER TABLE assignments_v2 RENAME TO assignments;
                    """
                )
            conn.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '4')"
            )
            conn.execute(
                "INSERT OR IGNORE INTO meta (key, value) VALUES ('plan_version', '1')"
            )
        conn.execute("PRAGMA foreign_keys=ON;")
    finally:
        conn.close()


def read_plan(db_path: Path | None = None) -> PlanDocument:
    init_db(db_path)
    conn = connect(db_path)
    try:
        people = [
            Person(**dict(row))
            for row in conn.execute(
                "SELECT id, name, sort_order FROM people ORDER BY sort_order ASC, name ASC"
            )
        ]
        projects = [
            Project(
                **{
                    **dict(row),
                    "auto_progress": bool(row["auto_progress"]),
                }
            )
            for row in conn.execute(
                """
                SELECT * FROM projects
                ORDER BY sort_order ASC,
                         CASE WHEN expected_start IS NULL THEN 1 ELSE 0 END ASC,
                         expected_start ASC,
                         name ASC
                """
            )
        ]
        tasks = [
            Task(**dict(row))
            for row in conn.execute(
                """
                SELECT * FROM tasks
                ORDER BY sort_order ASC,
                         CASE WHEN expected_start IS NULL THEN 1 ELSE 0 END ASC,
                         expected_start ASC,
                         name ASC
                """
            )
        ]
        assignments = [
            Assignment(**dict(row))
            for row in conn.execute("SELECT * FROM assignments")
        ]
        unavailabilities = [
            Unavailability(**dict(row))
            for row in conn.execute(
                "SELECT * FROM unavailabilities ORDER BY start_date ASC"
            )
        ]
        dependencies = [
            Dependency(**dict(row))
            for row in conn.execute("SELECT * FROM dependencies")
        ]
        return PlanDocument(
            projects=projects,
            tasks=tasks,
            people=people,
            assignments=assignments,
            unavailabilities=unavailabilities,
            dependencies=dependencies,
        )
    finally:
        conn.close()


def write_plan(plan: PlanDocument, db_path: Path | None = None) -> PlanDocument:
    init_db(db_path)
    conn = connect(db_path)
    try:
        with conn:
            # Clear existing entities respecting FK order
            conn.execute("DELETE FROM dependencies")
            conn.execute("DELETE FROM assignments")
            conn.execute("DELETE FROM unavailabilities")
            conn.execute("DELETE FROM tasks")
            conn.execute("DELETE FROM projects")
            conn.execute("DELETE FROM people")

            conn.executemany(
                "INSERT INTO people (id, name, sort_order) VALUES (?, ?, ?)",
                [(p.id, p.name, p.sort_order) for p in plan.people],
            )
            conn.executemany(
                """
                INSERT INTO projects (
                    id, name, description, expected_start, actual_start, expected_end,
                    estimated_days, original_expected_end, required_by, actual_end,
                    percent_complete, auto_progress, status, priority, color, notes, sort_order
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        p.id,
                        p.name,
                        p.description,
                        p.expected_start,
                        p.actual_start,
                        p.expected_end,
                        p.estimated_days,
                        p.original_expected_end
                        or (p.expected_end if p.expected_end else None),
                        p.required_by,
                        p.actual_end,
                        p.percent_complete,
                        1 if p.auto_progress else 0,
                        p.status,
                        p.priority,
                        p.color,
                        p.notes,
                        p.sort_order,
                    )
                    for p in plan.projects
                ],
            )
            conn.executemany(
                """
                INSERT INTO tasks (
                    id, project_id, name, description, expected_start, actual_start,
                    expected_end, original_expected_end, required_by, actual_end,
                    percent_complete, status, priority, notes, sort_order
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        t.id,
                        t.project_id,
                        t.name,
                        t.description,
                        t.expected_start,
                        t.actual_start,
                        t.expected_end,
                        t.original_expected_end
                        or (t.expected_end if t.expected_end else None),
                        t.required_by,
                        t.actual_end,
                        t.percent_complete,
                        t.status,
                        t.priority,
                        t.notes,
                        t.sort_order,
                    )
                    for t in plan.tasks
                ],
            )
            conn.executemany(
                """
                INSERT INTO assignments (
                    id, person_id, placeholder_label, project_id, task_id, allocation_pct, start_date, end_date
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        a.id,
                        a.person_id,
                        a.placeholder_label,
                        a.project_id,
                        a.task_id,
                        a.allocation_pct,
                        a.start_date,
                        a.end_date,
                    )
                    for a in plan.assignments
                ],
            )
            conn.executemany(
                """
                INSERT INTO unavailabilities (
                    id, person_id, start_date, end_date, reason, allocation_pct
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                [
                    (u.id, u.person_id, u.start_date, u.end_date, u.reason, u.allocation_pct)
                    for u in plan.unavailabilities
                ],
            )
            conn.executemany(
                """
                INSERT INTO dependencies (id, from_type, from_id, to_type, to_id)
                VALUES (?, ?, ?, ?, ?)
                """,
                [
                    (d.id, d.from_type, d.from_id, d.to_type, d.to_id)
                    for d in plan.dependencies
                ],
            )
            ver_row = conn.execute(
                "SELECT value FROM meta WHERE key = 'plan_version'"
            ).fetchone()
            next_ver = (int(ver_row["value"]) + 1) if ver_row else 1
            conn.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('plan_version', ?)",
                (str(next_ver),),
            )
            conn.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('updated_at', ?)",
                (datetime.now(timezone.utc).isoformat(),),
            )
    finally:
        conn.close()
    saved = read_plan(db_path)
    ensure_weekly_auto_checkpoint(saved, db_path=db_path)
    return saved


def is_db_non_empty(db_path: Path | None = None) -> bool:
    init_db(db_path)
    conn = connect(db_path)
    try:
        p_count = conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
        m_count = conn.execute("SELECT COUNT(*) FROM people").fetchone()[0]
        return (p_count + m_count) > 0
    finally:
        conn.close()


MAX_AUTO_WEEKLY_CHECKPOINTS = 12


def get_plan_version(db_path: Path | None = None) -> int:
    init_db(db_path)
    conn = connect(db_path)
    try:
        row = conn.execute("SELECT value FROM meta WHERE key = 'plan_version'").fetchone()
        return int(row["value"]) if row else 1
    finally:
        conn.close()


def ensure_weekly_auto_checkpoint(
    plan: PlanDocument | None = None,
    db_path: Path | None = None,
    ref_dt: datetime | None = None,
) -> CheckpointSummary | None:
    """Automatically captures one rolling weekly baseline checkpoint per ISO week (keeping last 12)."""
    current = plan if plan is not None else read_plan(db_path)
    if len(current.projects) == 0 and len(current.people) == 0:
        return None

    now = ref_dt or datetime.now(timezone.utc)
    iso_yr, iso_wk, iso_dow = now.isocalendar()
    week_key = f"{iso_yr}-W{iso_wk:02d}"
    monday = (now - timedelta(days=iso_dow - 1)).date()

    init_db(db_path)
    conn = connect(db_path)
    try:
        existing = conn.execute(
            "SELECT id FROM checkpoints WHERE kind = 'auto_weekly' AND week_key = ?",
            (week_key,),
        ).fetchone()
        if existing:
            return None

        ver_row = conn.execute("SELECT value FROM meta WHERE key = 'plan_version'").fetchone()
        ver = int(ver_row["value"]) if ver_row else 1
        chk_id = f"chk-wk-{week_key.lower()}-{uuid.uuid4().hex[:6]}"
        label = f"Start of Week — {monday.strftime('%d %b %Y')} (W{iso_wk:02d})"
        note = "Automatic weekly rolling baseline"
        created_at = now.isoformat()

        with conn:
            conn.execute(
                """
                INSERT INTO checkpoints (
                    id, label, note, kind, week_key, created_by, created_at,
                    plan_version, project_count, people_count, plan_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    chk_id,
                    label,
                    note,
                    "auto_weekly",
                    week_key,
                    "System (Auto-Weekly)",
                    created_at,
                    ver,
                    len(current.projects),
                    len(current.people),
                    current.model_dump_json(),
                ),
            )
            # Prune auto_weekly checkpoints older than the newest MAX_AUTO_WEEKLY_CHECKPOINTS
            old_rows = conn.execute(
                """
                SELECT id FROM checkpoints
                WHERE kind = 'auto_weekly'
                ORDER BY created_at DESC
                LIMIT -1 OFFSET ?
                """,
                (MAX_AUTO_WEEKLY_CHECKPOINTS,),
            ).fetchall()
            if old_rows:
                conn.executemany(
                    "DELETE FROM checkpoints WHERE id = ?",
                    [(r["id"],) for r in old_rows],
                )

        return CheckpointSummary(
            id=chk_id,
            label=label,
            note=note,
            kind="auto_weekly",
            week_key=week_key,
            created_by="System (Auto-Weekly)",
            created_at=created_at,
            plan_version=ver,
            project_count=len(current.projects),
            people_count=len(current.people),
        )
    finally:
        conn.close()


def list_checkpoints_db(
    include_plan: bool = False, db_path: Path | None = None
) -> list[CheckpointSummary] | list[CheckpointDetail]:
    init_db(db_path)
    conn = connect(db_path)
    try:
        cols = (
            "*"
            if include_plan
            else "id, label, note, kind, week_key, created_by, created_at, plan_version, project_count, people_count"
        )
        rows = conn.execute(
            f"SELECT {cols} FROM checkpoints ORDER BY created_at DESC"
        ).fetchall()
        if include_plan:
            return [
                CheckpointDetail(
                    id=r["id"],
                    label=r["label"],
                    note=r["note"],
                    kind=r["kind"],
                    week_key=r["week_key"],
                    created_by=r["created_by"],
                    created_at=r["created_at"],
                    plan_version=r["plan_version"],
                    project_count=r["project_count"],
                    people_count=r["people_count"],
                    plan=PlanDocument.model_validate_json(r["plan_json"]),
                )
                for r in rows
            ]
        return [CheckpointSummary(**dict(r)) for r in rows]
    finally:
        conn.close()


def get_checkpoint_db(
    checkpoint_id: str, db_path: Path | None = None
) -> CheckpointDetail | None:
    init_db(db_path)
    conn = connect(db_path)
    try:
        r = conn.execute(
            "SELECT * FROM checkpoints WHERE id = ?", (checkpoint_id,)
        ).fetchone()
        if not r:
            return None
        return CheckpointDetail(
            id=r["id"],
            label=r["label"],
            note=r["note"],
            kind=r["kind"],
            week_key=r["week_key"],
            created_by=r["created_by"],
            created_at=r["created_at"],
            plan_version=r["plan_version"],
            project_count=r["project_count"],
            people_count=r["people_count"],
            plan=PlanDocument.model_validate_json(r["plan_json"]),
        )
    finally:
        conn.close()


def create_checkpoint_db(
    label: str,
    note: str = "",
    kind: CheckpointKind = "manual",
    created_by: str = "Local User",
    plan_override: PlanDocument | None = None,
    created_at_override: str | None = None,
    db_path: Path | None = None,
) -> CheckpointSummary:
    target_plan = plan_override if plan_override is not None else read_plan(db_path)
    ver = get_plan_version(db_path)
    chk_id = f"chk-{uuid.uuid4().hex[:10]}"
    now_iso = created_at_override or datetime.now(timezone.utc).isoformat()

    init_db(db_path)
    conn = connect(db_path)
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO checkpoints (
                    id, label, note, kind, week_key, created_by, created_at,
                    plan_version, project_count, people_count, plan_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    chk_id,
                    label.strip(),
                    note.strip(),
                    kind,
                    None,
                    created_by.strip() or "Local User",
                    now_iso,
                    ver,
                    len(target_plan.projects),
                    len(target_plan.people),
                    target_plan.model_dump_json(),
                ),
            )
    finally:
        conn.close()

    return CheckpointSummary(
        id=chk_id,
        label=label.strip(),
        note=note.strip(),
        kind=kind,
        week_key=None,
        created_by=created_by.strip() or "Local User",
        created_at=now_iso,
        plan_version=ver,
        project_count=len(target_plan.projects),
        people_count=len(target_plan.people),
    )


def update_checkpoint_db(
    checkpoint_id: str,
    label: str | None = None,
    note: str | None = None,
    db_path: Path | None = None,
) -> CheckpointSummary | None:
    init_db(db_path)
    conn = connect(db_path)
    try:
        existing = conn.execute(
            "SELECT * FROM checkpoints WHERE id = ?", (checkpoint_id,)
        ).fetchone()
        if not existing:
            return None
        next_label = label.strip() if label is not None else existing["label"]
        next_note = note.strip() if note is not None else existing["note"]
        with conn:
            conn.execute(
                "UPDATE checkpoints SET label = ?, note = ? WHERE id = ?",
                (next_label, next_note, checkpoint_id),
            )
        updated = conn.execute(
            "SELECT id, label, note, kind, week_key, created_by, created_at, plan_version, project_count, people_count FROM checkpoints WHERE id = ?",
            (checkpoint_id,),
        ).fetchone()
        return CheckpointSummary(**dict(updated))
    finally:
        conn.close()


def delete_checkpoint_db(checkpoint_id: str, db_path: Path | None = None) -> bool:
    init_db(db_path)
    conn = connect(db_path)
    try:
        with conn:
            cur = conn.execute("DELETE FROM checkpoints WHERE id = ?", (checkpoint_id,))
            return cur.rowcount > 0
    finally:
        conn.close()


def import_checkpoints_db(
    checkpoints: list[CheckpointDetail], db_path: Path | None = None
) -> None:
    if not checkpoints:
        return
    init_db(db_path)
    conn = connect(db_path)
    try:
        with conn:
            for c in checkpoints:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO checkpoints (
                        id, label, note, kind, week_key, created_by, created_at,
                        plan_version, project_count, people_count, plan_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        c.id,
                        c.label,
                        c.note,
                        c.kind,
                        c.week_key,
                        c.created_by,
                        c.created_at,
                        c.plan_version,
                        len(c.plan.projects),
                        len(c.plan.people),
                        c.plan.model_dump_json(),
                    ),
                )
    finally:
        conn.close()
