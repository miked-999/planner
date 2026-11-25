"""SQLite hot-backup and restore routes (DATA-09)."""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..db import connect, get_backup_dir, get_db_path, init_db, read_plan
from ..schemas import BackupCreateRequest, BackupInfo, PlanDocument

router = APIRouter(prefix="/api/backups", tags=["backups"])

SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def _slugify(label: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", label.strip().lower()).strip("-")
    return slug[:36] or "snapshot"


def create_snapshot(label: str = "Backup") -> BackupInfo:
    init_db()
    src_path = get_db_path()
    backup_dir = get_backup_dir()
    now = datetime.now(timezone.utc)
    ts = now.strftime("%Y%m%d-%H%M%S-%f")
    filename = f"planner-{ts}-{_slugify(label)}.db"
    dest_path = backup_dir / filename

    src_conn = sqlite3.connect(str(src_path))
    dest_conn = sqlite3.connect(str(dest_path))
    try:
        with dest_conn:
            src_conn.backup(dest_conn)
        with dest_conn:
            dest_conn.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('backup_meta', ?)",
                (json.dumps({"label": label, "created_at": now.isoformat()}),),
            )
    finally:
        dest_conn.close()
        src_conn.close()

    return _inspect_backup(dest_path)


def _inspect_backup(path: Path) -> BackupInfo:
    stat = path.stat()
    label = "Snapshot"
    created_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
    project_count = 0
    people_count = 0
    conn = connect(path)
    try:
        row = conn.execute("SELECT value FROM meta WHERE key = 'backup_meta'").fetchone()
        if row:
            meta = json.loads(row["value"])
            label = meta.get("label", label)
            created_at = meta.get("created_at", created_at)
        project_count = conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
        people_count = conn.execute("SELECT COUNT(*) FROM people").fetchone()[0]
    except sqlite3.Error:
        pass
    finally:
        conn.close()

    return BackupInfo(
        filename=path.name,
        label=label,
        created_at=created_at,
        size_bytes=stat.st_size,
        project_count=project_count,
        people_count=people_count,
    )


def _resolve_backup_path(filename: str) -> Path:
    if not SAFE_NAME_RE.match(filename) or not filename.endswith(".db"):
        raise HTTPException(status_code=400, detail="Invalid backup filename")
    path = (get_backup_dir() / filename).resolve()
    if path.parent != get_backup_dir().resolve() or not path.exists():
        raise HTTPException(status_code=404, detail="Backup file not found")
    return path


@router.get("", response_model=list[BackupInfo])
def list_backups() -> list[BackupInfo]:
    backup_dir = get_backup_dir()
    files = sorted(backup_dir.glob("*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
    return [_inspect_backup(f) for f in files]


@router.post("", response_model=BackupInfo)
def create_backup_endpoint(req: BackupCreateRequest) -> BackupInfo:
    return create_snapshot(req.label)


@router.post("/{filename}/restore", response_model=PlanDocument)
def restore_backup(filename: str) -> PlanDocument:
    src_backup = _resolve_backup_path(filename)
    init_db()
    live_path = get_db_path()

    src_conn = sqlite3.connect(str(src_backup))
    dest_conn = sqlite3.connect(str(live_path))
    try:
        with dest_conn:
            src_conn.backup(dest_conn)
    finally:
        dest_conn.close()
        src_conn.close()

    return read_plan()


@router.delete("/{filename}")
def delete_backup(filename: str) -> dict[str, str]:
    target = _resolve_backup_path(filename)
    target.unlink()
    return {"status": "deleted", "filename": filename}
