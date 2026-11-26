"""Comprehensive API tests for SQLite persistence, DEP-07 validation, CSV/JSON portability, and backups."""

from __future__ import annotations

import io
import sqlite3
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    db_file = tmp_path / "test_planner.db"
    backup_dir = tmp_path / "backups"
    monkeypatch.setenv("PLANNER_DB_PATH", str(db_file))
    monkeypatch.setenv("PLANNER_BACKUP_DIR", str(backup_dir))
    with TestClient(app) as c:
        yield c


def test_empty_and_seed_plan(client: TestClient) -> None:
    res = client.get("/api/plan")
    assert res.status_code == 200
    assert res.json()["projects"] == []

    seed_res = client.post("/api/plan/seed")
    assert seed_res.status_code == 200
    seeded = seed_res.json()
    assert len(seeded["projects"]) == 7
    backlog = [p for p in seeded["projects"] if p["status"] == "backlog"]
    assert len(backlog) == 2
    assert backlog[0]["expected_start"] is None
    assert len(seeded["people"]) == 5
    assert len(seeded["tasks"]) == 6
    assert len(seeded["dependencies"]) == 6


def test_circular_dependency_rejected(client: TestClient) -> None:
    seed = client.post("/api/plan/seed").json()
    # Add cycle: proj-b -> proj-a (since proj-a -> proj-b already exists)
    seed["dependencies"].append(
        {
            "id": "dep-cycle",
            "from_type": "project",
            "from_id": "proj-b",
            "to_type": "project",
            "to_id": "proj-a",
        }
    )
    bad = client.put("/api/plan", json=seed)
    assert bad.status_code == 422
    assert "Circular dependency" in bad.text

    # Also test structural cycle: task-a4 -> proj-b already implicit via proj-a -> proj-b;
    # test proj-b -> task-a1!
    seed["dependencies"][-1] = {
        "id": "dep-struct-cycle",
        "from_type": "project",
        "from_id": "proj-b",
        "to_type": "task",
        "to_id": "task-a1",
    }
    bad2 = client.put("/api/plan", json=seed)
    assert bad2.status_code == 422
    assert "Circular dependency" in bad2.text


def test_json_export_and_import_roundtrip(client: TestClient) -> None:
    seeded = client.post("/api/plan/seed").json()
    exp = client.get("/api/export/json")
    assert exp.status_code == 200
    envelope = exp.json()
    assert envelope["schema_version"] == 2
    assert len(envelope["plan"]["projects"]) == len(seeded["projects"])
    assert len(envelope["checkpoints"]) >= 1

    client.post("/api/plan/clear")
    assert client.get("/api/plan").json()["projects"] == []

    imp = client.post("/api/import/json", json=envelope)
    assert imp.status_code == 200
    restored = imp.json()
    assert len(restored["projects"]) == 7
    assert len(restored["assignments"]) == len(seeded["assignments"])


def test_backwards_compatible_v1_json_import(client: TestClient) -> None:
    """Ensure legacy schema_version=1 JSON files (without checkpoints, estimated_days, or placeholder_label) import cleanly."""
    legacy_v1_envelope = {
        "schema_version": 1,
        "exported_at": "2026-11-25T10:00:00Z",
        "plan": {
            "people": [{"id": "p-1", "name": "Alice Morgan", "sort_order": 0}],
            "projects": [
                {
                    "id": "proj-legacy",
                    "name": "Legacy v1 Project",
                    "description": "Exported from initial v0.2 release",
                    "expected_start": "2026-12-07",
                    "actual_start": None,
                    "expected_end": "2026-12-18",
                    "original_expected_end": "2026-12-18",
                    "required_by": "2026-12-25",
                    "actual_end": None,
                    "percent_complete": 40,
                    "status": "in_progress",
                    "priority": "high",
                    "color": "#2563eb",
                    "notes": "No estimated_days or auto_progress key",
                    "sort_order": 0,
                }
            ],
            "tasks": [],
            "assignments": [
                {
                    "id": "asg-legacy",
                    "person_id": "p-1",
                    "project_id": "proj-legacy",
                    "task_id": None,
                    "allocation_pct": 75,
                    "start_date": None,
                    "end_date": None,
                }
            ],
            "unavailabilities": [],
            "dependencies": [],
        },
    }

    res = client.post("/api/import/json", json=legacy_v1_envelope)
    assert res.status_code == 200
    imported = res.json()
    assert len(imported["projects"]) == 1
    assert imported["projects"][0]["name"] == "Legacy v1 Project"
    assert imported["projects"][0]["estimated_days"] == 10
    assert imported["assignments"][0]["allocation_pct"] == 75


def test_csv_export_zip_and_project_import(client: TestClient) -> None:
    client.post("/api/plan/seed")
    zip_res = client.get("/api/export/csv")
    assert zip_res.status_code == 200
    with zipfile.ZipFile(io.BytesIO(zip_res.content)) as zf:
        names = set(zf.namelist())
        assert {
            "projects.csv",
            "tasks.csv",
            "people.csv",
            "assignments.csv",
            "unavailabilities.csv",
            "dependencies.csv",
        }.issubset(names)

    single_res = client.get("/api/export/csv/projects")
    assert single_res.status_code == 200
    assert "Project Alpha" in single_res.text

    csv_payload = (
        "Name,Expected Start,Expected End,Required By,Status,Priority,Complete,Assigned People\n"
        "Imported Initiative,2026-12-07,2026-12-18,2026-12-25,In Progress,High,25%,Alice Morgan (50%); New Person\n"
    )
    imp = client.post(
        "/api/import/csv/projects",
        json={"csv_text": csv_payload, "mode": "merge"},
    )
    assert imp.status_code == 200
    body = imp.json()
    assert body["imported_count"] == 1
    assert body["created_people"] == ["New Person"]
    proj_names = [p["name"] for p in body["plan"]["projects"]]
    assert "Imported Initiative" in proj_names


def test_backups_create_list_restore_delete(client: TestClient) -> None:
    client.post("/api/plan/seed")
    snap_res = client.post("/api/backups", json={"label": "Before big change"})
    assert snap_res.status_code == 200
    snap = snap_res.json()
    assert snap["project_count"] == 7

    # Clear live DB
    client.post("/api/plan/clear")
    assert client.get("/api/plan").json()["projects"] == []

    # Restore from snapshot
    restore_res = client.post(f"/api/backups/{snap['filename']}/restore")
    assert restore_res.status_code == 200
    assert len(restore_res.json()["projects"]) == 7

    # List and delete
    backups = client.get("/api/backups").json()
    assert any(b["filename"] == snap["filename"] for b in backups)
    del_res = client.delete(f"/api/backups/{snap['filename']}")
    assert del_res.status_code == 200


def test_spa_static_serving_and_health(client: TestClient) -> None:
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    index_res = client.get("/")
    assert index_res.status_code == 200
    assert "Project &amp; Resource Planner" in index_res.text


def test_tbd_placeholder_assignments_and_v1_migration(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Simulate a legacy v1 database where assignments.person_id was NOT NULL and placeholder_label did not exist
    legacy_db = tmp_path / "legacy_v1.db"
    conn = sqlite3.connect(str(legacy_db))
    conn.executescript(
        """
        CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE projects (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
            expected_start TEXT NOT NULL, actual_start TEXT, expected_end TEXT NOT NULL,
            original_expected_end TEXT, required_by TEXT, actual_end TEXT,
            percent_complete INTEGER NOT NULL DEFAULT 0, auto_progress INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'planned', priority TEXT NOT NULL DEFAULT 'medium',
            color TEXT NOT NULL DEFAULT '#3b82f6', notes TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE assignments (
            id TEXT PRIMARY KEY,
            person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            task_id TEXT,
            allocation_pct INTEGER,
            start_date TEXT,
            end_date TEXT
        );
        INSERT INTO people VALUES ('p1', 'Legacy User', 0);
        INSERT INTO projects (id, name, expected_start, expected_end) VALUES ('pr1', 'Legacy Proj', '2026-12-01', '2026-12-11');
        INSERT INTO assignments (id, person_id, project_id, allocation_pct) VALUES ('a1', 'p1', 'pr1', 100);
        """
    )
    conn.commit()
    conn.close()

    monkeypatch.setenv("PLANNER_DB_PATH", str(legacy_db))
    monkeypatch.setenv("PLANNER_BACKUP_DIR", str(tmp_path / "backups"))

    with TestClient(app) as c:
        migrated = c.get("/api/plan").json()
        assert len(migrated["assignments"]) == 1
        assert migrated["assignments"][0]["person_id"] == "p1"

        # Now add an unassigned TBD slot and save
        migrated["assignments"].append(
            {
                "id": "a-tbd",
                "person_id": None,
                "placeholder_label": "TBD — Lead Reviewer",
                "project_id": "pr1",
                "task_id": None,
                "allocation_pct": 50,
                "start_date": None,
                "end_date": None,
            }
        )
        put_res = c.put("/api/plan", json=migrated)
        assert put_res.status_code == 200
        saved_tbd = [a for a in put_res.json()["assignments"] if a["id"] == "a-tbd"][0]
        assert saved_tbd["person_id"] is None
        assert saved_tbd["placeholder_label"] == "TBD — Lead Reviewer"

        # Also verify CSV import recognises TBD tokens AND dateless backlog rows
        csv_text = (
            "Name,Expected Start,Expected End,Estimated Days,Assigned People\n"
            "Future Initiative,2027-01-05,2027-01-22,14,TBD: Data Engineer (75%)\n"
            "Unscheduled Idea,,,15,\n"
        )
        imp = c.post("/api/import/csv/projects", json={"csv_text": csv_text, "mode": "merge"})
        assert imp.status_code == 200
        body = imp.json()
        assert body["imported_count"] == 2
        assert body["created_people"] == []
        backlog_proj = [p for p in body["plan"]["projects"] if p["name"] == "Unscheduled Idea"][0]
        assert backlog_proj["status"] == "backlog"
        assert backlog_proj["expected_start"] is None
        assert backlog_proj["expected_end"] is None
        assert backlog_proj["estimated_days"] == 15
        assert any(
            a["person_id"] is None and "Data Engineer" in (a["placeholder_label"] or "")
            for a in body["plan"]["assignments"]
        )


def test_checkpoints_manual_auto_weekly_and_restore(client: TestClient) -> None:
    seeded = client.post("/api/plan/seed").json()
    assert len(seeded["projects"]) == 7

    # Seed creates both the Q4 Kickoff Baseline AND the current week's auto_weekly checkpoint
    chk_list = client.get("/api/checkpoints").json()
    kinds = {c["kind"] for c in chk_list}
    assert "auto_weekly" in kinds
    assert "manual" in kinds

    # Create a custom milestone checkpoint with a Why-note
    create_res = client.post(
        "/api/checkpoints",
        json={
            "label": "Steering Sign-off",
            "note": "Approved +1w extension on Alpha after resilience review",
            "kind": "manual",
        },
    )
    assert create_res.status_code == 200
    created = create_res.json()
    assert created["label"] == "Steering Sign-off"
    assert "resilience review" in created["note"]

    # Update note via PATCH
    patch_res = client.patch(
        f"/api/checkpoints/{created['id']}",
        json={"note": "Updated steering note"},
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["note"] == "Updated steering note"

    # Fetch full detail (including embedded plan)
    detail_res = client.get(f"/api/checkpoints/{created['id']}")
    assert detail_res.status_code == 200
    assert len(detail_res.json()["plan"]["projects"]) == 7

    # Clear live plan and restore from checkpoint
    client.post("/api/plan/clear")
    assert client.get("/api/plan").json()["projects"] == []

    restored = client.post(f"/api/checkpoints/{created['id']}/restore")
    assert restored.status_code == 200
    assert len(restored.json()["projects"]) == 7

    # Delete checkpoint
    del_res = client.delete(f"/api/checkpoints/{created['id']}")
    assert del_res.status_code == 200



