"""Sample dataset generator modeled on Requirements v0.2 (Projects A–E & Team)."""

from __future__ import annotations

from datetime import date, timedelta

from .schemas import (
    Assignment,
    Dependency,
    Person,
    PlanDocument,
    Project,
    Task,
    Unavailability,
)


def _monday_of_week(ref: date) -> date:
    return ref - timedelta(days=ref.weekday())


def _add_working_days(start: date, working_days: int) -> date:
    """Advance `working_days` steps (0 returns start if weekday, else next Monday)."""
    cur = start
    while cur.weekday() >= 5:
        cur += timedelta(days=1)
    step = 1 if working_days >= 0 else -1
    remaining = abs(working_days)
    while remaining > 0:
        cur += timedelta(days=step)
        if cur.weekday() < 5:
            remaining -= 1
    return cur


def build_sample_plan(today: date | None = None) -> PlanDocument:
    anchor = _monday_of_week(today or date.today())
    # W0 = current week Monday; build a realistic 10-week window around today
    w_minus_2 = _add_working_days(anchor, -10)
    w_minus_1 = _add_working_days(anchor, -5)
    w0 = anchor
    w1 = _add_working_days(anchor, 5)
    w2 = _add_working_days(anchor, 10)
    w3 = _add_working_days(anchor, 15)
    w4 = _add_working_days(anchor, 20)
    w5 = _add_working_days(anchor, 25)
    w6 = _add_working_days(anchor, 30)

    def end_of_week(monday: date, extra_weeks: int = 0) -> date:
        return _add_working_days(monday, extra_weeks * 5 + 4)  # Friday

    people = [
        Person(id="person-alice", name="Alice Morgan", sort_order=0),
        Person(id="person-ben", name="Ben Carter", sort_order=1),
        Person(id="person-clara", name="Clara Patel", sort_order=2),
        Person(id="person-dan", name="Dan Brooks", sort_order=3),
        Person(id="person-elena", name="Elena Rossi", sort_order=4),
    ]

    # Project A: Multi-phase active project (Initial Review -> Detailed Assessment -> Independent Testing -> Final Report)
    pa_t1_start, pa_t1_end = w_minus_2, end_of_week(w_minus_1)
    pa_t2_start, pa_t2_end = w0, end_of_week(w1)
    pa_t3_start, pa_t3_end = w2, end_of_week(w2)
    pa_t4_start, pa_t4_end = w3, end_of_week(w3)

    projects = [
        Project(
            id="proj-a",
            name="Project Alpha — Core Architecture Review",
            description="End-to-end architecture & resilience review across core services.",
            expected_start=pa_t1_start.isoformat(),
            actual_start=pa_t1_start.isoformat(),
            expected_end=pa_t4_end.isoformat(),
            original_expected_end=end_of_week(w2).isoformat(),
            required_by=end_of_week(w4).isoformat(),
            percent_complete=50,
            auto_progress=True,
            status="in_progress",
            priority="high",
            color="#2563eb",
            notes="Jira Epic: ARCH-104. Slipped 1 week after initial scoping.",
            sort_order=0,
        ),
        Project(
            id="proj-b",
            name="Project Beta — Vendor Security Audit",
            description="Follow-on security verification once Alpha completes.",
            expected_start=w4.isoformat(),
            expected_end=end_of_week(w6).isoformat(),
            original_expected_end=end_of_week(w5).isoformat(),
            required_by=end_of_week(w5).isoformat(),  # Forecast 1 week late (-5 wd headroom!)
            percent_complete=0,
            auto_progress=False,
            status="planned",
            priority="high",
            color="#dc2626",
            notes="Depends on Project Alpha finishing. Currently forecast 5 working days past deadline.",
            sort_order=1,
        ),
        Project(
            id="proj-c",
            name="Project Gamma — Data Pipeline Upgrade",
            description="Migrate reporting ETL pipelines and validate schema parity.",
            expected_start=w_minus_1.isoformat(),
            actual_start=w_minus_1.isoformat(),
            expected_end=end_of_week(w3).isoformat(),
            original_expected_end=end_of_week(w3).isoformat(),
            required_by=end_of_week(w3).isoformat(),  # 0 days headroom (Amber!)
            percent_complete=40,
            auto_progress=True,
            status="in_progress",
            priority="medium",
            color="#7c3aed",
            notes="Zero headroom against March/Q-end cutover; watch Ben's allocation.",
            sort_order=2,
        ),
        Project(
            id="proj-d",
            name="Project Delta — Regulatory Controls",
            description="Quarterly control evidence refresh and sign-off.",
            expected_start=w0.isoformat(),
            actual_start=w0.isoformat(),
            expected_end=end_of_week(w1).isoformat(),
            original_expected_end=end_of_week(w1).isoformat(),
            required_by=end_of_week(w2).isoformat(),
            percent_complete=65,
            auto_progress=False,
            status="in_progress",
            priority="medium",
            color="#059669",
            notes="On track; Clara freeing up after Week 2.",
            sort_order=3,
        ),
        Project(
            id="proj-e",
            name="Project Epsilon — Partner Onboarding",
            description="API sandbox onboarding for new strategic partner.",
            expected_start=w2.isoformat(),
            expected_end=end_of_week(w4).isoformat(),
            original_expected_end=end_of_week(w4).isoformat(),
            required_by=end_of_week(w5).isoformat(),
            percent_complete=0,
            auto_progress=False,
            status="planned",
            priority="low",
            color="#d97706",
            notes="Can flex by a week if Delta or Gamma need support.",
            sort_order=4,
        ),
    ]

    tasks = [
        Task(
            id="task-a1",
            project_id="proj-a",
            name="Initial Review",
            expected_start=pa_t1_start.isoformat(),
            actual_start=pa_t1_start.isoformat(),
            expected_end=pa_t1_end.isoformat(),
            original_expected_end=pa_t1_end.isoformat(),
            percent_complete=100,
            status="completed",
            priority="high",
            sort_order=0,
        ),
        Task(
            id="task-a2",
            project_id="proj-a",
            name="Detailed Assessment",
            expected_start=pa_t2_start.isoformat(),
            actual_start=pa_t2_start.isoformat(),
            expected_end=pa_t2_end.isoformat(),
            original_expected_end=pa_t2_end.isoformat(),
            percent_complete=55,
            status="in_progress",
            priority="high",
            sort_order=1,
        ),
        Task(
            id="task-a3",
            project_id="proj-a",
            name="Independent Testing",
            expected_start=pa_t3_start.isoformat(),
            expected_end=pa_t3_end.isoformat(),
            original_expected_end=end_of_week(w1).isoformat(),
            percent_complete=0,
            status="planned",
            priority="medium",
            sort_order=2,
        ),
        Task(
            id="task-a4",
            project_id="proj-a",
            name="Final Report",
            expected_start=pa_t4_start.isoformat(),
            expected_end=pa_t4_end.isoformat(),
            original_expected_end=end_of_week(w2).isoformat(),
            required_by=end_of_week(w4).isoformat(),
            percent_complete=0,
            status="planned",
            priority="high",
            sort_order=3,
        ),
        Task(
            id="task-c1",
            project_id="proj-c",
            name="Schema & Connector Build",
            expected_start=w_minus_1.isoformat(),
            actual_start=w_minus_1.isoformat(),
            expected_end=end_of_week(w1).isoformat(),
            original_expected_end=end_of_week(w1).isoformat(),
            percent_complete=65,
            status="in_progress",
            priority="medium",
            sort_order=0,
        ),
        Task(
            id="task-c2",
            project_id="proj-c",
            name="Parallel Run & Cutover",
            expected_start=w2.isoformat(),
            expected_end=end_of_week(w3).isoformat(),
            original_expected_end=end_of_week(w3).isoformat(),
            required_by=end_of_week(w3).isoformat(),
            percent_complete=0,
            status="planned",
            priority="high",
            sort_order=1,
        ),
    ]

    assignments = [
        # Alice: Working on Alpha tasks at 100%, then Beta at 100%
        Assignment(id="asg-1", person_id="person-alice", project_id="proj-a", task_id="task-a1", allocation_pct=100),
        Assignment(id="asg-2", person_id="person-alice", project_id="proj-a", task_id="task-a2", allocation_pct=100),
        Assignment(id="asg-3", person_id="person-alice", project_id="proj-a", task_id="task-a4", allocation_pct=75),
        Assignment(id="asg-4", person_id="person-alice", project_id="proj-b", allocation_pct=100),
        # Ben: Overallocated in W0-W1 (50% on Alpha Detailed Assessment + 75% on Gamma = 125% conflict!)
        Assignment(id="asg-5", person_id="person-ben", project_id="proj-a", task_id="task-a2", allocation_pct=50),
        Assignment(id="asg-6", person_id="person-ben", project_id="proj-c", task_id="task-c1", allocation_pct=75),
        Assignment(id="asg-7", person_id="person-ben", project_id="proj-c", task_id="task-c2", allocation_pct=75),
        # Clara: Delta (100% W0-W1), then free in W2-W3, then Beta (50% W4-W6)
        Assignment(id="asg-8", person_id="person-clara", project_id="proj-d", allocation_pct=100),
        Assignment(id="asg-9", person_id="person-clara", project_id="proj-b", allocation_pct=50),
        # Dan: Gamma (50% W0-W3) + Alpha Independent Testing (50% W2)
        Assignment(id="asg-10", person_id="person-dan", project_id="proj-c", task_id="task-c1", allocation_pct=50),
        Assignment(id="asg-11", person_id="person-dan", project_id="proj-c", task_id="task-c2", allocation_pct=50),
        Assignment(id="asg-12", person_id="person-dan", project_id="proj-a", task_id="task-a3", allocation_pct=50),
        # Elena: Epsilon (75% W2-W4)
        Assignment(id="asg-13", person_id="person-elena", project_id="proj-e", allocation_pct=75),
    ]

    unavailabilities = [
        Unavailability(
            id="leave-1",
            person_id="person-elena",
            start_date=w1.isoformat(),
            end_date=end_of_week(w1).isoformat(),
            reason="Annual Leave",
            allocation_pct=100,
        )
    ]

    dependencies = [
        # Intra-project dependencies (DEP-02)
        Dependency(id="dep-1", from_type="task", from_id="task-a1", to_type="task", to_id="task-a2"),
        Dependency(id="dep-2", from_type="task", from_id="task-a2", to_type="task", to_id="task-a3"),
        Dependency(id="dep-3", from_type="task", from_id="task-a3", to_type="task", to_id="task-a4"),
        Dependency(id="dep-4", from_type="task", from_id="task-c1", to_type="task", to_id="task-c2"),
        # Project-to-project dependency (DEP-01): Alpha -> Beta
        Dependency(id="dep-5", from_type="project", from_id="proj-a", to_type="project", to_id="proj-b"),
        # Project-to-project dependency: Delta -> Epsilon
        Dependency(id="dep-6", from_type="project", from_id="proj-d", to_type="project", to_id="proj-e"),
    ]

    return PlanDocument(
        projects=projects,
        tasks=tasks,
        people=people,
        assignments=assignments,
        unavailabilities=unavailabilities,
        dependencies=dependencies,
    )
