"""The stage gate — what decides whether the next pass is allowed to start.

The per-asset QC gate in `qc.py` answers "is this frame good?". This answers the question
that actually controls spending: **given everything this pass produced, do we open the next
one?** They are deliberately different decisions. A single borderline frame is something you
keep and flag; a stage full of them is a pass you do not want to build a film on top of.

No gate opens itself. The verdict is computed and shown either way, so the director is
approving with the reviewer's findings in front of them rather than instead of them — but
the decision to spend the next pass is always a human's. A gate that could be skipped would
be a setting nobody touched, not a gate.

Nothing here generates or judges pixels. It reads verdicts that already exist on the graph
and turns them into one decision, which is what makes a gate cheap enough to sit between
every pass.
"""
from __future__ import annotations

import time

from ..models import (NodeStatus, Project, StageBlocker, StageGate, StageRecord,
                      StageStatus)
from . import qc as qc_agent


def _reason(node) -> str | None:
    """Why this node stops the stage, or None if it doesn't.

    Order matters: a node that never produced pixels is a different problem from one whose
    pixels were judged and found wanting, and the director should be told which.
    """
    if node.locked or node.data.get("qc_override"):
        # Both are a human having already settled this node — a lock says "keep it", an
        # override says "I looked and kept it anyway". Re-litigating either at the gate
        # would make those decisions worthless.
        return None
    if node.status == NodeStatus.FAILED:
        return (node.qc.summary if node.qc else "generation failed")
    if node.status == NodeStatus.STALE:
        return "built from a take that has since changed"
    if node.qc and not qc_agent.accepted(node.qc):
        bad = ", ".join(qc_agent.LABELS.get(c.criterion, c.criterion).lower()
                        for c in node.qc.failed())
        return f"{node.qc.verdict.lower()} on {bad}" if bad else node.qc.summary
    return None


def evaluate(project: Project, record: StageRecord) -> StageGate:
    """Roll a stage's nodes up into one gate decision."""
    nodes = [n for n in (project.get(i) for i in record.node_ids) if n]
    blockers = [
        StageBlocker(node_id=n.node_id, title=n.title, kind=n.kind.value, reason=r)
        for n in nodes if (r := _reason(n))
    ]
    reviewed = sum(1 for n in nodes if n.qc)

    if not nodes:
        # Held rather than cleared: every one of the four passes is supposed to produce
        # something, so an empty one is a pass that didn't run — usually its own preflight
        # refusing to spend on inputs that aren't there. Calling that "clear" would invite
        # the director to approve their way further down a broken film.
        return StageGate(stage=record.key, verdict="hold", reviewed=0,
                         summary="This pass produced nothing — it has not run yet.")

    if blockers:
        summary = (f"{len(blockers)} of {len(nodes)} need a look before the next stage: "
                   f"{', '.join(b.title for b in blockers[:3])}"
                   + ("…" if len(blockers) > 3 else ""))
    elif reviewed:
        summary = f"All {reviewed} asset(s) cleared the gate."
    else:
        # Story and breakdown stages write text, not pixels — there is nothing for a vision
        # judge to look at, and saying "all clear" would overclaim.
        summary = f"{len(nodes)} item(s) written — nothing here needs a render to be judged."

    return StageGate(stage=record.key, verdict="hold" if blockers else "clear",
                     summary=summary, blockers=blockers, reviewed=reviewed)


def decide(record: StageRecord, *, by: str, approved: bool, note: str | None = None) -> StageRecord:
    """Record who opened (or held) the gate, without touching what the reviewer found.

    The verdict is left exactly as filed. A director pushing past a hold is a second fact
    recorded beside the first, never a rewrite of it — otherwise the run's history would
    show a pass the reviewer never gave.
    """
    if record.gate:
        record.gate.decided_by = by
        record.gate.decided_at = time.time()
        record.gate.note = note
    record.status = StageStatus.APPROVED if approved else StageStatus.BLOCKED
    return record


def board(project: Project) -> dict:
    """The whole run as passes rather than nodes — what is done, what is open, what is next.

    This is the view that makes staged generation legible: a node list tells you what exists,
    but only the board tells you what the run is *waiting on*, which is the thing a director
    standing at a gate actually needs.
    """
    stages = project.ensure_stages()
    for s in stages:
        # A gate that is still holding is re-read against the graph, because the whole point
        # of holding is that a human is off fixing the thing it named. Serving the verdict
        # as filed would keep listing blockers that were settled ten minutes ago.
        if s.status in (StageStatus.AWAITING, StageStatus.BLOCKED):
            s.gate = evaluate(project, s)
            s.status = (StageStatus.BLOCKED if s.gate.verdict == "hold"
                        else StageStatus.AWAITING)

    nxt = project.next_stage()
    return {
        "stages": [
            {"key": s.key, "label": s.label, "status": s.status.value,
             "nodes": len(s.node_ids),
             "gate": s.gate.model_dump() if s.gate else None}
            for s in stages
        ],
        "next": nxt.key if nxt else None,
        # What the run is stuck behind, if anything — the one field a client can act on.
        "awaiting": next((s.key for s in stages
                          if s.status in (StageStatus.AWAITING, StageStatus.BLOCKED)), None),
        "complete": nxt is None,
    }
