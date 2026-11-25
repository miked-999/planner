"""Core plan read, atomic sync, seed, and clear routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from ..db import is_db_non_empty, read_plan, write_plan
from ..schemas import PlanDocument
from ..seed import build_sample_plan
from .backups import create_snapshot

router = APIRouter(prefix="/api/plan", tags=["plan"])


@router.get("", response_model=PlanDocument)
def get_plan() -> PlanDocument:
    return read_plan()


@router.put("", response_model=PlanDocument)
def put_plan(plan: PlanDocument) -> PlanDocument:
    try:
        return write_plan(plan)
    except (ValueError, ValidationError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/seed", response_model=PlanDocument)
def seed_sample_plan() -> PlanDocument:
    if is_db_non_empty():
        create_snapshot("Auto pre-seed")
    sample = build_sample_plan()
    return write_plan(sample)


@router.post("/clear", response_model=PlanDocument)
def clear_plan() -> PlanDocument:
    if is_db_non_empty():
        create_snapshot("Auto pre-clear")
    return write_plan(PlanDocument())
