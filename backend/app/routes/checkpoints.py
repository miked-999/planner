"""Versioned checkpoints & baseline comparison routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..db import (
    create_checkpoint_db,
    delete_checkpoint_db,
    get_checkpoint_db,
    is_db_non_empty,
    list_checkpoints_db,
    update_checkpoint_db,
    write_plan,
)
from ..schemas import (
    CheckpointCreateRequest,
    CheckpointDetail,
    CheckpointSummary,
    CheckpointUpdateRequest,
    PlanDocument,
)
from .backups import create_snapshot

router = APIRouter(prefix="/api/checkpoints", tags=["checkpoints"])


@router.get("", response_model=list[CheckpointSummary])
def list_checkpoints() -> list[CheckpointSummary]:
    return list_checkpoints_db(include_plan=False)  # type: ignore[return-value]


@router.get("/{checkpoint_id}", response_model=CheckpointDetail)
def get_checkpoint(checkpoint_id: str) -> CheckpointDetail:
    found = get_checkpoint_db(checkpoint_id)
    if not found:
        raise HTTPException(status_code=404, detail="Checkpoint not found")
    return found


@router.post("", response_model=CheckpointSummary)
def create_checkpoint(req: CheckpointCreateRequest) -> CheckpointSummary:
    return create_checkpoint_db(
        label=req.label,
        note=req.note,
        kind=req.kind,
        created_by=req.created_by,
        plan_override=req.plan,
    )


@router.patch("/{checkpoint_id}", response_model=CheckpointSummary)
def update_checkpoint(
    checkpoint_id: str, req: CheckpointUpdateRequest
) -> CheckpointSummary:
    updated = update_checkpoint_db(
        checkpoint_id=checkpoint_id,
        label=req.label,
        note=req.note,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Checkpoint not found")
    return updated


@router.post("/{checkpoint_id}/restore", response_model=PlanDocument)
def restore_checkpoint(checkpoint_id: str) -> PlanDocument:
    found = get_checkpoint_db(checkpoint_id)
    if not found:
        raise HTTPException(status_code=404, detail="Checkpoint not found")
    if is_db_non_empty():
        create_snapshot(f"Auto pre-restore {found.label[:24]}")
    return write_plan(found.plan)


@router.delete("/{checkpoint_id}")
def delete_checkpoint(checkpoint_id: str) -> dict[str, str]:
    ok = delete_checkpoint_db(checkpoint_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Checkpoint not found")
    return {"status": "deleted", "id": checkpoint_id}
