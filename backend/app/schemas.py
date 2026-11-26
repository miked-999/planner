"""Pydantic models and validation for the Project & Resource Planner."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator

ProjectStatus = Literal["backlog", "planned", "in_progress", "on_hold", "completed"]
PriorityLevel = Literal["low", "medium", "high"]
EntityType = Literal["project", "task"]
CheckpointKind = Literal["manual", "auto_weekly", "what_if"]


def _parse_iso_date(val: str, field_name: str) -> date:
    try:
        return date.fromisoformat(val)
    except ValueError as exc:
        raise ValueError(f"{field_name} must be a valid YYYY-MM-DD date, got {val!r}") from exc


class Person(BaseModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=120)
    sort_order: int = 0


class Unavailability(BaseModel):
    id: str = Field(min_length=1)
    person_id: str = Field(min_length=1)
    start_date: str
    end_date: str
    reason: str = Field(default="Annual Leave", max_length=200)
    allocation_pct: int = Field(default=100, ge=1, le=100)

    @model_validator(mode="after")
    def validate_dates(self) -> Unavailability:
        s = _parse_iso_date(self.start_date, "start_date")
        e = _parse_iso_date(self.end_date, "end_date")
        if e < s:
            raise ValueError("Unavailability end_date cannot be before start_date")
        return self


class Project(BaseModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    expected_start: str | None = None
    actual_start: str | None = None
    expected_end: str | None = None
    estimated_days: int | None = Field(default=10, ge=1, le=500)
    original_expected_end: str | None = None
    required_by: str | None = None
    actual_end: str | None = None
    percent_complete: int = Field(default=0, ge=0, le=100)
    auto_progress: bool = True
    status: ProjectStatus = "planned"
    priority: PriorityLevel = "medium"
    color: str = Field(default="#3b82f6", min_length=4, max_length=32)
    notes: str = ""
    sort_order: int = 0

    @model_validator(mode="after")
    def validate_dates(self) -> Project:
        if self.expected_start == "":
            self.expected_start = None
        if self.expected_end == "":
            self.expected_end = None

        if (self.expected_start is None) != (self.expected_end is None):
            raise ValueError(
                f"Project {self.name!r}: expected_start and expected_end must both be set or both be null (unscheduled)"
            )
        if self.expected_start and self.expected_end:
            s = _parse_iso_date(self.expected_start, "expected_start")
            e = _parse_iso_date(self.expected_end, "expected_end")
            if e < s:
                raise ValueError(
                    f"Project {self.name!r}: expected_end cannot be before expected_start"
                )
            if self.original_expected_end:
                _parse_iso_date(self.original_expected_end, "original_expected_end")
            else:
                self.original_expected_end = self.expected_end
        else:
            if self.original_expected_end:
                _parse_iso_date(self.original_expected_end, "original_expected_end")

        if self.actual_start:
            _parse_iso_date(self.actual_start, "actual_start")
        if self.actual_end:
            _parse_iso_date(self.actual_end, "actual_end")
        if self.required_by:
            _parse_iso_date(self.required_by, "required_by")
        return self


class Task(BaseModel):
    id: str = Field(min_length=1)
    project_id: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    expected_start: str | None = None
    actual_start: str | None = None
    expected_end: str | None = None
    original_expected_end: str | None = None
    required_by: str | None = None
    actual_end: str | None = None
    percent_complete: int = Field(default=0, ge=0, le=100)
    status: ProjectStatus = "planned"
    priority: PriorityLevel = "medium"
    notes: str = ""
    sort_order: int = 0

    @model_validator(mode="after")
    def validate_dates(self) -> Task:
        if self.expected_start == "":
            self.expected_start = None
        if self.expected_end == "":
            self.expected_end = None

        if (self.expected_start is None) != (self.expected_end is None):
            raise ValueError(
                f"Task {self.name!r}: expected_start and expected_end must both be set or both be null"
            )
        if self.expected_start and self.expected_end:
            s = _parse_iso_date(self.expected_start, "expected_start")
            e = _parse_iso_date(self.expected_end, "expected_end")
            if e < s:
                raise ValueError(
                    f"Task {self.name!r}: expected_end cannot be before expected_start"
                )
            if self.original_expected_end:
                _parse_iso_date(self.original_expected_end, "original_expected_end")
            else:
                self.original_expected_end = self.expected_end
        else:
            if self.original_expected_end:
                _parse_iso_date(self.original_expected_end, "original_expected_end")

        if self.actual_start:
            _parse_iso_date(self.actual_start, "actual_start")
        if self.actual_end:
            _parse_iso_date(self.actual_end, "actual_end")
        if self.required_by:
            _parse_iso_date(self.required_by, "required_by")
        return self


class Assignment(BaseModel):
    id: str = Field(min_length=1)
    person_id: str | None = None
    placeholder_label: str | None = Field(default=None, max_length=120)
    project_id: str = Field(min_length=1)
    task_id: str | None = None
    allocation_pct: int | None = Field(default=None, ge=1, le=200)
    start_date: str | None = None
    end_date: str | None = None

    @model_validator(mode="after")
    def validate_dates_and_assignee(self) -> Assignment:
        if self.placeholder_label is not None:
            self.placeholder_label = self.placeholder_label.strip() or None
        if not self.person_id and not self.placeholder_label:
            raise ValueError(
                "Assignment must specify either person_id or placeholder_label (TBD)"
            )
        if self.person_id:
            self.placeholder_label = None
        s = _parse_iso_date(self.start_date, "start_date") if self.start_date else None
        e = _parse_iso_date(self.end_date, "end_date") if self.end_date else None
        if s and e and e < s:
            raise ValueError("Assignment end_date cannot be before start_date")
        return self


class Dependency(BaseModel):
    id: str = Field(min_length=1)
    from_type: EntityType
    from_id: str = Field(min_length=1)
    to_type: EntityType
    to_id: str = Field(min_length=1)

    @model_validator(mode="after")
    def check_not_self(self) -> Dependency:
        if self.from_type == self.to_type and self.from_id == self.to_id:
            raise ValueError("An item cannot depend on itself")
        return self


class PlanDocument(BaseModel):
    projects: list[Project] = Field(default_factory=list)
    tasks: list[Task] = Field(default_factory=list)
    people: list[Person] = Field(default_factory=list)
    assignments: list[Assignment] = Field(default_factory=list)
    unavailabilities: list[Unavailability] = Field(default_factory=list)
    dependencies: list[Dependency] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_graph_and_refs(self) -> PlanDocument:
        project_ids = {p.id for p in self.projects}
        task_to_project = {t.id: t.project_id for t in self.tasks}
        person_ids = {p.id for p in self.people}

        for t in self.tasks:
            if t.project_id not in project_ids:
                raise ValueError(f"Task {t.id} references unknown project {t.project_id}")

        for a in self.assignments:
            if a.person_id is not None and a.person_id not in person_ids:
                raise ValueError(f"Assignment {a.id} references unknown person {a.person_id}")
            if a.project_id not in project_ids:
                raise ValueError(f"Assignment {a.id} references unknown project {a.project_id}")
            if a.task_id is not None:
                if a.task_id not in task_to_project:
                    raise ValueError(f"Assignment {a.id} references unknown task {a.task_id}")
                if task_to_project[a.task_id] != a.project_id:
                    raise ValueError(
                        f"Assignment {a.id} task {a.task_id} does not belong to project {a.project_id}"
                    )

        for u in self.unavailabilities:
            if u.person_id not in person_ids:
                raise ValueError(f"Unavailability {u.id} references unknown person {u.person_id}")

        def node_exists(ntype: EntityType, nid: str) -> bool:
            return nid in project_ids if ntype == "project" else nid in task_to_project

        # Build dependency graph including implicit containment edges to detect structural cycles:
        # - If Project P precedes X, then every Task T of P must finish before P finishes -> T -> P -> X
        # - If X precedes Project P, then X precedes P's start -> X -> P -> every Task T of P?
        # Wait: careful! If Task T1 -> Task T2 inside Project P, adding both T->P and P->T simultaneously
        # would create an artificial cycle T1 -> P -> T1!
        # Instead, expand project-level dependencies onto leaf/effective nodes for cycle checking:
        # Each project P without tasks is an atomic node ("project", P).
        # Each project P WITH tasks spans [min(tasks), max(tasks)]:
        #   - An edge ("project", P) -> Y means ALL tasks of P must finish before Y starts.
        #   - An edge X -> ("project", P) means X must finish before P (and its tasks) start.
        #   - Direct edge between ("project", P) and one of its own tasks ("task", T_of_P) is invalid!
        tasks_by_project: dict[str, list[str]] = {pid: [] for pid in project_ids}
        for t in self.tasks:
            tasks_by_project[t.project_id].append(t.id)

        adj: dict[tuple[str, str], set[tuple[str, str]]] = {}

        def add_edge(u: tuple[str, str], v: tuple[str, str]) -> None:
            adj.setdefault(u, set()).add(v)
            adj.setdefault(v, set())

        seen_pairs: set[tuple[str, str, str, str]] = set()
        for dep in self.dependencies:
            if not node_exists(dep.from_type, dep.from_id):
                raise ValueError(f"Dependency {dep.id} references unknown source {dep.from_type}:{dep.from_id}")
            if not node_exists(dep.to_type, dep.to_id):
                raise ValueError(f"Dependency {dep.id} references unknown target {dep.to_type}:{dep.to_id}")

            # Disallow linking a project directly to one of its own child tasks
            if dep.from_type == "project" and dep.to_type == "task":
                if task_to_project[dep.to_id] == dep.from_id:
                    raise ValueError("Cannot create a dependency between a project and its own task")
            if dep.from_type == "task" and dep.to_type == "project":
                if task_to_project[dep.from_id] == dep.to_id:
                    raise ValueError("Cannot create a dependency between a task and its own parent project")

            pair_key = (dep.from_type, dep.from_id, dep.to_type, dep.to_id)
            if pair_key in seen_pairs:
                continue
            seen_pairs.add(pair_key)

            sources: list[tuple[str, str]] = (
                [("task", tid) for tid in tasks_by_project[dep.from_id]]
                if dep.from_type == "project" and tasks_by_project[dep.from_id]
                else [(dep.from_type, dep.from_id)]
            )
            targets: list[tuple[str, str]] = (
                [("task", tid) for tid in tasks_by_project[dep.to_id]]
                if dep.to_type == "project" and tasks_by_project[dep.to_id]
                else [(dep.to_type, dep.to_id)]
            )
            for src in sources:
                for tgt in targets:
                    if src == tgt:
                        raise ValueError("Circular dependency detected")
                    add_edge(src, tgt)

        # Standard 3-color DFS cycle check (DEP-07)
        state: dict[tuple[str, str], int] = {}  # 0=unvisited, 1=visiting, 2=visited

        def has_cycle(node: tuple[str, str]) -> bool:
            state[node] = 1
            for nxt in adj.get(node, ()):
                nxt_state = state.get(nxt, 0)
                if nxt_state == 1:
                    return True
                if nxt_state == 0 and has_cycle(nxt):
                    return True
            state[node] = 2
            return False

        for node in list(adj.keys()):
            if state.get(node, 0) == 0:
                if has_cycle(node):
                    raise ValueError("Circular dependency detected (DEP-07)")

        return self


class CheckpointSummary(BaseModel):
    id: str = Field(min_length=1)
    label: str = Field(min_length=1, max_length=120)
    note: str = Field(default="", max_length=1000)
    kind: CheckpointKind = "manual"
    week_key: str | None = None
    created_by: str = Field(default="Local User", max_length=120)
    created_at: str
    plan_version: int = 1
    project_count: int = 0
    people_count: int = 0


class CheckpointDetail(CheckpointSummary):
    plan: PlanDocument


class CheckpointCreateRequest(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    note: str = Field(default="", max_length=1000)
    kind: CheckpointKind = "manual"
    created_by: str = Field(default="Local User", max_length=120)
    plan: PlanDocument | None = None


class CheckpointUpdateRequest(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    note: str | None = Field(default=None, max_length=1000)


class ExportEnvelope(BaseModel):
    schema_version: int = 2
    exported_at: str
    plan: PlanDocument
    checkpoints: list[CheckpointDetail] = Field(default_factory=list)


class BackupCreateRequest(BaseModel):
    label: str = Field(default="Manual backup", max_length=80)


class BackupInfo(BaseModel):
    filename: str
    label: str
    created_at: str
    size_bytes: int
    project_count: int
    people_count: int


class CsvImportRequest(BaseModel):
    csv_text: str
    mode: Literal["merge", "replace"] = "merge"
