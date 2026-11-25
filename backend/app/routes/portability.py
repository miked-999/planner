"""JSON & CSV export/import routes (DATA-04 through DATA-07)."""

from __future__ import annotations

import csv
import io
import uuid
import zipfile
from datetime import date, datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import ValidationError

from ..db import is_db_non_empty, read_plan, write_plan
from ..schemas import (
    Assignment,
    CsvImportRequest,
    ExportEnvelope,
    Person,
    PlanDocument,
    Project,
)
from .backups import create_snapshot

router = APIRouter(prefix="/api", tags=["portability"])

PALETTE = [
    "#2563eb",
    "#7c3aed",
    "#059669",
    "#d97706",
    "#dc2626",
    "#0891b2",
    "#4f46e5",
    "#db2777",
]


@router.get("/export/json")
def export_json() -> Response:
    plan = read_plan()
    envelope = ExportEnvelope(
        schema_version=1,
        exported_at=datetime.now(timezone.utc).isoformat(),
        plan=plan,
    )
    stamp = datetime.now().strftime("%Y-%m-%d")
    return Response(
        content=envelope.model_dump_json(indent=2),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="project-plan-{stamp}.json"'
        },
    )


@router.post("/import/json", response_model=PlanDocument)
def import_json(payload: dict[str, Any]) -> PlanDocument:
    try:
        raw_plan = payload.get("plan", payload)
        validated = PlanDocument.model_validate(raw_plan)
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid plan JSON: {exc}") from exc

    if is_db_non_empty():
        create_snapshot("Auto pre-JSON-import")
    return write_plan(validated)


def _write_csv_string(headers: list[str], rows: list[list[Any]]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    writer.writerows(rows)
    return buf.getvalue()


def _build_csv_files(plan: PlanDocument) -> dict[str, str]:
    person_names = {p.id: p.name for p in plan.people}
    proj_people: dict[str, list[str]] = {p.id: [] for p in plan.projects}
    for a in plan.assignments:
        pname = person_names.get(a.person_id, a.person_id)
        label = f"{pname} ({a.allocation_pct}%)" if a.allocation_pct is not None else pname
        if a.project_id in proj_people and label not in proj_people[a.project_id]:
            proj_people[a.project_id].append(label)

    projects_csv = _write_csv_string(
        [
            "id",
            "name",
            "status",
            "priority",
            "expected_start",
            "actual_start",
            "expected_end",
            "original_expected_end",
            "required_by",
            "actual_end",
            "percent_complete",
            "auto_progress",
            "assigned_people",
            "color",
            "description",
            "notes",
        ],
        [
            [
                p.id,
                p.name,
                p.status,
                p.priority,
                p.expected_start,
                p.actual_start or "",
                p.expected_end,
                p.original_expected_end or "",
                p.required_by or "",
                p.actual_end or "",
                p.percent_complete,
                p.auto_progress,
                "; ".join(proj_people.get(p.id, [])),
                p.color,
                p.description,
                p.notes,
            ]
            for p in plan.projects
        ],
    )

    proj_names = {p.id: p.name for p in plan.projects}
    tasks_csv = _write_csv_string(
        [
            "id",
            "project_id",
            "project_name",
            "name",
            "status",
            "priority",
            "expected_start",
            "actual_start",
            "expected_end",
            "original_expected_end",
            "required_by",
            "actual_end",
            "percent_complete",
            "description",
            "notes",
        ],
        [
            [
                t.id,
                t.project_id,
                proj_names.get(t.project_id, ""),
                t.name,
                t.status,
                t.priority,
                t.expected_start,
                t.actual_start or "",
                t.expected_end,
                t.original_expected_end or "",
                t.required_by or "",
                t.actual_end or "",
                t.percent_complete,
                t.description,
                t.notes,
            ]
            for t in plan.tasks
        ],
    )

    people_csv = _write_csv_string(
        ["id", "name", "sort_order"],
        [[p.id, p.name, p.sort_order] for p in plan.people],
    )

    task_names = {t.id: t.name for t in plan.tasks}
    assignments_csv = _write_csv_string(
        [
            "id",
            "person_id",
            "person_name",
            "project_id",
            "project_name",
            "task_id",
            "task_name",
            "allocation_pct",
            "start_date",
            "end_date",
        ],
        [
            [
                a.id,
                a.person_id,
                person_names.get(a.person_id, ""),
                a.project_id,
                proj_names.get(a.project_id, ""),
                a.task_id or "",
                task_names.get(a.task_id, "") if a.task_id else "",
                "" if a.allocation_pct is None else a.allocation_pct,
                a.start_date or "",
                a.end_date or "",
            ]
            for a in plan.assignments
        ],
    )

    unavailabilities_csv = _write_csv_string(
        ["id", "person_id", "person_name", "start_date", "end_date", "reason", "allocation_pct"],
        [
            [
                u.id,
                u.person_id,
                person_names.get(u.person_id, ""),
                u.start_date,
                u.end_date,
                u.reason,
                u.allocation_pct,
            ]
            for u in plan.unavailabilities
        ],
    )

    dependencies_csv = _write_csv_string(
        ["id", "from_type", "from_id", "to_type", "to_id"],
        [[d.id, d.from_type, d.from_id, d.to_type, d.to_id] for d in plan.dependencies],
    )

    return {
        "projects.csv": projects_csv,
        "tasks.csv": tasks_csv,
        "people.csv": people_csv,
        "assignments.csv": assignments_csv,
        "unavailabilities.csv": unavailabilities_csv,
        "dependencies.csv": dependencies_csv,
    }


@router.get("/export/csv")
def export_csv_zip() -> Response:
    plan = read_plan()
    csv_files = _build_csv_files(plan)
    mem = io.BytesIO()
    with zipfile.ZipFile(mem, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for fname, content in csv_files.items():
            zf.writestr(fname, content)
    stamp = datetime.now().strftime("%Y-%m-%d")
    return Response(
        content=mem.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="project-plan-csv-{stamp}.zip"'
        },
    )


@router.get("/export/csv/{entity}")
def export_single_csv(entity: str) -> Response:
    plan = read_plan()
    csv_files = _build_csv_files(plan)
    key = f"{entity}.csv" if not entity.endswith(".csv") else entity
    if key not in csv_files:
        raise HTTPException(status_code=404, detail=f"Unknown CSV export entity: {entity}")
    stamp = datetime.now().strftime("%Y-%m-%d")
    return Response(
        content=csv_files[key],
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{entity}-{stamp}.csv"'},
    )


def _norm_header(h: str) -> str:
    return h.strip().lower().replace("-", "_").replace(" ", "_")


def _parse_flexible_date(raw: str | None) -> str | None:
    if not raw or not raw.strip():
        return None
    txt = raw.strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(txt, fmt).date().isoformat()
        except ValueError:
            continue
    raise ValueError(f"Unrecognised date format {txt!r}; use YYYY-MM-DD")


@router.post("/import/csv/projects")
def import_projects_csv(req: CsvImportRequest) -> dict[str, Any]:
    if not req.csv_text.strip():
        raise HTTPException(status_code=422, detail="CSV content is empty")

    reader = csv.DictReader(io.StringIO(req.csv_text.lstrip("\ufeff")))
    if not reader.fieldnames:
        raise HTTPException(status_code=422, detail="CSV header row is missing")

    current = PlanDocument() if req.mode == "replace" else read_plan()
    people_by_lower = {p.name.lower(): p for p in current.people}
    projects_by_id = {p.id: p for p in current.projects}
    new_assignments: list[Assignment] = list(current.assignments)

    imported_count = 0
    created_people: list[str] = []

    for idx, raw_row in enumerate(reader, start=2):
        row = {_norm_header(k): (v or "").strip() for k, v in raw_row.items() if k}
        name = row.get("name") or row.get("project") or row.get("project_name")
        if not name:
            continue

        try:
            start_str = (
                _parse_flexible_date(
                    row.get("expected_start") or row.get("start") or row.get("start_date")
                )
                or date.today().isoformat()
            )
            end_str = (
                _parse_flexible_date(
                    row.get("expected_end") or row.get("end") or row.get("end_date")
                )
                or start_str
            )
            req_by = _parse_flexible_date(
                row.get("required_by") or row.get("deadline") or row.get("due_date")
            )
            act_start = _parse_flexible_date(row.get("actual_start"))
            act_end = _parse_flexible_date(row.get("actual_end"))
            orig_end = (
                _parse_flexible_date(row.get("original_expected_end")) or end_str
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"Row {idx}: {exc}") from exc

        status_raw = (row.get("status") or "planned").lower().replace(" ", "_")
        status = (
            status_raw
            if status_raw in {"planned", "in_progress", "on_hold", "completed"}
            else "planned"
        )

        priority_raw = (row.get("priority") or "medium").lower()
        priority = priority_raw if priority_raw in {"low", "medium", "high"} else "medium"

        pct_raw = (
            row.get("percent_complete")
            or row.get("complete")
            or row.get("progress")
            or "0"
        ).rstrip("%")
        try:
            pct = max(0, min(100, int(float(pct_raw))))
        except ValueError:
            pct = 0

        pid = row.get("id") or f"proj-{uuid.uuid4().hex[:8]}"
        color = (
            row.get("color")
            or row.get("colour")
            or PALETTE[(len(projects_by_id) + idx) % len(PALETTE)]
        )

        try:
            proj = Project(
                id=pid,
                name=name,
                description=row.get("description", ""),
                expected_start=start_str,
                actual_start=act_start,
                expected_end=end_str,
                original_expected_end=orig_end,
                required_by=req_by,
                actual_end=act_end,
                percent_complete=pct,
                auto_progress=False,
                status=status,  # type: ignore[arg-type]
                priority=priority,  # type: ignore[arg-type]
                color=color,
                notes=row.get("notes", ""),
                sort_order=len(projects_by_id),
            )
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=f"Row {idx}: {exc}") from exc

        projects_by_id[pid] = proj
        imported_count += 1

        people_cell = (
            row.get("assigned_people") or row.get("people") or row.get("assignees") or ""
        )
        if people_cell:
            # Remove prior project-level assignments if updating same project id
            new_assignments = [
                a for a in new_assignments if not (a.project_id == pid and a.task_id is None)
            ]
            tokens = [
                tok.strip()
                for tok in people_cell.replace(";", ",").split(",")
                if tok.strip()
            ]
            for tok in tokens:
                alloc: int | None = None
                person_label = tok
                if "(" in tok and tok.endswith(")"):
                    base, paren = tok.rsplit("(", 1)
                    person_label = base.strip()
                    num_txt = paren[:-1].rstrip("%").strip()
                    if num_txt.isdigit():
                        alloc = max(1, min(200, int(num_txt)))
                if not person_label:
                    continue
                person = people_by_lower.get(person_label.lower())
                if not person:
                    person = Person(
                        id=f"person-{uuid.uuid4().hex[:8]}",
                        name=person_label,
                        sort_order=len(people_by_lower),
                    )
                    people_by_lower[person.name.lower()] = person
                    created_people.append(person.name)
                new_assignments.append(
                    Assignment(
                        id=f"asg-{uuid.uuid4().hex[:8]}",
                        person_id=person.id,
                        project_id=pid,
                        task_id=None,
                        allocation_pct=alloc,
                    )
                )

    if imported_count == 0:
        raise HTTPException(status_code=422, detail="No valid project rows found in CSV")

    updated_plan = PlanDocument(
        projects=list(projects_by_id.values()),
        tasks=current.tasks,
        people=list(people_by_lower.values()),
        assignments=new_assignments,
        unavailabilities=current.unavailabilities,
        dependencies=current.dependencies,
    )

    if is_db_non_empty():
        create_snapshot("Auto pre-CSV-import")
    saved = write_plan(updated_plan)
    return {
        "imported_count": imported_count,
        "created_people": created_people,
        "plan": saved,
    }
